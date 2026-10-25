-- Flujos 5 (reporte semanal) y 6 (posventa) de la fase 3. El diseño, con lo que puede fallar y los
-- ajustes de su revisión, está en docs/plan-fase-3.md, sección 4d.
--
-- 1. Corrige la fecha de cierre (error de la fase 1): una venta que pasaba directo de perdida a ganada
--    (el tablero lo permite) conservaba la fecha del cierre anterior.
-- 2. El reporte semanal: las cifras de una semana, la foto de hoy y la reserva (una vez por semana).
-- 3. La posventa: los aniversarios de 6 meses de cada cliente, la tarea del asesor y el correo al cliente.

-- ---------------------------------------------------------------------------
-- 1. La fecha de cierre
-- ---------------------------------------------------------------------------

create or replace function registrar_cambio_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if en_carga_masiva() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into historial_etapas (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, fecha)
    values (new.id, null, new.etapa, auth.uid(), new.creada_en);
    return new;
  end if;

  new.actualizada_en := now();
  if new.etapa is distinct from old.etapa then
    insert into historial_etapas (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, fecha)
    values (new.id, old.etapa, new.etapa, auth.uid(), now());

    if new.etapa in ('ganado', 'perdido') then
      -- Cada vez que entra a ganada o perdida se cierra ahora, también al pasar directo de una a la
      -- otra (antes conservaba la fecha del cierre anterior). Solo se respeta una fecha nueva escrita a mano
      new.fecha_cierre := case
        when new.fecha_cierre is distinct from old.fecha_cierre then coalesce(new.fecha_cierre, now())
        else now()
      end;
    else
      -- Si una venta cerrada se reabre, deja de tener fecha de cierre y motivo de pérdida
      new.fecha_cierre := null;
      new.motivo_perdida := null;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. El reporte semanal
-- ---------------------------------------------------------------------------

-- Lo que se movió en una semana (de lunes a domingo, hora de Bogotá), con las definiciones del panel:
-- lead nuevo = venta de tipo "nueva" creada en la semana (el canal es el del contacto); ganadas y
-- perdidas = etapa actual y fecha de cierre en la semana (incluye ampliaciones, que se cuentan aparte)
create function movimiento_de_semana(p_lunes date) returns jsonb
language sql stable security definer set search_path = public as $$
  with
  limites as (
    select (p_lunes::timestamp at time zone 'America/Bogota') as desde,
      ((p_lunes + 7)::timestamp at time zone 'America/Bogota') as hasta
  ),
  leads as (
    select c.canal_origen, o.asesor_id
    from oportunidades o join contactos c on c.id = o.contacto_id, limites l
    where o.tipo = 'nueva' and o.creada_en >= l.desde and o.creada_en < l.hasta
  ),
  cerradas as (
    select o.* from oportunidades o, limites l
    where o.etapa in ('ganado', 'perdido') and o.fecha_cierre >= l.desde and o.fecha_cierre < l.hasta
  )
  select jsonb_build_object(
    'leads', (select count(*) from leads),
    'leads_por_canal', (
      select coalesce(jsonb_object_agg(canal_origen, n), '{}'::jsonb)
      from (select canal_origen, count(*) as n from leads group by 1) x
    ),
    'ganadas', (select count(*) from cerradas where etapa = 'ganado'),
    'valor_ganado', (select coalesce(sum(valor_cop), 0) from cerradas where etapa = 'ganado'),
    'ampliaciones', (select count(*) from cerradas where etapa = 'ganado' and tipo = 'ampliacion'),
    'ganadas_sin_valor', (select count(*) from cerradas where etapa = 'ganado' and valor_cop is null),
    'perdidas', (select count(*) from cerradas where etapa = 'perdido'),
    'motivos', (
      select coalesce(jsonb_object_agg(motivo_perdida, n), '{}'::jsonb)
      from (select motivo_perdida, count(*) as n from cerradas where etapa = 'perdido' group by 1) x
    ),
    'por_asesor', (
      select coalesce(jsonb_object_agg(p.nombre, jsonb_build_object(
        'leads', (select count(*) from leads l where l.asesor_id = p.id),
        'ganadas', (select count(*) from cerradas c where c.asesor_id = p.id and c.etapa = 'ganado'),
        'valor_ganado', (select coalesce(sum(c.valor_cop), 0) from cerradas c where c.asesor_id = p.id and c.etapa = 'ganado')
      )), '{}'::jsonb)
      from perfiles p where p.rol = 'asesor'
    )
  )
