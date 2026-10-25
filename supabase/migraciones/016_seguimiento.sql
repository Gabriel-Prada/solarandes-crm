-- Flujo 3 de la fase 3: seguimiento. El diseño, con lo que puede fallar, está en docs/plan-fase-3.md,
-- sección 4c.
--
-- 1. Una sola regla de "días sin actividad", en la vista seguimiento_ventas. La usan el panel de la
--    gerente (panel_gerente se reescribe aquí), el tablero de ventas del CRM y el correo de seguimiento.
--    Antes había dos copias (SQL en el panel y TypeScript en el tablero) y el flujo habría sido la tercera.
-- 2. Cuándo se completó cada actividad (completada_en): completar hoy una tarea agendada hace 5 días
--    es actividad de hoy, no de hace 5 días.
-- 3. Qué se le avisó a quién (avisos_seguimiento) y la reserva de los resúmenes de cada día
--    (resumenes_seguimiento), para que cada resumen salga una sola vez aunque n8n corra dos veces.

-- ---------------------------------------------------------------------------
-- 1. Cuándo se completó cada actividad
-- ---------------------------------------------------------------------------

alter table actividades add column completada_en timestamptz;

create function marcar_completada() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- Lo que se anota ya hecho (una llamada, una nota, las notas viejas que trae la migración del
    -- Excel) ocurrió en su propia fecha, nunca en el futuro
    new.completada_en := case when new.completada then least(coalesce(new.completada_en, new.fecha), now()) end;
  elsif new.completada and not old.completada then
    new.completada_en := now(); -- una tarea o visita que se marca como hecha: se hizo ahora
  elsif not new.completada then
    new.completada_en := null; -- se desmarcó
  end if;
  return new;
end;
$$;

create trigger actividades_completada_en
  before insert or update of completada on actividades
  for each row execute function marcar_completada();

-- Las que ya existen: no se sabe cuándo se completaron, así que cuenta su fecha
update actividades set completada_en = least(fecha, now()) where completada;

-- ---------------------------------------------------------------------------
-- 2. La regla única: días sin actividad de cada venta abierta
-- ---------------------------------------------------------------------------

-- security_invoker: la vista corre con los permisos de quien la mira, así que un asesor solo ve
-- sus ventas (las reglas de RLS de oportunidades y actividades se aplican igual que siempre)
create view seguimiento_ventas with (security_invoker = true) as
select
  o.id as oportunidad_id,
  o.codigo,
  o.contacto_id,
  o.asesor_id,
  o.etapa,
  u.ultima_actividad,
  d.dias,
  case
    when d.dias >= 7 then 'aviso_gerente'
    when d.dias >= 3 then 'sin_seguimiento'
    else 'al_dia'
  end as nivel
from oportunidades o
cross join lateral (
  -- greatest: nada de antes de crear la venta cuenta (si no, una venta nueva de un cliente antiguo
  -- nacería con las notas de hace un año). greatest ignora el vacío: sin actividades, vale la creación
  select greatest(o.creada_en, (
    select max(least(coalesce(a.completada_en, a.fecha), now()))
    from actividades a
    where
      -- Lo hecho en la venta, o en el contacto sin elegir ninguna venta (el CRM lo permite)
      (a.completada and (a.oportunidad_id = o.id or (a.oportunidad_id is null and a.contacto_id = o.contacto_id)))
      -- Una visita agendada de esta venta: si todavía no llega cuenta como hoy (la venta está esperando
      -- la visita, no olvidada), con un tope de 30 días; si pasó sin marcarse, cuenta su fecha
      or (a.tipo = 'visita' and not a.completada and a.oportunidad_id = o.id and a.fecha <= now() + interval '30 days')
  )) as ultima_actividad
) u
-- 3 días son 72 horas, como siempre en el panel y el tablero
cross join lateral (select floor(extract(epoch from now() - u.ultima_actividad) / 86400)::integer as dias) d
where o.etapa not in ('ganado', 'perdido');

grant select on seguimiento_ventas to authenticated;
revoke all on seguimiento_ventas from anon;

