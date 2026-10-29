-- La calificación de leads con IA (fase 4, pieza 1). Diseño en docs/plan-fase-4.md, sección 4.
--
-- Claude lee el mensaje del lead y llena una ficha; lo que se decide con esa ficha vive aquí:
-- la prioridad, el consumo estimado, la reserva (para no pagar dos veces por el mismo lead),
-- el registro de cada llamada con su costo y el tope diario. El CRM solo hace la llamada a Claude.
--
-- Orden de una calificación:
--   1. capturar_lead crea la fila "por calificar" en la misma operación que registra el lead.
--   2. tomar_calificacion (CRM, cada vez que n8n pregunta): reserva un lead, toma un cupo del tope
--      y anota la llamada "en curso", todo en un paso, ANTES de llamar a Claude.
--   3. guardar_calificacion: completa la llamada (tokens y costo) y guarda la ficha, solo si ese
--      pedido sigue siendo el dueño de la reserva.

-- ---------------------------------------------------------------------------
-- 1. Tipos y reglas (funciones puras: con los mismos datos, siempre la misma respuesta)
-- ---------------------------------------------------------------------------

create type prioridad_lead as enum ('alta', 'media', 'baja', 'no_es_lead');
create type estado_calificacion as enum (
  'por_calificar', -- esperando a Claude
  'en_curso',      -- reservada por un pedido del CRM
  'calificada',    -- ficha guardada
  'sin_mensaje',   -- el mensaje no aporta: no se llama a Claude (prioridad media)
  'rechazada',     -- Claude se negó a procesarlo; no se reintenta
  'fallida',       -- 3 respuestas que no cumplían la ficha; no se reintenta
  'vencida'        -- 7 días sin poder calificarse (Claude caído, sin cupo o n8n apagado)
);

-- La tarifa de referencia para pasar pesos de la factura de luz a kWh. Inventada para el ejercicio.
create function tarifa_referencia_cop_kwh() returns integer
language sql immutable as $$ select 900 $$;

-- El tope de llamadas a la IA por día (hora de Bogotá), para todas las piezas juntas. Por encima de
-- los 100 leads diarios que admite el formulario más sus reintentos.
create function tope_llamadas_ia_dia() returns integer
language sql immutable as $$ select 300 $$;

-- Cuántas veces se intenta calificar un lead, por cualquier motivo, antes de darlo por fallido. Con la
-- espera creciente (1, 2, 4… minutos, máximo una hora) son unas 3 horas: cubre una caída de Claude y
-- nunca deja un lead pagando en un ciclo sin fin.
create function intentos_maximos_calificacion() returns integer
language sql immutable as $$ select 8 $$;