$$;

-- La foto de hoy: lo abierto y el seguimiento, con las mismas fórmulas del panel y la vista del flujo 3
create function foto_del_negocio() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'abiertas', count(*),
    'pipeline', coalesce(sum(valor_cop), 0),
    'pipeline_ponderado', coalesce(round(sum(valor_cop * probabilidad / 100.0)), 0),
    'sin_seguimiento', (select count(*) from seguimiento_ventas where dias >= 7),
    'sin_seguimiento_por_asesor', (
      select coalesce(jsonb_object_agg(p.nombre, (
        select count(*) from seguimiento_ventas s where s.asesor_id = p.id and s.dias >= 7
      )), '{}'::jsonb)
      from perfiles p where p.rol = 'asesor'
    )
  )
  from oportunidades where etapa not in ('ganado', 'perdido')
$$;

-- Un reporte por semana (el lunes de la semana que resume). Las cifras se guardan: no traen nombres de
-- clientes, y la foto de hoy (lo abierto) no se puede recalcular después para compararla
create table reportes_semanales (
  semana date primary key,
  ejecucion text,
  reservado_en timestamptz,
  enviado_en timestamptz,
  cifras jsonb not null
);
alter table reportes_semanales enable row level security;
revoke all on reportes_semanales from anon, authenticated;

