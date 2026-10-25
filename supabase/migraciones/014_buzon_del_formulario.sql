-- El buzón del formulario web (fase 3, flujo 1). Diseño en docs/plan-fase-3.md, sección 4b.
--
-- El formulario público (/cotiza) vive en el CRM y registra el lead al instante, sin depender de n8n.
-- n8n pregunta cada minuto qué leads no tienen avisos todavía y los manda (con la reserva de la 012/013).
-- Aquí vive lo que no se puede romper: el límite de envíos (con turno, para que muchos envíos a la vez
-- no se cuelen) y qué leads están pendientes de aviso.

-- ---------------------------------------------------------------------------
-- 1. El radicado guarda los datos del envío (para armar los avisos) y cuándo salieron los avisos
-- ---------------------------------------------------------------------------

alter table envios_recibidos add column datos jsonb;
alter table envios_recibidos add column avisos_enviados_en timestamptz;

-- Los radicados de antes de esta migración ya no esperan avisos: son pruebas o leads ya avisados
update envios_recibidos
set avisos_reservados_en = coalesce(avisos_reservados_en, now()),
    avisos_reservados_por = coalesce(avisos_reservados_por, 'migracion-014'),
    avisos_enviados_en = coalesce(avisos_enviados_en, now());

-- ---------------------------------------------------------------------------
-- 2. capturar_lead guarda también los datos del envío, para todas las entradas (formulario, n8n,
--    más adelante WhatsApp). Así los avisos salen completos gane quien gane la reserva.
-- ---------------------------------------------------------------------------

drop function capturar_lead(text, canal_origen, jsonb, text, text, text);

create function capturar_lead(
  p_clave text,
  p_canal canal_origen,
  p_contacto jsonb,
  p_mensaje text default null,
  p_existente text default null,
  p_duda text default null,
  p_datos jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  captura jsonb := registrar_lead_interno(p_clave, p_canal, p_contacto, p_mensaje, p_existente, p_duda);
  previo envios_recibidos%rowtype;
begin
  if captura->>'resultado' <> 'ya_procesado' then
    -- Primera vez: se guardan la respuesta completa y los datos del envío (en la misma operación)
    update envios_recibidos set respuesta = captura, datos = p_datos where clave = p_clave;
    return captura;
  end if;
  -- Ya procesado: se repite la respuesta de la primera vez, avisando que es una repetición
  select * into previo from envios_recibidos where clave = p_clave;
  if previo.respuesta is null then
    return captura; -- un radicado de antes de la migración 013
  end if;
  return previo.respuesta
    || jsonb_build_object('resultado', 'ya_procesado', 'resultado_original', previo.resultado);
end;
$$;

revoke execute on function capturar_lead(text, canal_origen, jsonb, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function capturar_lead(text, canal_origen, jsonb, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. El límite de envíos del formulario. Solo se guarda una huella de la IP (HMAC con una llave
--    secreta, calculada en el CRM), nunca la IP. Los intentos se borran a las 24 horas.
-- ---------------------------------------------------------------------------

create table intentos_formulario (
  id bigint generated always as identity primary key,
  huella text not null check (length(huella) between 16 and 128),
  en timestamptz not null default now()
);
create index on intentos_formulario (huella, en);
create index on intentos_formulario (en);

-- Nadie del equipo la lee ni la escribe directamente
alter table intentos_formulario enable row level security;
revoke all on intentos_formulario from anon, authenticated;

-- 'ok' si el envío puede pasar (y queda anotado); si no, cuál tope se alcanzó:
-- 'huella' (5 cada 10 minutos desde la misma conexión), 'hora' (60 en total) o 'dia' (100 en total).
-- Con turno: si llegan muchos envíos a la vez, se atienden de a uno, así no se cuelan contando "0".
create function permitir_envio_formulario(p_huella text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('limite_del_formulario'));
  delete from intentos_formulario where en < now() - interval '24 hours';

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

-- ---------------------------------------------------------------------------
-- 4. Lo que n8n pregunta cada minuto: leads pendientes de aviso, reservas atascadas y los topes
-- ---------------------------------------------------------------------------

create function avisos_pendientes(p_limite integer default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  -- Ley 1581: los datos copiados no se guardan más de 30 días (queda solo la prueba de la autorización)
  update envios_recibidos
  set datos = case when datos ? 'autorizacion' then jsonb_build_object('autorizacion', datos->'autorizacion') end
  where datos is not null and recibido_en < now() - interval '30 days'
    and datos - 'autorizacion' <> '{}'::jsonb;

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
    -- Reservados hace más de 15 minutos y sin confirmar: n8n se cayó a la mitad. No se reenvían solos
    'atascados', coalesce((
      select jsonb_agg(clave order by avisos_reservados_en)
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

-- ---------------------------------------------------------------------------
-- 5. 01c confirma al terminar de mandar los avisos. Se borran los datos copiados (ya no hacen
--    falta) y queda solo la prueba de la autorización.
-- ---------------------------------------------------------------------------

create function confirmar_avisos(p_clave text, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update envios_recibidos
  set avisos_enviados_en = now(),
      datos = case when datos ? 'autorizacion' then jsonb_build_object('autorizacion', datos->'autorizacion') end
  where clave = p_clave and avisos_reservados_por = p_ejecucion and avisos_enviados_en is null;
  return found;
end;
$$;

revoke execute on function permitir_envio_formulario(text) from public, anon, authenticated;
revoke execute on function avisos_pendientes(integer) from public, anon, authenticated;
revoke execute on function confirmar_avisos(text, text) from public, anon, authenticated;
grant execute on function permitir_envio_formulario(text) to service_role;
grant execute on function avisos_pendientes(integer) to service_role;
grant execute on function confirmar_avisos(text, text) to service_role;
