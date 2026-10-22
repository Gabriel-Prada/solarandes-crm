-- Métricas del panel de la gerente, calculadas en la base de datos en una sola llamada.
-- security invoker: corre con los permisos de quien la llama, y además exige el rol de gerente.

create function panel_gerente() returns jsonb
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
  -- Para el embudo: cuántas ventas llegaron a cada etapa (pasar por ella cuenta, aunque luego se pierda)
  embudo as (
    select etapa_nueva as etapa, count(distinct oportunidad_id) as ventas
    from historial_etapas
    where etapa_nueva <> 'perdido'
    group by etapa_nueva
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
      select jsonb_agg(jsonb_build_object(
        'mes', to_char(m.mes, 'YYYY-MM'),
        'ventas', coalesce(g.ventas, 0),
        'valor', coalesce(g.valor, 0)
      ) order by m.mes)
      from meses m left join ganadas_por_mes g using (mes)
    ),
    'embudo', (
      select jsonb_agg(jsonb_build_object('etapa', etapa, 'ventas', ventas) order by etapa)
      from embudo
    ),
    'perdidas_por_etapa', (
      select jsonb_agg(jsonb_build_object('etapa', etapa_anterior, 'ventas', ventas) order by etapa_anterior)
      from (
        select etapa_anterior, count(*) as ventas
        from historial_etapas where etapa_nueva = 'perdido'
        group by etapa_anterior
      ) p
    ),
    'motivos', (
      select jsonb_agg(jsonb_build_object('motivo', motivo_perdida, 'ventas', ventas) order by ventas desc)
      from (
        select motivo_perdida, count(*) as ventas
        from oportunidades where etapa = 'perdido'
        group by motivo_perdida
      ) m
    ),
    'canales', (
      select jsonb_agg(jsonb_build_object(
        'canal', canal_origen, 'leads', leads, 'ganadas', ganadas, 'cerradas', cerradas, 'valor', valor
      ) order by leads desc)
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
      select jsonb_agg(jsonb_build_object(
        'nombre', p.nombre, 'ciudad', p.ciudad, 'abiertas', x.abiertas, 'ganadas', x.ganadas,
        'cerradas', x.cerradas, 'valor', x.valor,
        'sin_seguimiento', (
          select count(*) from ultima_actividad u where u.asesor_id = p.id and u.fecha < now() - interval '7 days'
        )
      ) order by x.valor desc)
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

-- Las funciones nuevas se pueden ejecutar por defecto por cualquiera: se cierra y se abre solo a usuarios con sesión
revoke execute on function panel_gerente() from public, anon;
grant execute on function panel_gerente() to authenticated;