-- El panel de la gerente, igual que en la migración 004, pero con la regla de la vista
create or replace function panel_gerente() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  resultado jsonb;
  -- Los meses se cuentan en hora de Colombia, no en la del servidor
  mes_actual date := date_trunc('month', now() at time zone 'America/Bogota')::date;
begin
  if mi_rol() is distinct from 'gerente' then
    raise exception 'Solo la gerente puede ver el panel' using errcode = '42501';
  end if;

  with
  -- Las ventas abiertas con sus días sin actividad (la regla única de seguimiento_ventas)
  seguimiento as (
    select asesor_id, dias from seguimiento_ventas
  ),
  meses as (
    select generate_series(mes_actual - interval '11 months', mes_actual, interval '1 month')::date as mes
  ),
  ganadas_por_mes as (
    select date_trunc('month', fecha_cierre at time zone 'America/Bogota')::date as mes,
      count(*) as ventas, sum(valor_cop) as valor
    from oportunidades
    where etapa = 'ganado'
    group by 1
  ),
  -- La etapa más alta que alcanzó cada venta. Las etapas son una lista ordenada (enum),
  -- así que max() da la más avanzada. "perdido" no es un avance: no cuenta.
  etapa_maxima as (
    select o.id,
      coalesce(max(h.etapa_nueva) filter (where h.etapa_nueva <> 'perdido'), 'nuevo') as etapa
    from oportunidades o
    left join historial_etapas h on h.oportunidad_id = o.id
    group by o.id
  ),
  etapas_embudo as (
    select e as etapa from unnest(enum_range(null::etapa_oportunidad)) e where e <> 'perdido'
  ),
  embudo as (
    select ee.etapa, count(em.id) as ventas
    from etapas_embudo ee
    left join etapa_maxima em on em.etapa >= ee.etapa
    group by ee.etapa
  ),
  -- Para las ventas perdidas hoy: en qué etapa estaban cuando se perdieron por última vez
  ultima_perdida as (
    select distinct on (h.oportunidad_id) h.etapa_anterior
    from historial_etapas h
    join oportunidades o on o.id = h.oportunidad_id and o.etapa = 'perdido'
    where h.etapa_nueva = 'perdido'
    order by h.oportunidad_id, h.fecha desc
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'ganadas_30', count(*) filter (where etapa = 'ganado' and fecha_cierre >= now() - interval '30 days'),
        'valor_30', coalesce(sum(valor_cop) filter (where etapa = 'ganado' and fecha_cierre >= now() - interval '30 days'), 0),
        'valor_30_previo', coalesce(sum(valor_cop) filter (
          where etapa = 'ganado' and fecha_cierre >= now() - interval '60 days' and fecha_cierre < now() - interval '30 days'
        ), 0),
        'ganadas_90', count(*) filter (where etapa = 'ganado' and fecha_cierre >= now() - interval '90 days'),
        'cerradas_90', count(*) filter (where etapa in ('ganado', 'perdido') and fecha_cierre >= now() - interval '90 days'),
        'abiertas', count(*) filter (where etapa not in ('ganado', 'perdido')),
        'pipeline', coalesce(sum(valor_cop) filter (where etapa not in ('ganado', 'perdido')), 0),
        'pipeline_ponderado', coalesce(round(sum(valor_cop * probabilidad / 100.0) filter (
          where etapa not in ('ganado', 'perdido')
        )), 0),
        'sin_seguimiento', (select count(*) from seguimiento where dias >= 7)
      )
      from oportunidades
    ),
    'por_mes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'mes', to_char(m.mes, 'YYYY-MM'),
        'ventas', coalesce(g.ventas, 0),
        'valor', coalesce(g.valor, 0)
      ) order by m.mes), '[]'::jsonb)
      from meses m left join ganadas_por_mes g using (mes)
    ),
    'embudo', (
      select coalesce(jsonb_agg(jsonb_build_object('etapa', etapa, 'ventas', ventas) order by etapa), '[]'::jsonb)
      from embudo
    ),
    'perdidas_por_etapa', (
      select coalesce(jsonb_agg(jsonb_build_object('etapa', etapa_anterior, 'ventas', ventas) order by etapa_anterior), '[]'::jsonb)
      from (
        select etapa_anterior, count(*) as ventas
        from ultima_perdida
        where etapa_anterior is not null
        group by etapa_anterior
      ) p
    ),
    'motivos', (
      select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo_perdida, 'ventas', ventas) order by ventas desc), '[]'::jsonb)
      from (
        select motivo_perdida, count(*) as ventas
        from oportunidades where etapa = 'perdido'
        group by motivo_perdida
      ) m
    ),
    'canales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'canal', canal_origen, 'leads', leads, 'ganadas', ganadas, 'cerradas', cerradas, 'valor', valor
      ) order by leads desc), '[]'::jsonb)
      from (
        select c.canal_origen,
          count(*) as leads,
          count(*) filter (where o.etapa = 'ganado') as ganadas,
          count(*) filter (where o.etapa in ('ganado', 'perdido')) as cerradas,
          coalesce(sum(o.valor_cop) filter (where o.etapa = 'ganado'), 0) as valor
        from oportunidades o join contactos c on c.id = o.contacto_id
        where o.tipo = 'nueva' -- las ampliaciones no son leads nuevos
        group by c.canal_origen
      ) x
    ),
    'asesores', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', p.nombre, 'ciudad', p.ciudad, 'abiertas', x.abiertas, 'ganadas', x.ganadas,
        'cerradas', x.cerradas, 'valor', x.valor,
        'sin_seguimiento', (select count(*) from seguimiento s where s.asesor_id = p.id and s.dias >= 7)
      ) order by x.valor desc), '[]'::jsonb)
      from perfiles p
      join lateral (
        select
          count(*) filter (where etapa not in ('ganado', 'perdido')) as abiertas,
          count(*) filter (where etapa = 'ganado') as ganadas,
          count(*) filter (where etapa in ('ganado', 'perdido')) as cerradas,
          coalesce(sum(valor_cop) filter (where etapa = 'ganado'), 0) as valor
        from oportunidades where asesor_id = p.id
      ) x on true
      where p.rol = 'asesor'
    )
  ) into resultado;

  return resultado;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Los resúmenes de cada día y qué se avisó
