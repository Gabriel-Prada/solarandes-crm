-- Ajustes al seguimiento (migración 016), encontrados en la revisión del código.
--
-- 1. Sin una gerente activa, los avisos de 7+ días y lo de los asesores inactivos no tenían a quién
--    llegar y se descartaban en silencio. Ahora la respuesta dice sin_gerente y el flujo 03 hace sonar
--    la alarma.
-- 2. Una tarea sin venta del técnico o la contadora le llegaba a alguien que no puede abrir la ficha
--    del contacto: ahora va al asesor del contacto.
-- 3. Los resúmenes de días anteriores que nunca salieron se borran: guardaban nombres de clientes que
--    nadie iba a usar.

create or replace function tomar_resumenes_seguimiento(p_ejecucion text) returns jsonb
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

  -- Los resúmenes de días anteriores que nunca salieron (soltados o abandonados) ya no van a salir:
  -- se borran para no guardar nombres de clientes de más. Lo que traían vuelve a salir hoy
  delete from resumenes_seguimiento where enviado_en is null and dia < hoy;

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
    -- a quien la tiene si es asesor o gerente y está activo; si no (el técnico o la contadora no pueden
    -- abrir la ficha del contacto, o ya no está), al asesor del contacto; si tampoco está, a la gerente
    select case
        when p.activo and p.rol in ('asesor', 'gerente') then p.id
        when ac.activo then ac.id
        else gerente_id
      end, null, a.id, 3, a.fecha,
      jsonb_build_object('tipo', 'tarea', 'descripcion', left(a.descripcion, 200), 'contacto', c.codigo,
        'cliente', coalesce(c.empresa, c.nombre), 'dias', floor(extract(epoch from now() - a.fecha) / 86400)::integer,
        'asesor', p.nombre, 'asesor_activo', p.activo)
    from actividades a
    join perfiles p on p.id = a.usuario_id
    join contactos c on c.id = a.contacto_id
    join perfiles ac on ac.id = c.asesor_id
    where a.tipo = 'tarea' and not a.completada and a.oportunidad_id is null and a.fecha <= now() - interval '3 days'
  ),
  -- Lo que todavía no se le ha avisado a esa persona con esa misma última actividad
  nuevos as (
    select k.* from candidatos k
    where not exists (
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
    where n.destinatario_id is not null
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

  return jsonb_build_object('dia', hoy, 'resumenes', resultado, 'sin_gerente', gerente_id is null);
end;
$$;

revoke execute on function tomar_resumenes_seguimiento(text) from public, anon, authenticated;
grant execute on function tomar_resumenes_seguimiento(text) to service_role;
