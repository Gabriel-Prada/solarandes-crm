-- Dos huecos de la reserva de avisos (migración 012), encontrados en la revisión de código.
--
-- 1. "Ya procesado" respondía incompleto (sin asesor_inactivo, fuera_de_ciudad, duda ni nuevo) y con
--    el asesor guardado en el contacto, no con quien atiende. Si el mismo envío llega dos veces y la
--    reserva la gana la ejecución que recibió "ya procesado", sus avisos salían mal (por ejemplo, al
--    asesor que ya renunció). Ahora el radicado guarda la respuesta completa de la primera vez y
--    "ya procesado" la repite tal cual: las dos ejecuciones ven exactamente lo mismo.
--
-- 2. Si la reserva quedaba hecha pero su respuesta se perdía (se cortó la conexión), el reintento
--    recibía "no" y nadie avisaba. Ahora la reserva guarda quién la hizo (el número de la ejecución
--    de n8n) y le vuelve a decir "sí" a esa misma ejecución.

alter table envios_recibidos add column respuesta jsonb;
alter table envios_recibidos add column avisos_reservados_por text;

-- 1. Un envoltorio: la función de la 010 queda adentro, sin cambios, con otro nombre, y solo la
--    usa el envoltorio (nadie más tiene permiso de llamarla)
alter function capturar_lead(text, canal_origen, jsonb, text, text, text) rename to registrar_lead_interno;
revoke execute on function registrar_lead_interno(text, canal_origen, jsonb, text, text, text)
  from public, anon, authenticated, service_role;

create function capturar_lead(
  p_clave text,
  p_canal canal_origen,
  p_contacto jsonb,
  p_mensaje text default null,
  p_existente text default null,
  p_duda text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  captura jsonb := registrar_lead_interno(p_clave, p_canal, p_contacto, p_mensaje, p_existente, p_duda);
  previo envios_recibidos%rowtype;
begin
  if captura->>'resultado' <> 'ya_procesado' then
    -- Primera vez: se guarda la respuesta completa en el radicado (en la misma operación)
    update envios_recibidos set respuesta = captura where clave = p_clave;
    return captura;
  end if;
  -- Ya procesado: se repite la respuesta de la primera vez, avisando que es una repetición
  select * into previo from envios_recibidos where clave = p_clave;
  if previo.respuesta is null then
    return captura; -- un radicado de antes de esta migración
  end if;
  return previo.respuesta
    || jsonb_build_object('resultado', 'ya_procesado', 'resultado_original', previo.resultado);
end;
$$;

revoke execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) to service_role;

-- 2. La reserva reconoce a su dueño: true si está libre o si ya era de esta misma ejecución
drop function reservar_avisos(text);

create function reservar_avisos(p_clave text, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- El update toma la fila con candado: si dos llegan juntas, la segunda espera y ya no la encuentra libre
  update envios_recibidos
  set avisos_reservados_en = now(), avisos_reservados_por = p_ejecucion
  where clave = p_clave
    and (avisos_reservados_en is null or (p_ejecucion is not null and avisos_reservados_por = p_ejecucion));
  return found;
end;
$$;

revoke execute on function reservar_avisos(text, text) from public, anon, authenticated;
grant execute on function reservar_avisos(text, text) to service_role;