-- ---------------------------------------------------------------------------

-- Un resumen por persona y por día (hora de Bogotá). Lo reserva una ejecución de n8n, que lo
-- confirma al enviarlo o lo suelta si el correo falló
create table resumenes_seguimiento (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  destinatario_id uuid not null references perfiles (id),
  ejecucion text,
  reservado_en timestamptz,
  enviado_en timestamptz,
  -- Lo que lleva el resumen; al confirmarlo se reemplaza por la cantidad (no se guardan nombres de más)
  contenido jsonb not null,
  unique (dia, destinatario_id)
);

-- Qué se le avisó a quién. Una venta (o una tarea sin venta) vuelve a avisarse si cambia su última
-- actividad (revivió y se volvió a enfriar) o su destinatario (se la pasaron a otro asesor)
create table avisos_seguimiento (
  id bigint generated always as identity primary key,
  oportunidad_id uuid references oportunidades (id) on delete cascade,
  actividad_id uuid references actividades (id) on delete cascade,
  nivel smallint not null check (nivel in (3, 7)),
  destinatario_id uuid not null references perfiles (id),
  ultima_actividad timestamptz not null,
  resumen_id uuid not null references resumenes_seguimiento (id),
  avisado_en timestamptz not null default now(),
  constraint venta_o_tarea check ((oportunidad_id is null) <> (actividad_id is null)),
  unique nulls not distinct (oportunidad_id, actividad_id, nivel, destinatario_id, ultima_actividad)
);

-- Sin reglas de RLS: nadie del CRM las lee; solo las funciones de abajo, con la llave de servicio
alter table resumenes_seguimiento enable row level security;
alter table avisos_seguimiento enable row level security;
revoke all on resumenes_seguimiento, avisos_seguimiento from anon, authenticated;

