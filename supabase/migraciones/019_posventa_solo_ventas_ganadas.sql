-- Ajuste a la posventa (migración 018), encontrado en la revisión del código: un recordatorio que
-- quedó pendiente (Gmail falló) salía aunque el cliente ya no tuviera una venta ganada (la venta se
-- reabrió o se perdió). Ahora se descarta, sin alarma.

create or replace function tomar_posventa(p_ejecucion text, p_hoy date default null) returns jsonb
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

  -- 2a. Si el cliente ya no tiene una venta ganada (se reabrió o se perdió), ya no es una instalación:
  -- su recordatorio pendiente no sale (sin alarma: no es una falla)
  update avisos_posventa a set vencido_en = now(), correo = null, ejecucion = null, reservado_en = null
  where a.correo is not null and a.enviado_en is null and a.vencido_en is null
    and not exists (select 1 from oportunidades o where o.contacto_id = a.contacto_id and o.etapa = 'ganado');

  -- 2b. Los correos que llevan 7 días sin salir se dan por vencidos (la tarea del asesor ya existe)
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

revoke execute on function tomar_posventa(text, date) from public, anon, authenticated;
grant execute on function tomar_posventa(text, date) to service_role;