-- ¿Vale la pena mandarle el mensaje a Claude? No si está vacío o solo trae saludos ("hola, buenas,
-- info"): se quitan esas palabras y deben quedar al menos 3 letras o números.
create function mensaje_aporta(p_mensaje text) returns boolean
language sql immutable as $$
  select coalesce(sum(length(palabra)), 0) >= 3
  from regexp_split_to_table(translate(lower(coalesce(p_mensaje, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+') palabra
  where palabra <> ''
    and palabra not in (
      'hola', 'ola', 'buenas', 'buenos', 'buen', 'buena', 'dia', 'dias', 'tardes', 'noches', 'saludos',
      'info', 'informacion', 'gracias', 'ok', 'hi', 'hello', 'porfa', 'favor', 'por'
    )
$$;

-- ¿La ficha que devolvió Claude tiene la forma acordada? (la API ya lo garantiza; esto es el cinturón)
create function ficha_valida(p_ficha jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_ficha) = 'object'
    and jsonb_typeof(p_ficha->'es_lead') = 'boolean'
    and p_ficha->>'tipo_cliente' in ('hogar', 'negocio', 'no_se_sabe')
    and p_ficha->>'urgencia' in ('alta', 'media', 'baja', 'no_se_sabe')
    and p_ficha->>'intencion' in ('quiere_sistema', 'solo_informacion', 'otra')
    and coalesce(jsonb_typeof(p_ficha->'consumo_kwh_mes'), 'null') in ('number', 'null')
    and coalesce(jsonb_typeof(p_ficha->'factura_luz_cop'), 'null') in ('number', 'null')
    and jsonb_typeof(p_ficha->'resumen') = 'string'
    and length(p_ficha->>'resumen') <= 140
$$;

-- Un número de la ficha o del formulario, solo si es razonable (si no, no dice nada)
create function numero_razonable(p_valor jsonb, p_maximo numeric) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(p_valor) = 'number' and (p_valor::text)::numeric > 0
                   and (p_valor::text)::numeric <= p_maximo
              then (p_valor::text)::numeric end
$$;

-- El consumo que se usa para la regla: el del formulario si lo hay (es un dato estructurado); si no,
-- el que diga el mensaje; si solo dice cuánto paga de luz, pesos ÷ la tarifa de referencia.
create function consumo_estimado(p_ficha jsonb, p_entrada jsonb) returns integer
language sql immutable as $$
  select round(coalesce(
    numero_razonable(p_entrada->'consumo_kwh_mes', 100000),
    numero_razonable(p_ficha->'consumo_kwh_mes', 100000),
    numero_razonable(p_ficha->'factura_luz_cop', 100000000) / tarifa_referencia_cop_kwh()
  ))::integer
$$;

-- La regla de prioridad (decisión D del plan). Se revisa en este orden y gana la primera que se cumpla.
-- Sin ficha (el mensaje no aportaba) se usan los datos del formulario: quien llena "cotiza" quiere un
-- sistema, así que una empresa o un consumo de 500 kWh o más es alta; lo demás, media (no hay urgencia).
create function prioridad_regla(p_ficha jsonb, p_entrada jsonb) returns prioridad_lead
language sql immutable as $$
  select case
    when p_ficha is null then
      case when coalesce((p_entrada->>'es_empresa')::boolean, false)
                or coalesce(consumo_estimado(null, p_entrada), 0) >= 500 then 'alta' else 'media' end
    when (p_ficha->>'es_lead')::boolean is false then 'no_es_lead'
    when p_ficha->>'intencion' = 'quiere_sistema' and (
           p_ficha->>'urgencia' = 'alta'
           or coalesce(consumo_estimado(p_ficha, p_entrada), 0) >= 500
           or coalesce((p_entrada->>'es_empresa')::boolean, false)
           or p_ficha->>'tipo_cliente' = 'negocio'
         ) then 'alta'
    when p_ficha->>'intencion' = 'solo_informacion'
         or (p_ficha->>'urgencia' = 'baja' and consumo_estimado(p_ficha, p_entrada) < 150) then 'baja'
    else 'media'
  end::prioridad_lead
$$;

-- ---------------------------------------------------------------------------
-- 2. Las tablas
-- ---------------------------------------------------------------------------

-- Una fila por mensaje de lead (la clave del envío): así un mensaje se califica (y se paga) una vez.
create table calificaciones_lead (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique references envios_recibidos (clave) on delete cascade,
  contacto_id uuid not null references contactos (id) on delete cascade,
  oportunidad_id uuid references oportunidades (id) on delete set null, -- solo si el lead es nuevo
  tarea_id uuid references actividades (id) on delete set null,         -- la tarea "Contactar…"
  captura text not null check (captura in ('creado', 'existente', 'revision')),
  estado estado_calificacion not null,
  -- Lo que se le manda a Claude: nunca nombre, celular ni correo. El mensaje se borra al terminar.
  entrada jsonb not null,
  ficha jsonb check (ficha is null or ficha_valida(ficha)),
  modelo text,
  version_prompt text,
  intentos smallint not null default 0,
  respuestas_invalidas smallint not null default 0,
  proximo_intento_en timestamptz not null default now(),
  -- La reserva: el dueño es cada pedido del CRM (un número nuevo por pedido), no la ejecución de n8n
  reservada_por uuid,
  reservada_hasta timestamptz,
  -- La prioridad que puso el asesor, aparte de la de la regla. Quién y cuándo los pone la base.
  prioridad_asesor prioridad_lead,
  prioridad_asesor_por uuid references perfiles (id),
  prioridad_asesor_en timestamptz,
  -- El aviso de "lead prioritario" (con su propia reserva, como los avisos de la fase 3)
  aviso_reservado_por text,
  aviso_reservado_en timestamptz,
  aviso_enviado_en timestamptz,
  creada_en timestamptz not null default now(),
  calificada_en timestamptz
);
create index on calificaciones_lead (estado, proximo_intento_en);
create index on calificaciones_lead (contacto_id);
create index on calificaciones_lead (oportunidad_id);

-- Cada llamada a la IA, con su costo. Solo números: nunca lo que se envió ni lo que respondió.
create table llamadas_ia (
  id uuid primary key default gen_random_uuid(),
  pieza text not null check (pieza in ('calificacion', 'factura')),
  referencia uuid,
  modelo text not null check (length(modelo) between 1 and 80),
  estado text not null default 'en_curso'
    check (estado in ('en_curso', 'ok', 'rechazo', 'invalida', 'error', 'posiblemente_cobrada')),
  tokens_entrada integer check (tokens_entrada >= 0),
  tokens_salida integer check (tokens_salida >= 0),
  costo_usd numeric(10, 6) check (costo_usd >= 0),
  duracion_ms integer check (duracion_ms >= 0),
  error text check (length(error) <= 200),
  iniciada_en timestamptz not null default now(),
  terminada_en timestamptz
);
create index on llamadas_ia (iniciada_en);
create index on llamadas_ia (referencia);

-- Permisos: el asesor ve las calificaciones de sus contactos y la gerente todas; las llamadas (los
-- costos), solo la gerente. Nadie del equipo escribe directo: solo por las funciones.
alter table calificaciones_lead enable row level security;
alter table llamadas_ia enable row level security;
revoke all on calificaciones_lead, llamadas_ia from anon, authenticated, service_role;
grant select on calificaciones_lead, llamadas_ia to authenticated;

create policy calificaciones_ver on calificaciones_lead for select to authenticated
  using ((select mi_rol()) = 'gerente' or es_mi_contacto(contacto_id));
create policy llamadas_ver on llamadas_ia for select to authenticated
  using ((select mi_rol()) = 'gerente');

-- Lo que ve el CRM: la prioridad que se muestra es la del asesor si la puso; si no, la de la regla,
-- calculada al consultar (si la regla cambia, aplica sola a todas, sin volver a pagar a Claude).
-- security_invoker: la vista corre con los permisos de quien mira.
create view prioridades_leads with (security_invoker = true) as
select
  c.id,
  c.contacto_id,
  c.oportunidad_id,
  c.tarea_id,
  c.captura,
  c.estado,
  c.ficha->>'resumen' as resumen,
  consumo_estimado(c.ficha, c.entrada) as consumo_estimado,
  case when c.estado in ('calificada', 'sin_mensaje') then prioridad_regla(c.ficha, c.entrada) end as prioridad_regla,
  c.prioridad_asesor,
  coalesce(
    c.prioridad_asesor,
    case when c.estado in ('calificada', 'sin_mensaje') then prioridad_regla(c.ficha, c.entrada) end
  ) as prioridad,
  c.prioridad_asesor_por,
  c.prioridad_asesor_en,
  c.modelo,
  c.version_prompt,
  c.intentos,
  c.creada_en,
  c.calificada_en
from calificaciones_lead c;

grant select on prioridades_leads to authenticated;
revoke all on prioridades_leads from anon;

-- ---------------------------------------------------------------------------
-- 3. La calificación nace con el lead: capturar_lead la crea en la misma operación
-- ---------------------------------------------------------------------------

-- Solo la usa capturar_lead. Califica cuando se creó un lead nuevo (con venta) o cuando un cliente
-- que ya existía escribe algo que aporta. No califica 'revision' sin venta: la nota quedó en la ficha
-- de otra persona (la que ya tenía ese celular) y le pegaría la prioridad al cliente equivocado.
create function crear_calificacion(
  p_clave text, p_captura jsonb, p_contacto jsonb, p_mensaje text, p_tareas_previas uuid[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_contacto uuid;
  v_venta uuid;
  v_tarea uuid;
  aporta boolean := mensaje_aporta(p_mensaje);
  consumo numeric := numero_razonable(to_jsonb(round(nullif(p_contacto->>'consumo_kwh_mes', '')::numeric)), 100000);
begin
  if not ((p_captura->>'nuevo')::boolean or (p_captura->>'resultado' = 'existente' and aporta)) then
    return;
  end if;

  select contacto_id into v_contacto from envios_recibidos where clave = p_clave;
  -- Lo que registrar_lead_interno acaba de crear: en un lead nuevo, su única venta; la tarea, la que
  -- no estaba antes de registrar (un cliente que vuelve ya tiene tareas viejas)
  if (p_captura->>'nuevo')::boolean then
    select id into v_venta from oportunidades where contacto_id = v_contacto order by codigo desc limit 1;
  end if;
  select id into v_tarea from actividades
  where contacto_id = v_contacto and tipo = 'tarea' and id <> all(p_tareas_previas)
    and creada_en = now() -- dentro de una operación, now() es siempre la misma hora: solo la de esta
  order by fecha desc limit 1;

  insert into calificaciones_lead (clave, contacto_id, oportunidad_id, tarea_id, captura, estado, entrada)
  values (
    p_clave, v_contacto, v_venta, v_tarea, p_captura->>'resultado',
    case when aporta then 'por_calificar' else 'sin_mensaje' end::estado_calificacion,
    jsonb_strip_nulls(jsonb_build_object(
      'mensaje', case when aporta then left(trim(p_mensaje), 2000) end,
      'ciudad', p_contacto->>'ciudad',
      'consumo_kwh_mes', consumo,
      'es_empresa', nullif(trim(p_contacto->>'empresa'), '') is not null
    ))
  );
end;
$$;

revoke execute on function crear_calificacion(text, jsonb, jsonb, text, uuid[]) from public, anon, authenticated, service_role;

-- El envoltorio de la 014, igual, más la calificación
create or replace function capturar_lead(
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
  -- Las tareas que ya tenía el cliente que vuelve (se anotan ANTES de registrar: así la calificación
  -- apunta a la tarea nueva sin depender de la hora)
  tareas_previas uuid[] := coalesce((
    select array_agg(a.id) from actividades a join contactos c on c.id = a.contacto_id
    where c.codigo = p_existente and a.tipo = 'tarea'
  ), '{}');
  captura jsonb := registrar_lead_interno(p_clave, p_canal, p_contacto, p_mensaje, p_existente, p_duda);
  previo envios_recibidos%rowtype;
begin
  if captura->>'resultado' <> 'ya_procesado' then
    -- Primera vez: se guardan la respuesta completa y los datos del envío, y nace la calificación
    -- (todo en la misma operación: o queda todo, o nada)
    update envios_recibidos set respuesta = captura, datos = p_datos where clave = p_clave;
    perform crear_calificacion(p_clave, captura, p_contacto, p_mensaje, tareas_previas);
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

-- ---------------------------------------------------------------------------
-- 4. Tomar un lead para calificar: reserva + cupo + llamada anotada, en un solo paso
-- ---------------------------------------------------------------------------

-- Leads que llevan más de 30 minutos esperando su prioridad: la señal para la alarma de n8n
-- (cubre Claude caído, sin cupo y un error del CRM). Una sola alarma general, no una por lead.
create function calificaciones_atrasadas() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from calificaciones_lead
  where estado in ('por_calificar', 'en_curso') and creada_en < now() - interval '30 minutes'
$$;

-- La espera antes del siguiente intento, según cuántos lleva: 1, 2, 4, 8… minutos, máximo una hora
create function espera_calificacion(p_intentos integer) returns interval
language sql immutable as $$
  select least(power(2, greatest(p_intentos - 1, 0)), 60) * interval '1 minute'
$$;

-- 7 días sin poder calificarse: queda visible como vencida, y la copia del mensaje se borra. Corre al
-- tomar y también en cada envío del formulario (borrar_datos_vencidos): con n8n apagado semanas, la copia
-- no se queda guardada.
create function vencer_calificaciones() returns void
language sql security definer set search_path = public as $$
  update calificaciones_lead set estado = 'vencida', entrada = entrada - 'mensaje'
  where estado = 'por_calificar' and creada_en < now() - interval '7 days'
$$;

create or replace function borrar_datos_vencidos() returns void
language sql security definer set search_path = public as $$
  update envios_recibidos
  set datos = case when datos ? 'autorizacion' then jsonb_build_object('autorizacion', datos->'autorizacion') end
  where datos is not null and recibido_en < now() - interval '30 days'
    and datos - 'autorizacion' <> '{}'::jsonb;
  select vencer_calificaciones();
$$;

-- Las llamadas de hoy (hora de Bogotá) que cuentan para el tope: todas, menos las que la API rechazó sin
-- procesar (un código HTTP de error o sin conexión: esas no se cobran). Un tiempo agotado sí cuenta:
-- quizá Claude alcanzó a responder y se cobró.
create function llamadas_ia_de_hoy() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from llamadas_ia
  where iniciada_en >= date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
    and not (estado = 'error' and (error like 'http\_%' or error = 'sin_conexion'))
$$;

create function tomar_calificacion(p_pedido uuid, p_modelo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fila calificaciones_lead%rowtype;
  llamada uuid;
begin
  if p_pedido is null or coalesce(length(p_modelo), 0) not between 1 and 80 then
    raise exception 'Pedido o modelo inválido' using errcode = '22023';
  end if;
  -- Un turno para todo lo que llama a la IA (también el extractor de facturas, cuando llegue): si llegan
  -- dos pedidos a la vez, se atienden de a uno y nadie se salta el tope
  perform pg_advisory_xact_lock(hashtext('llamadas_ia'));

  -- Reservas vencidas: el pedido se cortó a la mitad (Vercel lo cortó o el CRM falló). La llamada quizá
  -- se cobró. Vuelve a la fila con la misma espera creciente, o se da por fallida si ya agotó los intentos.
  update llamadas_ia l set estado = 'posiblemente_cobrada', terminada_en = now()
  from calificaciones_lead c
  where l.estado = 'en_curso' and l.referencia = c.id and c.estado = 'en_curso' and c.reservada_hasta < now();
  update calificaciones_lead
  set estado = case when intentos >= intentos_maximos_calificacion() then 'fallida' else 'por_calificar' end::estado_calificacion,
      entrada = case when intentos >= intentos_maximos_calificacion() then entrada - 'mensaje' else entrada end,
      reservada_por = null, reservada_hasta = null,
      proximo_intento_en = now() + espera_calificacion(intentos)
  where estado = 'en_curso' and reservada_hasta < now();

  perform vencer_calificaciones();

  -- El tope del día
  if llamadas_ia_de_hoy() >= tope_llamadas_ia_dia() then
    return jsonb_build_object('estado', 'sin_cupo', 'atrasadas', calificaciones_atrasadas());
  end if;

  select * into fila from calificaciones_lead
  where estado = 'por_calificar' and proximo_intento_en <= now()
  order by creada_en
  limit 1
  for update;
  if not found then
    return jsonb_build_object('estado', 'nada', 'atrasadas', calificaciones_atrasadas());
  end if;

  -- La llamada se anota ANTES de llamar: si después se corta todo, igual queda contada
  insert into llamadas_ia (pieza, referencia, modelo) values ('calificacion', fila.id, p_modelo)
  returning id into llamada;
  update calificaciones_lead
  set estado = 'en_curso', reservada_por = p_pedido, reservada_hasta = now() + interval '3 minutes',
      intentos = intentos + 1
  where id = fila.id;

  return jsonb_build_object(
    'estado', 'tomada',
    'calificacion_id', fila.id,
    'llamada_id', llamada,
    'intento', fila.intentos + 1,
    'entrada', fila.entrada,
    'atrasadas', calificaciones_atrasadas()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Guardar lo que respondió Claude
-- ---------------------------------------------------------------------------

-- p_resultado: 'ok' (con ficha), 'rechazo' (Claude se negó), 'invalida' (no cumplió la ficha o se
-- cortó) o 'error' (no respondió: caído, lento, demasiadas solicitudes).
create function guardar_calificacion(
  p_calificacion uuid,
  p_pedido uuid,
  p_llamada uuid,
  p_resultado text,
  p_ficha jsonb,
  p_version text,
  p_tokens_entrada integer,
  p_tokens_salida integer,
  p_costo_usd numeric,
  p_duracion_ms integer,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fila calificaciones_lead%rowtype;
  resultado text := p_resultado;
  modelo_usado text;
  nuevo_estado estado_calificacion;
begin
  if p_resultado is null or p_resultado not in ('ok', 'rechazo', 'invalida', 'error') then
    raise exception 'Resultado inválido: %', p_resultado using errcode = '22023';
  end if;
  if resultado = 'ok' and (p_ficha is null or not ficha_valida(p_ficha)) then
    resultado := 'invalida';
  end if;

  -- La llamada se completa siempre: se pagó aunque este pedido ya no sea el dueño de la reserva
  update llamadas_ia
  set estado = resultado, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
      costo_usd = p_costo_usd, duracion_ms = p_duracion_ms, error = left(p_error, 200), terminada_en = now()
  where id = p_llamada and referencia = p_calificacion and estado in ('en_curso', 'posiblemente_cobrada')
  returning modelo into modelo_usado;
  if modelo_usado is null then
    -- La llamada no corresponde a esta calificación (un error del CRM): no se guarda nada
    return jsonb_build_object('guardada', false, 'motivo', 'llamada_desconocida');
  end if;

  -- Solo el dueño de la reserva guarda: un pedido tardío no pisa el de otro
  select * into fila from calificaciones_lead where id = p_calificacion for update;
  if not found or fila.estado <> 'en_curso' or fila.reservada_por is distinct from p_pedido then
    return jsonb_build_object('guardada', false);
  end if;

  if resultado = 'ok' then
    nuevo_estado := 'calificada';
  elsif resultado = 'rechazo' then
    nuevo_estado := 'rechazada';
  elsif resultado = 'invalida' and fila.respuestas_invalidas + 1 >= 3 then
    nuevo_estado := 'fallida';
  elsif fila.intentos >= intentos_maximos_calificacion() then
    nuevo_estado := 'fallida'; -- Claude no respondió en unas 3 horas de intentos: no se sigue intentando
  else
    nuevo_estado := 'por_calificar';
  end if;

  update calificaciones_lead
  set estado = nuevo_estado,
      ficha = case when resultado = 'ok' then p_ficha else ficha end,
      modelo = case when resultado in ('ok', 'rechazo') then modelo_usado else modelo end,
      version_prompt = case when resultado in ('ok', 'rechazo') then left(p_version, 40) else version_prompt end,
      calificada_en = case when resultado = 'ok' then now() else calificada_en end,
      respuestas_invalidas = respuestas_invalidas + (resultado = 'invalida')::integer,
      -- Espera creciente antes del siguiente intento: 1, 2, 4, 8… minutos, máximo una hora
      proximo_intento_en = case when nuevo_estado = 'por_calificar' then now() + espera_calificacion(fila.intentos)
                                else proximo_intento_en end,
      reservada_por = null,
      reservada_hasta = null,
      -- Al terminar ya no hace falta la copia del mensaje (el original sigue en el historial del contacto)
      entrada = case when nuevo_estado = 'por_calificar' then entrada else entrada - 'mensaje' end
  where id = p_calificacion;

  return jsonb_build_object(
    'guardada', true,
    'estado', nuevo_estado,
    'prioridad', case when nuevo_estado = 'calificada' then prioridad_regla(p_ficha, fila.entrada) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. El asesor (o la gerente) cambia la prioridad. Quién y cuándo los pone la base, no el navegador.
--    Con null se vuelve a la prioridad de la regla.
-- ---------------------------------------------------------------------------

create function cambiar_prioridad(p_calificacion uuid, p_prioridad prioridad_lead) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_contacto uuid;
begin
  select contacto_id into v_contacto from calificaciones_lead where id = p_calificacion;
  if v_contacto is null or not ((select mi_rol()) = 'gerente' or es_mi_contacto(v_contacto)) then
    raise exception 'No puedes cambiar esta prioridad' using errcode = '42501';
  end if;
  update calificaciones_lead
  set prioridad_asesor = p_prioridad,
      prioridad_asesor_por = case when p_prioridad is null then null else auth.uid() end,
      prioridad_asesor_en = case when p_prioridad is null then null else now() end
  where id = p_calificacion;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. El aviso de "lead prioritario" (n8n lo manda por el destino seguro, 00b)
-- ---------------------------------------------------------------------------

-- A quién le llega el aviso: a quien tiene la tarea si sigue activo; si no, al asesor del contacto si
-- sigue activo; si no, a la gerente (la misma regla de capturar_lead).
create function destinatario_aviso(c calificaciones_lead) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.usuario_id from actividades t join perfiles p on p.id = t.usuario_id where t.id = c.tarea_id and p.activo),
    (select p.id from contactos ct join perfiles p on p.id = ct.asesor_id where ct.id = c.contacto_id and p.activo),
    (select id from perfiles where rol = 'gerente' and activo order by codigo limit 1)
  )
$$;

-- ¿Le toca aviso de prioritario? Calificada como alta, llegada y calificada en las últimas 24 horas (si el
-- PC estuvo apagado días, o la regla cambia, los leads viejos no disparan avisos tarde), que no sea un
-- posible duplicado (revision: lo revisa Laura) y que el alta no la haya puesto el mismo que lo recibiría.
create function toca_aviso_prioritario(c calificaciones_lead) returns boolean
language sql stable security definer set search_path = public as $$
  select c.estado = 'calificada'
    and coalesce(c.prioridad_asesor, prioridad_regla(c.ficha, c.entrada)) = 'alta'
    and c.captura <> 'revision'
    and c.creada_en > now() - interval '24 hours'
    and c.calificada_en > now() - interval '24 hours'
    and c.aviso_enviado_en is null
    and c.prioridad_asesor_por is distinct from destinatario_aviso(c)
$$;

-- Los avisos que nadie ha reservado, con lo necesario para armar el correo (solo datos del equipo y del
-- lead; el correo del contacto nunca sale de aquí).
create function avisos_prioritarios_pendientes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pendientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'calificacion_id', c.id,
        'contacto', jsonb_build_object('codigo', ct.codigo, 'nombre', coalesce(ct.empresa, ct.nombre), 'ciudad', ct.ciudad),
        'venta', o.codigo,
        'resumen', c.ficha->>'resumen',
        'consumo_estimado', consumo_estimado(c.ficha, c.entrada),
        'destinatario', jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'email', p.email)
      ) order by c.calificada_en)
      from calificaciones_lead c
      join contactos ct on ct.id = c.contacto_id
      left join oportunidades o on o.id = c.oportunidad_id
      join perfiles p on p.id = destinatario_aviso(c)
      where c.aviso_reservado_en is null and toca_aviso_prioritario(c)
    ), '[]'::jsonb),
    -- Reservados hace más de 15 minutos y sin confirmar: n8n se cayó a la mitad
    'atascados', coalesce((
      select jsonb_agg(jsonb_build_object('calificacion_id', id, 'ejecucion', aviso_reservado_por))
      from calificaciones_lead
      where aviso_enviado_en is null and aviso_reservado_en < now() - interval '15 minutes'
        and aviso_reservado_en > now() - interval '7 days'
    ), '[]'::jsonb)
  )
$$;

-- Como reservar_avisos (013): true si estaba libre o si ya era de esta misma ejecución de n8n. Vuelve a
-- revisar que le toque (y que no se haya enviado ya): un reintento de n8n después de confirmar no repite.
create function reservar_aviso_prioritario(p_calificacion uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update calificaciones_lead c
  set aviso_reservado_en = now(), aviso_reservado_por = p_ejecucion
  where c.id = p_calificacion and toca_aviso_prioritario(c)
    and (c.aviso_reservado_en is null or (p_ejecucion is not null and c.aviso_reservado_por = p_ejecucion));
  return found;
end;
$$;

create function confirmar_aviso_prioritario(p_calificacion uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update calificaciones_lead set aviso_enviado_en = now()
  where id = p_calificacion and aviso_reservado_por = p_ejecucion and aviso_enviado_en is null;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Permisos de las funciones. Postgres deja que cualquiera (también un visitante anónimo, por la API)
--    ejecute una función nueva; aquí se cierra todo y se abre solo lo necesario:
--    - las reglas puras: con sesión (las usa la vista) y la llave de servicio (el examen);
--    - las de n8n y el CRM: solo la llave de servicio;
--    - cambiar la prioridad: con sesión (la función revisa quién es);
--    - las internas: nadie.
-- ---------------------------------------------------------------------------

revoke execute on function
  tarifa_referencia_cop_kwh(), tope_llamadas_ia_dia(), intentos_maximos_calificacion(), mensaje_aporta(text),
  ficha_valida(jsonb), numero_razonable(jsonb, numeric), consumo_estimado(jsonb, jsonb), prioridad_regla(jsonb, jsonb),
  espera_calificacion(integer),
  crear_calificacion(text, jsonb, jsonb, text, uuid[]), vencer_calificaciones(), llamadas_ia_de_hoy(),
  calificaciones_atrasadas(), tomar_calificacion(uuid, text),
  guardar_calificacion(uuid, uuid, uuid, text, jsonb, text, integer, integer, numeric, integer, text),
  destinatario_aviso(calificaciones_lead), toca_aviso_prioritario(calificaciones_lead),
  avisos_prioritarios_pendientes(), reservar_aviso_prioritario(uuid, text), confirmar_aviso_prioritario(uuid, text),
  cambiar_prioridad(uuid, prioridad_lead)
from public, anon, authenticated, service_role;

grant execute on function
  tarifa_referencia_cop_kwh(), numero_razonable(jsonb, numeric), consumo_estimado(jsonb, jsonb),
  prioridad_regla(jsonb, jsonb), ficha_valida(jsonb), mensaje_aporta(text)
to authenticated, service_role;

grant execute on function
  calificaciones_atrasadas(), tomar_calificacion(uuid, text),
  guardar_calificacion(uuid, uuid, uuid, text, jsonb, text, integer, integer, numeric, integer, text),
  avisos_prioritarios_pendientes(), reservar_aviso_prioritario(uuid, text), confirmar_aviso_prioritario(uuid, text)
to service_role;

grant execute on function cambiar_prioridad(uuid, prioridad_lead) to authenticated;