-- Reserva el reporte de la semana que acaba de terminar, si todavía no salió, y lo devuelve con sus
-- cifras. p_hoy solo lo usan las pruebas (la ventanilla del CRM no lo pasa)
create function tomar_reporte_semanal(p_ejecucion text, p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  v_semana date := date_trunc('week', hoy)::date - 7; -- el lunes de la semana pasada
  gerente perfiles%rowtype;
  fila reportes_semanales%rowtype;
  v_cifras jsonb;
begin
  if coalesce(trim(p_ejecucion), '') = '' then
    raise exception 'Falta la ejecución' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reporte_semanal'));

  -- Sábado y domingo no: un reporte de la semana anterior ya no sirve (aunque alguien corra el flujo a mano)
  if extract(isodow from hoy) > 5 then
    return jsonb_build_object('reporte', null, 'sin_gerente', false);
  end if;

  select * into gerente from perfiles where rol = 'gerente' and activo order by codigo limit 1;
  if not found then
    return jsonb_build_object('reporte', null, 'sin_gerente', true);
  end if;

  -- Si ya salió, o lo tiene otra ejecución hace menos de 30 minutos, no hay nada que hacer
  select * into fila from reportes_semanales where semana = v_semana;
  if found and (
    fila.enviado_en is not null
    or (fila.reservado_en > now() - interval '30 minutes' and fila.ejecucion is distinct from p_ejecucion)
  ) then
    return jsonb_build_object('reporte', null, 'sin_gerente', false);
  end if;

  v_cifras := jsonb_build_object(
    'semana', movimiento_de_semana(v_semana),
    'anterior', movimiento_de_semana(v_semana - 7),
    'foto', foto_del_negocio(),
    -- La foto de la semana anterior, si su reporte salió
    'foto_anterior', (select cifras->'foto' from reportes_semanales where semana = v_semana - 7 and enviado_en is not null)
  );
  insert into reportes_semanales (semana, ejecucion, reservado_en, cifras)
  values (v_semana, p_ejecucion, now(), v_cifras)
  on conflict (semana) do update
    set ejecucion = excluded.ejecucion, reservado_en = excluded.reservado_en, cifras = excluded.cifras;

  return jsonb_build_object(
    'reporte', jsonb_build_object(
      -- El lunes de la semana que resume (sus cifras van en "semana")
      'lunes', v_semana,
      -- Lo normal es que salga el lunes; si sale otro día, el correo lo dice
      'llega_tarde', hoy > v_semana + 7,
      'destinatario', jsonb_build_object('nombre', gerente.nombre, 'email', gerente.email)
    ) || v_cifras,
    'sin_gerente', false
  );
end;
$$;

create function confirmar_reporte(p_semana date, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update reportes_semanales set enviado_en = now()
  where semana = p_semana and ejecucion = p_ejecucion and enviado_en is null;
  if found then
    return true;
  end if;
  return exists (select 1 from reportes_semanales where semana = p_semana and ejecucion = p_ejecucion and enviado_en is not null);
end;
$$;

create function soltar_reporte(p_semana date, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update reportes_semanales set ejecucion = null, reservado_en = null
  where semana = p_semana and ejecucion = p_ejecucion and enviado_en is null;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. La posventa
-- ---------------------------------------------------------------------------

-- Un aviso por cliente y aniversario (cada 6 meses desde su primera venta ganada que siga ganada).
-- La clave es la fecha del aniversario, no "N meses": si la venta se reabre y se vuelve a ganar, la
-- fecha base cambia y los aniversarios nuevos son otros
create table avisos_posventa (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null references contactos (id) on delete cascade,
  aniversario date not null,
  meses integer not null check (meses > 0 and meses % 6 = 0),
  tarea_id uuid references actividades (id) on delete set null,
  -- El correo al cliente (a quién y con qué nombres); vacío si no dejó correo. Se borra al
  -- confirmarlo o cuando se vence, para no guardar datos del cliente de más
  correo jsonb,
  ejecucion text,
  reservado_en timestamptz,
  enviado_en timestamptz,
  vencido_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (contacto_id, aniversario)
);
alter table avisos_posventa enable row level security;
revoke all on avisos_posventa from anon, authenticated;

-- Crea las tareas de los aniversarios nuevos (de una vez, sin esperar a Gmail: lo importante es que el
-- asesor llame), da por vencidos los correos que llevan 7 días sin salir y reserva los que faltan.
-- p_hoy solo lo usan las pruebas
create function tomar_posventa(p_ejecucion text, p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  gerente_id uuid;
  sin_gerente boolean := false;
  vencidos integer;
  r record;
  responsable perfiles%rowtype;
  tarea uuid;
  correos jsonb;
begin
  if coalesce(trim(p_ejecucion), '') = '' then
    raise exception 'Falta la ejecución' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('posventa'));
  select id into gerente_id from perfiles where rol = 'gerente' and activo order by codigo limit 1;

  -- 1. Los aniversarios de los últimos 30 días que todavía no tienen aviso
  for r in
    with base as (
      -- Una sola cadena por cliente (una ampliación es el mismo sistema), desde su primera venta ganada.
      -- La fecha en hora de Bogotá: una venta del 31 de agosto a las 8 p. m. es del 31, no del 1
      select o.contacto_id, min((o.fecha_cierre at time zone 'America/Bogota')::date) as fecha,
        (array_agg(o.codigo order by o.fecha_cierre))[1] as venta
      from oportunidades o
      where o.etapa = 'ganado'
      group by o.contacto_id
    ),
    aniversarios as (
      -- Siempre fecha base + 6·N meses (sumar sobre el aniversario anterior correría el 31 al 28).
      -- Postgres pasa el 31 de agosto + 6 meses al 28 (o 29) de febrero
      select b.contacto_id, b.venta, n * 6 as meses, (b.fecha + make_interval(months => n * 6))::date as aniversario
      from base b cross join generate_series(1, 40) n
    )
    select a.*, c.nombre, c.empresa, c.email, c.asesor_id
    from aniversarios a join contactos c on c.id = a.contacto_id
    where a.aniversario between hoy - 29 and hoy
      and not exists (select 1 from avisos_posventa x where x.contacto_id = a.contacto_id and x.aniversario = a.aniversario)
    order by a.aniversario
  loop
    -- La tarea es del asesor del contacto; si ya no está activo, de la gerente. Sin gerente no hay a
    -- quién dársela: se informa (alarma) y se intenta otra vez la hora siguiente
    select * into responsable from perfiles where id = r.asesor_id and activo;
    if not found then
      if gerente_id is null then
        sin_gerente := true;
        continue;
      end if;
      select * into responsable from perfiles where id = gerente_id;
    end if;

    -- Sin venta: así, si se vence, la vigila el flujo 3 (tareas sin venta vencidas hace 3+ días)
    insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
    values (r.contacto_id, null, responsable.id, 'tarea',
      format('Agendar el mantenimiento de los %s meses (instalación de la venta %s)', r.meses, r.venta), now(), false)
    returning id into tarea;

    insert into avisos_posventa (contacto_id, aniversario, meses, tarea_id, correo)
    values (r.contacto_id, r.aniversario, r.meses, tarea,
      case when coalesce(trim(r.email), '') <> '' then jsonb_build_object(
        'para', r.email, 'cliente', r.nombre, 'empresa', r.empresa, 'responsable', responsable.nombre
      ) end);
  end loop;

  -- 2. Los correos que llevan 7 días sin salir se dan por vencidos (la tarea del asesor ya existe)
  with v as (
    update avisos_posventa set vencido_en = now(), correo = null, ejecucion = null, reservado_en = null
    where correo is not null and enviado_en is null and vencido_en is null and creado_en < now() - interval '7 days'
    returning 1
  )
  select count(*) into vencidos from v;

  -- 3. Reservar los correos que faltan: libres, abandonados (30 minutos) o de esta misma ejecución
  with tomados as (
    update avisos_posventa set ejecucion = p_ejecucion, reservado_en = now()
    where correo is not null and enviado_en is null and vencido_en is null
      and (reservado_en is null or reservado_en < now() - interval '30 minutes' or ejecucion = p_ejecucion)
    returning id, meses, correo
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'meses', meses) || correo order by id), '[]'::jsonb)
  into correos
  from tomados;

  return jsonb_build_object('correos', correos, 'sin_gerente', sin_gerente, 'vencidos', vencidos);
end;
$$;

-- El correo salió: se marca y se borran el correo y los nombres guardados
create function confirmar_posventa(p_aviso uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update avisos_posventa set enviado_en = now(), correo = null
  where id = p_aviso and ejecucion = p_ejecucion and enviado_en is null and vencido_en is null;
  if found then
    return true;
  end if;
  return exists (select 1 from avisos_posventa where id = p_aviso and ejecucion = p_ejecucion and enviado_en is not null);
end;
$$;

create function soltar_posventa(p_aviso uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update avisos_posventa set ejecucion = null, reservado_en = null
  where id = p_aviso and ejecucion = p_ejecucion and enviado_en is null;
  return found;
end;
$$;

-- Solo la llave de servicio (la ventanilla del CRM) llama a estas funciones
revoke execute on function movimiento_de_semana(date) from public, anon, authenticated;
revoke execute on function foto_del_negocio() from public, anon, authenticated;
revoke execute on function tomar_reporte_semanal(text, date) from public, anon, authenticated;
revoke execute on function confirmar_reporte(date, text) from public, anon, authenticated;
revoke execute on function soltar_reporte(date, text) from public, anon, authenticated;
revoke execute on function tomar_posventa(text, date) from public, anon, authenticated;
revoke execute on function confirmar_posventa(uuid, text) from public, anon, authenticated;
revoke execute on function soltar_posventa(uuid, text) from public, anon, authenticated;
grant execute on function movimiento_de_semana(date) to service_role;
grant execute on function foto_del_negocio() to service_role;
grant execute on function tomar_reporte_semanal(text, date) to service_role;
grant execute on function confirmar_reporte(date, text) to service_role;
grant execute on function soltar_reporte(date, text) to service_role;
grant execute on function tomar_posventa(text, date) to service_role;
grant execute on function confirmar_posventa(uuid, text) to service_role;
grant execute on function soltar_posventa(uuid, text) to service_role;
