-- Corrige panel_gerente() (migración 003) tras la revisión de código:
-- 1. Embudo: cada venta cuenta en la etapa más alta que alcanzó y en todas las anteriores,
--    aunque se haya saltado etapas (antes solo contaban las etapas anotadas en el historial).
--    Las etapas sin ventas aparecen con 0 en vez de desaparecer.
-- 2. Las listas vacías se devuelven como [] (jsonb_agg devuelve null si no hay filas).
-- 3. "Pérdidas por etapa" cuenta solo las ventas perdidas hoy, desde su última pérdida,
--    para que cuadre con "motivos".

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
  abiertas as (
    select * from oportunidades where etapa not in ('ganado', 'perdido')
  ),
  -- Última actividad realizada de cada venta abierta (o su creación, si no tiene ninguna)
  ultima_actividad as (
    select o.id, o.asesor_id,
      coalesce(
        (select max(a.fecha) from actividades a where a.oportunidad_id = o.id and a.completada),
        o.creada_en
      ) as fecha
    from abiertas o
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
        'sin_seguimiento', (select count(*) from ultima_actividad where fecha < now() - interval '7 days')
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
        'sin_seguimiento', (
          select count(*) from ultima_actividad u where u.asesor_id = p.id and u.fecha < now() - interval '7 days'
        )
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