-- Reserva los resúmenes de hoy que faltan y los devuelve con lo que llevan. Cada persona recibe uno al
-- día: si ya salió, lo nuevo espera a mañana. Una reserva sin confirmar en 30 minutos se da por
-- abandonada (n8n se detuvo) y la toma la siguiente ejecución; la misma ejecución que vuelve a pedir
-- (porque se perdió la respuesta) recibe otra vez la suya.
create function tomar_resumenes_seguimiento(p_ejecucion text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Bogota')::date;
  gerente_id uuid;
  resultado jsonb;
begin
  if coalesce(trim(p_ejecucion), '') = '' then
    raise exception 'Falta la ejecución' using errcode = '22023';
  end if;
  -- Un turno: dos ejecuciones a la vez no arman el mismo resumen
  perform pg_advisory_xact_lock(hashtext('resumenes_de_seguimiento'));

  -- La gerente que recibe los avisos de 7 días y lo de los asesores inactivos (la misma regla de la captura)
  select id into gerente_id from perfiles where rol = 'gerente' and activo order by codigo limit 1;

  with
  ventas as (
    select s.*, o.nombre as venta, c.codigo as contacto, coalesce(c.empresa, c.nombre) as cliente,
      p.nombre as asesor, p.activo as asesor_activo
    from seguimiento_ventas s
    join oportunidades o on o.id = s.oportunidad_id
    join contactos c on c.id = s.contacto_id
    join perfiles p on p.id = s.asesor_id
  ),
  candidatos as (
    -- 3+ días: al asesor de la venta, o a la gerente si ya no está activo
    select case when v.asesor_activo then v.asesor_id else gerente_id end as destinatario_id,
      v.oportunidad_id, null::uuid as actividad_id, 3 as nivel, v.ultima_actividad,
      jsonb_build_object('tipo', 'venta', 'codigo', v.codigo, 'contacto', v.contacto, 'cliente', v.cliente,
        'etapa', v.etapa, 'dias', v.dias, 'asesor', v.asesor, 'asesor_activo', v.asesor_activo) as detalle
    from ventas v where v.dias >= 3
    union all
    -- 7+ días: a la gerente
    select gerente_id, v.oportunidad_id, null, 7, v.ultima_actividad,
      jsonb_build_object('tipo', 'venta', 'codigo', v.codigo, 'contacto', v.contacto, 'cliente', v.cliente,
        'etapa', v.etapa, 'dias', v.dias, 'asesor', v.asesor, 'asesor_activo', v.asesor_activo)
    from ventas v where v.dias >= 7
    union all
    -- Tareas pendientes sin venta, vencidas hace 3+ días (por ejemplo, "el cliente volvió a escribir"):
    -- a quien la tiene, o a la gerente si ya no está activo
    select case when p.activo then p.id else gerente_id end, null, a.id, 3, a.fecha,
      jsonb_build_object('tipo', 'tarea', 'descripcion', left(a.descripcion, 200), 'contacto', c.codigo,
        'cliente', coalesce(c.empresa, c.nombre), 'dias', floor(extract(epoch from now() - a.fecha) / 86400)::integer,
        'asesor', p.nombre, 'asesor_activo', p.activo)
    from actividades a
    join perfiles p on p.id = a.usuario_id
    join contactos c on c.id = a.contacto_id
    where a.tipo = 'tarea' and not a.completada and a.oportunidad_id is null and a.fecha <= now() - interval '3 days'
  ),
  -- Lo que todavía no se le ha avisado a esa persona con esa misma última actividad
  nuevos as (
    select k.* from candidatos k
    where k.destinatario_id is not null
      and not exists (
        select 1 from avisos_seguimiento x
        where x.oportunidad_id is not distinct from k.oportunidad_id
          and x.actividad_id is not distinct from k.actividad_id
          and x.nivel = k.nivel and x.destinatario_id = k.destinatario_id
          and x.ultima_actividad = k.ultima_actividad
      )
  ),
  armados as (
    select n.destinatario_id, jsonb_build_object(
      'items', jsonb_agg(n.detalle || jsonb_build_object(
          'nivel', n.nivel, 'oportunidad_id', n.oportunidad_id, 'actividad_id', n.actividad_id,
          'ultima_actividad', n.ultima_actividad
        ) order by n.nivel desc, (n.detalle->>'dias')::integer desc),
      -- Para dar contexto: cuántas ventas tiene esa persona con 3+ días (lo nuevo y lo ya avisado)
      'total_3', (select count(*) from ventas v where v.asesor_id = n.destinatario_id and v.dias >= 3),
      -- Para la gerente: cuántas lleva cada asesor con 7+ días
      'total_7_por_asesor', case when n.destinatario_id = gerente_id then (
        select coalesce(jsonb_object_agg(asesor, cuantas), '{}'::jsonb)
        from (select asesor, count(*) as cuantas from ventas where dias >= 7 group by asesor) t
      ) end
    ) as contenido
    from nuevos n
    group by n.destinatario_id
  ),
  tomados as (
    insert into resumenes_seguimiento as r (dia, destinatario_id, ejecucion, reservado_en, contenido)
    select hoy, a.destinatario_id, p_ejecucion, now(), a.contenido from armados a
    on conflict (dia, destinatario_id) do update
      set ejecucion = excluded.ejecucion, reservado_en = excluded.reservado_en, contenido = excluded.contenido
      -- Solo si no ha salido y nadie más lo tiene: libre, abandonado o de esta misma ejecución
      where r.enviado_en is null
        and (r.reservado_en is null or r.reservado_en < now() - interval '30 minutes' or r.ejecucion = p_ejecucion)
    returning r.id, r.destinatario_id, r.contenido
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'destinatario', jsonb_build_object('nombre', p.nombre, 'email', p.email, 'rol', p.rol),
    'es_gerente', t.destinatario_id = gerente_id
  ) || t.contenido order by p.codigo), '[]'::jsonb)
  into resultado
  from tomados t join perfiles p on p.id = t.destinatario_id;

  return jsonb_build_object('dia', hoy, 'resumenes', resultado);
