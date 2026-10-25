-- Ajustes al buzón del formulario (migración 014), encontrados en la revisión del código.
--
-- 1. Las reservas atascadas traen también qué ejecución de n8n las tomó: con eso se puede revisar
--    si los avisos salieron (a veces salieron y solo falló la confirmación) antes de reenviarlos.
-- 2. La limpieza de los datos de más de 30 días (Ley 1581) corre también en cada envío del formulario,
--    no solo cuando n8n pregunta: con el PC apagado semanas, los datos no deben quedarse más tiempo.

-- La limpieza, en una sola función que usan las dos
create function borrar_datos_vencidos() returns void
language sql security definer set search_path = public as $$
  update envios_recibidos
  set datos = case when datos ? 'autorizacion' then jsonb_build_object('autorizacion', datos->'autorizacion') end
  where datos is not null and recibido_en < now() - interval '30 days'
    and datos - 'autorizacion' <> '{}'::jsonb
$$;
revoke execute on function borrar_datos_vencidos() from public, anon, authenticated;

create or replace function permitir_envio_formulario(p_huella text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('limite_del_formulario'));
  delete from intentos_formulario where en < now() - interval '24 hours';
  perform borrar_datos_vencidos();

  if (select count(*) from intentos_formulario where huella = p_huella and en > now() - interval '10 minutes') >= 5 then
    return 'huella';
  end if;
  if (select count(*) from intentos_formulario where en > now() - interval '1 hour') >= 60 then
    return 'hora';
  end if;
  if (select count(*) from intentos_formulario where en > now() - interval '24 hours') >= 100 then
    return 'dia';
  end if;

  insert into intentos_formulario (huella) values (p_huella);
  return 'ok';
end;
$$;

create or replace function avisos_pendientes(p_limite integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  perform borrar_datos_vencidos();

  select jsonb_build_object(
    -- Registrados en los últimos 7 días que nadie ha reservado para avisar; los más viejos primero
    'pendientes', coalesce((
      select jsonb_agg(jsonb_build_object('clave', clave, 'cuerpo', datos, 'respuesta', respuesta) order by recibido_en)
      from (
        select clave, datos, respuesta, recibido_en from envios_recibidos
        where avisos_reservados_en is null and contacto_id is not null and respuesta is not null
          and recibido_en > now() - interval '7 days'
        order by recibido_en
        limit least(greatest(p_limite, 1), 50)
      ) p
    ), '[]'::jsonb),
    -- Reservados hace más de 15 minutos y sin confirmar, con la ejecución que los reservó
    'atascados', coalesce((
      select jsonb_agg(jsonb_build_object('clave', clave, 'ejecucion', avisos_reservados_por) order by avisos_reservados_en)
      from envios_recibidos
      where avisos_enviados_en is null and avisos_reservados_en < now() - interval '15 minutes'
        and avisos_reservados_en > now() - interval '7 days'
    ), '[]'::jsonb),
    -- Cuántos envíos lleva el formulario, para que n8n avise cuando se alcance un tope
    'formulario', jsonb_build_object(
      'ultima_hora', (select count(*) from intentos_formulario where en > now() - interval '1 hour'),
      'ultimo_dia', (select count(*) from intentos_formulario where en > now() - interval '24 hours'),
      'tope_hora', 60,
      'tope_dia', 100
    )
  ) into resultado;
  return resultado;
end;
$$;