end;
$$;

-- El resumen salió: se anota qué se avisó y se borra el detalle. true también si ya estaba confirmado
-- por esta misma ejecución (n8n puede repetir la confirmación si se perdió la respuesta)
create function confirmar_resumen(p_resumen uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  resumen resumenes_seguimiento%rowtype;
begin
  update resumenes_seguimiento set enviado_en = now()
  where id = p_resumen and ejecucion = p_ejecucion and enviado_en is null
  returning * into resumen;
  if not found then
    return exists (select 1 from resumenes_seguimiento where id = p_resumen and ejecucion = p_ejecucion and enviado_en is not null);
  end if;

  insert into avisos_seguimiento (oportunidad_id, actividad_id, nivel, destinatario_id, ultima_actividad, resumen_id)
  select (i->>'oportunidad_id')::uuid, (i->>'actividad_id')::uuid, (i->>'nivel')::smallint,
    resumen.destinatario_id, (i->>'ultima_actividad')::timestamptz, resumen.id
  from jsonb_array_elements(resumen.contenido->'items') i
  -- Si la venta o la tarea se borró mientras tanto, no hay nada que anotar
  where exists (select 1 from oportunidades where id = (i->>'oportunidad_id')::uuid)
     or exists (select 1 from actividades where id = (i->>'actividad_id')::uuid)
  on conflict do nothing;

  update resumenes_seguimiento
  set contenido = jsonb_build_object('cantidad', jsonb_array_length(resumen.contenido->'items'))
  where id = resumen.id;
  return true;
end;
$$;

-- El correo falló: el resumen queda libre para la hora siguiente
create function soltar_resumen(p_resumen uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update resumenes_seguimiento set ejecucion = null, reservado_en = null
  where id = p_resumen and ejecucion = p_ejecucion and enviado_en is null;
  return found;
end;
$$;

revoke execute on function tomar_resumenes_seguimiento(text) from public, anon, authenticated;
revoke execute on function confirmar_resumen(uuid, text) from public, anon, authenticated;
revoke execute on function soltar_resumen(uuid, text) from public, anon, authenticated;
grant execute on function tomar_resumenes_seguimiento(text) to service_role;
grant execute on function confirmar_resumen(uuid, text) to service_role;
grant execute on function soltar_resumen(uuid, text) to service_role;
