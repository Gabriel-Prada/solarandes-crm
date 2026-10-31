-- Fase 6, paso 1: la conversación con candado (docs/plan-fase-6.md, sección 4 y sus ajustes).
--
-- El asistente público es un VISITANTE ANÓNIMO. No usa la llave pública (la tiene todo internet) ni la
-- de servicio (lee la agenda de clientes): tiene su propio usuario, asistente_web, que nace sin poder
-- leer ni escribir ninguna tabla y solo puede ejecutar las funciones asistente_* de esta migración.
-- La contraseña NO va aquí (el repo está en GitHub): el usuario nace sin poder entrar y el script
-- scripts/supabase/clave_asistente.py le da la entrada junto con la contraseña ya cifrada.
--
-- Lo que decide la base, para que no haya "revisar y después actuar":
--   - el turno de cada conversación es una reserva que vence (dos pestañas no responden a la vez, y un
--     streaming cortado no deja la conversación trabada);
--   - el permiso para llamar a Claude se pide POR LLAMADA (un mensaje puede llevar hasta 3), bajo un
--     candado del día propio del asistente (no el de la calificación de leads: con la contraseña del
--     asistente nadie puede frenar la fase 4), contando lo máximo que puede costar mientras está en curso;
--   - los topes: por mensaje, por conversación, por persona (huella de la IP) y por día (llamadas y gasto).
-- El asistente tiene su propio tope en llamadas_ia, separado del de la calificación de leads: desde aquí
-- llamadas_ia_de_hoy() y tope_llamadas_ia_dia() (020) cuentan solo la calificación y las facturas.
-- Orden de los candados, siempre el mismo para no bloquearse entre funciones: conversación, turno, llamada.
-- Pruebas: tests/test_asistente_supabase.py.

-- ---------------------------------------------------------------------------
-- 1. El usuario del asistente: sin entrar (hasta que el script le ponga contraseña) y sin permisos.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'asistente_web') then
    create role asistente_web nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication
      connection limit 10;
  end if;
end;
$$;
-- Aunque el usuario ya existiera (por ejemplo, de una prueba), queda con estos atributos y sin pertenecer a
-- ningún otro rol (si perteneciera a anon o authenticated podría cambiarse a ellos)
alter role asistente_web nologin nocreatedb nocreaterole noinherit connection limit 10;
do $$
declare
  r record;
begin
  for r in select roleid::regrole::text as rol from pg_auth_members where member = 'asistente_web'::regrole loop
    execute format('revoke %s from asistente_web', r.rol);
  end loop;
end;
$$;
alter role asistente_web set statement_timeout = '5s';
alter role asistente_web set idle_in_transaction_session_timeout = '10s';
alter role asistente_web set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Los topes, en un solo lugar (valores iniciales del plan; se ajustan con el uso)
-- ---------------------------------------------------------------------------

create function asistente_topes() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'modelo', 'claude-haiku-5-5',
    'letras_por_mensaje', 600,
    'mensajes_por_conversacion', 20,
    'horas_por_conversacion', 2,
    'llamadas_por_turno', 3,
    'segundos_por_turno', 90,
    'conversaciones_por_persona_hora', 3,
    'conversaciones_por_persona_dia', 10,
    'mensajes_por_persona_hora', 40,
    'mensajes_por_persona_dia', 60,
    'conversaciones_por_dia', 150,
    'llamadas_por_dia', 1000,
    'gasto_usd_por_dia', 0.30,       -- decisión B de Gabriel (2026-10-30)
    'gasto_usd_por_persona_dia', 0.03,
    'dias_de_texto', 30
  )
$$;

-- Lo máximo que puede costar UNA llamada, según lo que ya lleva guardado la conversación. Lo calcula la
-- base, no el servidor: aunque alguien tuviera la contraseña del asistente, no puede reservar de menos.
-- Peor caso: instrucciones y herramientas (8.000 tokens, con margen para las vueltas de herramientas),
-- el historial (2 bytes por token: emojis y otros alfabetos ocupan varios bytes), al precio de escribir en caché
-- (1,25 veces la entrada de Haiku 5.5, USD 0,10 por millón) y 700 tokens de salida (USD 0,50 por millón).
create function asistente_costo_maximo(p_letras_historial bigint) returns numeric
language sql immutable as $$
  select round(((8000 + greatest(p_letras_historial, 0) / 2.0) * 0.10 * 1.25 + 700 * 0.50) / 1000000, 6)
$$;

-- ---------------------------------------------------------------------------
-- 3. Las tablas. Nadie escribe directo: solo las funciones. La gerente puede leerlas.
-- ---------------------------------------------------------------------------

create table conversaciones_asistente (
  id uuid primary key default gen_random_uuid(),
  -- La cookie del navegador guarda un número aleatorio de 128 bits; aquí solo su huella SHA-256
  clave_hash text not null unique check (clave_hash ~ '^[0-9a-f]{64}$'),
  canal text not null default 'web' check (canal in ('web', 'whatsapp')),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  -- Ley 1581: la aceptación del aviso (versión y hora), como la casilla de /cotiza
  autorizacion jsonb not null,
  abierta_en timestamptz not null default now(),
  ultimo_mensaje_en timestamptz,
  mensajes_visitante integer not null default 0,
  costo_usd numeric(10, 6) not null default 0,
  turno_id uuid,
  turno_hasta timestamptz,
  texto_borrado_en timestamptz
);
create index on conversaciones_asistente (huella, abierta_en);
create index on conversaciones_asistente (abierta_en);

-- Cada turno: un mensaje del visitante y lo que respondió el asistente (con sus vueltas de herramientas)
create table turnos_asistente (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones_asistente (id) on delete cascade,
  pedido uuid not null,
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  llama_claude boolean not null,
  llamadas integer not null default 0,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'guardado', 'fallido', 'vencido')),
  iniciado_en timestamptz not null default now(),
  terminado_en timestamptz
);
create index on turnos_asistente (huella, iniciado_en);
create index on turnos_asistente (conversacion_id);
create index on turnos_asistente (conversacion_id) where estado = 'en_curso';

-- Los mensajes, como bloques de la API de Claude (lo que se le manda y lo que devuelve), ya con los
-- teléfonos, correos y documentos tapados. Se borran a los 30 días; quedan los números de la conversación.
create table mensajes_asistente (
  id bigint generated always as identity primary key,
  conversacion_id uuid not null references conversaciones_asistente (id) on delete cascade,
  turno_id uuid not null references turnos_asistente (id) on delete cascade,
  orden integer not null,
  rol text not null check (rol in ('user', 'assistant')),
  contenido jsonb not null check (jsonb_typeof(contenido) = 'array'),
  creado_en timestamptz not null default now(),
  unique (conversacion_id, orden)
);

alter table conversaciones_asistente enable row level security;
alter table turnos_asistente enable row level security;
alter table mensajes_asistente enable row level security;
revoke all on conversaciones_asistente, turnos_asistente, mensajes_asistente from public, anon, authenticated, service_role;
grant select on conversaciones_asistente, turnos_asistente, mensajes_asistente to authenticated;
create policy "la gerente ve las conversaciones del asistente" on conversaciones_asistente for select to authenticated
  using ((select mi_rol()) = 'gerente');
create policy "la gerente ve los turnos del asistente" on turnos_asistente for select to authenticated
  using ((select mi_rol()) = 'gerente');
create policy "la gerente ve los mensajes del asistente" on mensajes_asistente for select to authenticated
  using ((select mi_rol()) = 'gerente');

-- ---------------------------------------------------------------------------
-- 4. El registro de costos de la fase 4 acepta al asistente, con su reserva. El tope de la calificación
--    de leads (300 al día) deja de contar las llamadas del asistente: cada pieza tiene el suyo.
-- ---------------------------------------------------------------------------

alter table llamadas_ia drop constraint llamadas_ia_pieza_check;
alter table llamadas_ia add constraint llamadas_ia_pieza_check check (pieza in ('calificacion', 'factura', 'asistente'));
alter table llamadas_ia add column reserva_usd numeric(10, 6) check (reserva_usd >= 0);
-- Para ver si el caché funciona (decisión 10 del plan): si siempre es cero, algo lo está rompiendo
alter table llamadas_ia add column tokens_cache_leidos integer check (tokens_cache_leidos >= 0);
create index on llamadas_ia (pieza, iniciada_en) where estado = 'en_curso';

create or replace function llamadas_ia_de_hoy() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from llamadas_ia
  where pieza in ('calificacion', 'factura')
    and iniciada_en >= date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
    and not (estado = 'error' and (error like 'http\_%' or error = 'sin_conexion'))
$$;

-- ---------------------------------------------------------------------------
-- 5. Piezas internas (solo las usan las funciones de abajo)
-- ---------------------------------------------------------------------------

-- Lo que cuesta una llamada del asistente para los topes: lo real si ya se sabe; si está en curso, quedó
-- "posiblemente cobrada" o no tiene precio, lo máximo reservado. Las que la API rechazó sin procesar
-- (un código de error HTTP o sin conexión) no se cobran.
create function asistente_costo_contado(l llamadas_ia) returns numeric
language sql immutable as $$
  select case
    when l.estado = 'error' and (l.error like 'http\_%' or l.error = 'sin_conexion') then 0
    when l.estado in ('en_curso', 'posiblemente_cobrada') or l.costo_usd is null then coalesce(l.reserva_usd, 0)
    else l.costo_usd
  end
$$;

-- Ley 1581: el texto se borra a los 30 días (quedan los números). Corre en cada conversación nueva,
-- sin depender de n8n. También marca como vencidos los turnos y las llamadas que quedaron a medias.
create function asistente_limpiar() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from mensajes_asistente m using conversaciones_asistente c
  where m.conversacion_id = c.id and c.abierta_en < now() - make_interval(days => (asistente_topes()->>'dias_de_texto')::int);
  -- La huella sale de la IP: también se borra (queda un valor fijo que no dice nada)
  update conversaciones_asistente set texto_borrado_en = now(), huella = repeat('0', 64)
  where texto_borrado_en is null
    and abierta_en < now() - make_interval(days => (asistente_topes()->>'dias_de_texto')::int);
  update turnos_asistente t set huella = repeat('0', 64)
  from conversaciones_asistente c
  where t.conversacion_id = c.id and c.texto_borrado_en is not null and t.huella <> repeat('0', 64);

  -- Un turno que ya no es el actual de su conversación quedó a medias. El actual, aunque haya vencido,
  -- todavía se puede guardar (la respuesta ya se pagó): lo reemplaza el siguiente mensaje.
  update turnos_asistente t set estado = 'vencido', terminado_en = now()
  from conversaciones_asistente c
  where t.conversacion_id = c.id and t.estado = 'en_curso' and c.turno_id is distinct from t.id;
  -- Una llamada sin terminar a los 2 minutos se cortó: quizá se cobró, cuenta por su reserva
  update llamadas_ia set estado = 'posiblemente_cobrada', terminada_en = now()
  where pieza = 'asistente' and estado = 'en_curso' and iniciada_en < now() - interval '2 minutes';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Las funciones del asistente. Devuelven {estado, ...} en vez de lanzar errores: un rechazo por tope
--    es una respuesta normal, no una falla.
-- ---------------------------------------------------------------------------

-- Abrir una conversación (el visitante aceptó el aviso). p_clave_hash: SHA-256 del valor de la cookie.
create function asistente_abrir(p_clave_hash text, p_huella text, p_version_aviso text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  topes jsonb := asistente_topes();
  nueva uuid;
begin
  if coalesce(p_clave_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_huella, '') !~ '^[0-9a-f]{64}$'
     or coalesce(length(p_version_aviso), 0) not between 1 and 40 then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;
  perform pg_advisory_xact_lock(hashtext('asistente_conversaciones'));
  perform asistente_limpiar();

  if (select count(*) from conversaciones_asistente where huella = p_huella and abierta_en > now() - interval '1 hour')
       >= (topes->>'conversaciones_por_persona_hora')::int
     or (select count(*) from conversaciones_asistente where huella = p_huella and abierta_en >= inicio_del_dia_bogota())
       >= (topes->>'conversaciones_por_persona_dia')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'persona');
  end if;
  if (select count(*) from conversaciones_asistente where abierta_en >= inicio_del_dia_bogota())
       >= (topes->>'conversaciones_por_dia')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'dia');
  end if;

  insert into conversaciones_asistente (clave_hash, huella, autorizacion)
  values (p_clave_hash, p_huella, jsonb_build_object('version', p_version_aviso, 'aceptada_en', now()))
  on conflict (clave_hash) do nothing
  returning id into nueva;
  if nueva is null then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'clave_repetida');
  end if;
  return jsonb_build_object('estado', 'ok', 'conversacion_id', nueva);
end;
$$;

-- Tomar el turno para responder un mensaje. Revisa la conversación, el largo del mensaje y los topes de
-- mensajes, y reserva el turno (vence solo). Si el mensaje va a Claude, devuelve el historial guardado:
-- el navegador nunca lo manda.
create function asistente_tomar_turno(p_clave_hash text, p_huella text, p_pedido uuid, p_mensaje text, p_llama_claude boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  topes jsonb := asistente_topes();
  conv conversaciones_asistente%rowtype;
  mensaje text := sin_bordes(p_mensaje);
  turno uuid;
begin
  if coalesce(p_clave_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_huella, '') !~ '^[0-9a-f]{64}$'
     or p_pedido is null or p_llama_claude is null then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;
  if mensaje = '' then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'mensaje_vacio');
  end if;
  if char_length(mensaje) > (topes->>'letras_por_mensaje')::int then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'mensaje_largo');
  end if;

  select * into conv from conversaciones_asistente where clave_hash = p_clave_hash for update;
  if not found or conv.texto_borrado_en is not null
     or conv.abierta_en < now() - make_interval(hours => (topes->>'horas_por_conversacion')::int) then
    return jsonb_build_object('estado', 'sin_conversacion');
  end if;
  if conv.turno_hasta is not null and conv.turno_hasta > now() then
    return jsonb_build_object('estado', 'ocupada');
  end if;
  if conv.mensajes_visitante >= (topes->>'mensajes_por_conversacion')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'conversacion');
  end if;

  -- Los topes por persona usan la huella de ESTE pedido (un celular cambia de IP a mitad de la conversación)
  perform pg_advisory_xact_lock(hashtext('asistente_huella:' || p_huella));
  if (select count(*) from turnos_asistente where huella = p_huella and iniciado_en > now() - interval '1 hour')
       >= (topes->>'mensajes_por_persona_hora')::int
     or (select count(*) from turnos_asistente where huella = p_huella and iniciado_en >= inicio_del_dia_bogota())
       >= (topes->>'mensajes_por_persona_dia')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'persona');
  end if;

  update turnos_asistente set estado = 'vencido', terminado_en = now()
  where id = conv.turno_id and estado = 'en_curso';
  insert into turnos_asistente (conversacion_id, pedido, huella, llama_claude)
  values (conv.id, p_pedido, p_huella, p_llama_claude)
  returning id into turno;
  update conversaciones_asistente
  set turno_id = turno, turno_hasta = now() + make_interval(secs => (topes->>'segundos_por_turno')::int)
  where id = conv.id;

  return jsonb_build_object(
    'estado', 'ok',
    'turno_id', turno,
    'mensaje', mensaje,
    'mensajes_visitante', conv.mensajes_visitante,
    'historial', case when p_llama_claude then coalesce((
      select jsonb_agg(jsonb_build_object('role', rol, 'content', contenido) order by orden)
      from mensajes_asistente where conversacion_id = conv.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- El permiso para UNA llamada a Claude. Bajo el candado del día (el mismo de la calificación de leads):
-- dos pedidos a la vez no pueden leer los dos "queda cupo". La llamada se anota ANTES de llamar, con lo
-- máximo que puede costar; al terminar se reemplaza por lo real.
create function asistente_tomar_llamada(p_turno uuid, p_pedido uuid, p_modelo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  topes jsonb := asistente_topes();
  t turnos_asistente%rowtype;
  conv conversaciones_asistente%rowtype;
  reserva numeric;
  gasto_dia numeric;
  gasto_persona numeric;
  llamada uuid;
begin
  if p_turno is null or p_pedido is null then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;
  -- El tope de gasto está calculado con los precios de un solo modelo: otro modelo necesita otra migración
  if p_modelo is distinct from topes->>'modelo' then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'modelo');
  end if;
  -- Primero se revisa el turno, sin candados: un pedido inventado no llega a tomar el candado del día
  select * into t from turnos_asistente where id = p_turno;
  if not found or t.pedido <> p_pedido or t.estado <> 'en_curso' or not t.llama_claude then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'turno');
  end if;
  -- El orden de siempre: la conversación, el turno y después el candado del día del asistente
  select * into conv from conversaciones_asistente where id = t.conversacion_id for update;
  select * into t from turnos_asistente where id = p_turno for update;
  if conv.turno_id is distinct from t.id or conv.turno_hasta < now() or t.estado <> 'en_curso' then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'turno');
  end if;
  perform pg_advisory_xact_lock(hashtext('llamadas_ia_asistente'));
  if t.llamadas >= (topes->>'llamadas_por_turno')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'turno');
  end if;

  if (select count(*) from llamadas_ia where pieza = 'asistente' and iniciada_en >= inicio_del_dia_bogota()
        and not (estado = 'error' and (error like 'http\_%' or error = 'sin_conexion')))
       >= (topes->>'llamadas_por_dia')::int then
    return jsonb_build_object('estado', 'limite', 'motivo', 'dia');
  end if;

  reserva := asistente_costo_maximo(
    (select coalesce(sum(octet_length(contenido::text)), 0) from mensajes_asistente where conversacion_id = conv.id)
  );
  select coalesce(sum(asistente_costo_contado(l)), 0) into gasto_dia
  from llamadas_ia l where l.pieza = 'asistente' and l.iniciada_en >= inicio_del_dia_bogota();
  if gasto_dia + reserva > (topes->>'gasto_usd_por_dia')::numeric then
    return jsonb_build_object('estado', 'limite', 'motivo', 'gasto_dia');
  end if;
  select coalesce(sum(asistente_costo_contado(l)), 0) into gasto_persona
  from llamadas_ia l join turnos_asistente tu on tu.id = l.referencia
  where l.pieza = 'asistente' and l.iniciada_en >= inicio_del_dia_bogota() and tu.huella = t.huella;
  if gasto_persona + reserva > (topes->>'gasto_usd_por_persona_dia')::numeric then
    return jsonb_build_object('estado', 'limite', 'motivo', 'persona');
  end if;

  insert into llamadas_ia (pieza, referencia, modelo, reserva_usd) values ('asistente', t.id, p_modelo, reserva)
  returning id into llamada;
  update turnos_asistente set llamadas = llamadas + 1 where id = t.id;
  return jsonb_build_object('estado', 'ok', 'llamada_id', llamada, 'reserva_usd', reserva);
end;
$$;

-- Lo que costó la llamada. Se completa siempre (se pagó, aunque el turno ya haya vencido). Se guarda lo
-- real aunque pase de lo reservado (el tope cuenta lo medido), con un techo de cordura de USD 0,05 por
-- llamada; no puede ser negativo, y sin costo cuenta lo reservado. Una llamada que la API rechazó sin
-- procesarla (http_* o sin conexión) no se cobra.
create function asistente_terminar_llamada(
  p_llamada uuid, p_turno uuid, p_resultado text, p_tokens_entrada integer, p_tokens_salida integer,
  p_tokens_cache_leidos integer, p_costo_usd numeric, p_duracion_ms integer, p_error text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fila llamadas_ia%rowtype;
  costo numeric;
  conversacion uuid;
begin
  if p_resultado is null or p_resultado not in ('ok', 'rechazo', 'invalida', 'error') then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'resultado');
  end if;
  -- El orden de siempre: primero la conversación
  select conversacion_id into conversacion from turnos_asistente where id = p_turno;
  perform 1 from conversaciones_asistente where id = conversacion for update;
  select * into fila from llamadas_ia
  where id = p_llamada and referencia = p_turno and pieza = 'asistente' and estado in ('en_curso', 'posiblemente_cobrada')
  for update;
  if not found then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'llamada');
  end if;
  costo := case
    when p_resultado = 'error' and (p_error like 'http\_%' or p_error = 'sin_conexion') then 0
    when p_costo_usd is null or p_costo_usd < 0 then fila.reserva_usd
    else least(p_costo_usd, 0.05)
  end;
  update llamadas_ia
  set estado = p_resultado,
      tokens_entrada = greatest(coalesce(p_tokens_entrada, 0), 0),
      tokens_salida = greatest(coalesce(p_tokens_salida, 0), 0),
      costo_usd = costo,
      duracion_ms = greatest(coalesce(p_duracion_ms, 0), 0),
      tokens_cache_leidos = greatest(coalesce(p_tokens_cache_leidos, 0), 0),
      error = left(p_error, 200),
      terminada_en = now()
  where id = fila.id;
  update conversaciones_asistente set costo_usd = costo_usd + costo where id = conversacion;
  return jsonb_build_object('estado', 'ok', 'costo_usd', costo);
end;
$$;

-- Guardar el turno terminado: el mensaje del visitante y lo que respondió el asistente, al final del
-- historial. Solo el dueño del turno guarda. Con p_mensajes vacío solo se suelta el turno (falló).
create function asistente_guardar_turno(p_turno uuid, p_pedido uuid, p_mensajes jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t turnos_asistente%rowtype;
  siguiente integer;
  m jsonb;
begin
  if p_turno is null or p_pedido is null or p_mensajes is null or jsonb_typeof(p_mensajes) <> 'array'
     or jsonb_array_length(p_mensajes) > 10 or length(p_mensajes::text) > 60000 then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;
  for m in select * from jsonb_array_elements(p_mensajes) loop
    if jsonb_typeof(m) <> 'object' or coalesce(m->>'role', '') not in ('user', 'assistant')
       or jsonb_typeof(m->'content') is distinct from 'array' then
      return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
    end if;
  end loop;
  -- Un turno guardado empieza con el mensaje del visitante y termina con una respuesta del asistente
  if jsonb_array_length(p_mensajes) > 0 and (
       p_mensajes->0->>'role' <> 'user' or p_mensajes->-1->>'role' <> 'assistant') then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;

  -- El orden de siempre: la conversación y después el turno
  perform 1 from conversaciones_asistente c join turnos_asistente tu on tu.conversacion_id = c.id
  where tu.id = p_turno for update of c;
  select * into t from turnos_asistente where id = p_turno for update;
  -- Se guarda si sigue siendo el turno actual de la conversación, aunque haya pasado su tiempo: la respuesta
  -- ya se pagó. Si otro mensaje ya lo reemplazó, no se guarda (el historial no se puede intercalar).
  if not found or t.pedido <> p_pedido or t.estado <> 'en_curso'
     or not exists (select 1 from conversaciones_asistente where id = t.conversacion_id and turno_id = t.id) then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'turno');
  end if;

  if jsonb_array_length(p_mensajes) = 0 then
    update turnos_asistente set estado = 'fallido', terminado_en = now() where id = t.id;
  else
    select coalesce(max(orden), 0) into siguiente from mensajes_asistente where conversacion_id = t.conversacion_id;
    insert into mensajes_asistente (conversacion_id, turno_id, orden, rol, contenido)
    select t.conversacion_id, t.id, siguiente + e.n, e.v->>'role', e.v->'content'
    from jsonb_array_elements(p_mensajes) with ordinality as e(v, n);
    update turnos_asistente set estado = 'guardado', terminado_en = now() where id = t.id;
    update conversaciones_asistente
    set mensajes_visitante = mensajes_visitante + 1, ultimo_mensaje_en = now()
    where id = t.conversacion_id;
  end if;
  update conversaciones_asistente set turno_id = null, turno_hasta = null
  where id = t.conversacion_id and turno_id = t.id;
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- La pre-cotización, con la fórmula de la base (fase 1) y SIN descuento: el asistente no da descuentos.
-- Recibe el consumo en kWh o lo que paga de luz en pesos (se convierte con la tarifa de referencia de
-- la fase 4). Un dato fuera de rango vuelve con un mensaje en español para la persona.
create function asistente_calcular_precio(p_consumo_kwh integer, p_factura_cop bigint, p_ciudad text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ciudad_ ciudad;
  consumo integer;
  calculo record;
begin
  ciudad_ := case lower(sin_tildes(sin_bordes(p_ciudad)))
    when 'bogota' then 'Bogotá' when 'medellin' then 'Medellín' when 'cali' then 'Cali' end;
  if ciudad_ is null then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'Por ahora SolarAndes instala solo en Bogotá, Medellín y Cali.');
  end if;
  if p_consumo_kwh is not null then
    consumo := p_consumo_kwh;
  elsif p_factura_cop is not null and p_factura_cop between 10000 and 1000000000 then
    consumo := round(p_factura_cop::numeric / tarifa_referencia_cop_kwh());
  else
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'Necesito el consumo mensual en kWh (aparece en la factura de luz) o cuánto paga de luz al mes en pesos.');
  end if;
  if consumo is null or consumo < 1 or consumo > 100000 then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'El consumo debe estar entre 1 y 100.000 kWh al mes.');
  end if;

  select * into calculo from calcular_cotizacion(consumo, ciudad_, 0);
  return jsonb_build_object(
    'estado', 'ok',
    'ciudad', ciudad_,
    'consumo_kwh_mes', consumo,
    'consumo_estimado_desde_pesos', p_consumo_kwh is null,
    'tarifa_referencia_cop_kwh', case when p_consumo_kwh is null then tarifa_referencia_cop_kwh() end,
    'paneles_550w', calculo.num_paneles,
    'potencia_kwp', calculo.potencia_kwp,
    'precio_por_kwp_cop', calculo.precio_kwp,
    'valor_total_cop', calculo.valor_total
  );
end;
$$;

-- Para la alarma de n8n y el examen: cómo va el día (solo números)
create function asistente_estado_del_dia() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'conversaciones', (select count(*) from conversaciones_asistente where abierta_en >= inicio_del_dia_bogota()),
    'llamadas', (select count(*) from llamadas_ia where pieza = 'asistente' and iniciada_en >= inicio_del_dia_bogota()),
    'gasto_usd', (select coalesce(sum(asistente_costo_contado(l)), 0) from llamadas_ia l
                  where l.pieza = 'asistente' and l.iniciada_en >= inicio_del_dia_bogota()),
    'topes', asistente_topes()
  )
$$;

-- ---------------------------------------------------------------------------
-- 7. Permisos. Postgres deja que cualquiera ejecute una función nueva, y Supabase además se la da a la
--    llave pública: se cierra todo y se abre solo lo necesario. asistente_web ejecuta EXACTAMENTE las
--    seis funciones asistente_* que siguen (la prueba de lista exacta lo revisa).
--    Las tablas temporales: el permiso TEMP lo tienen todos (PUBLIC) y no se le puede quitar a un solo
--    usuario; la defensa es el search_path de cada función (public primero, pg_temp al final), con prueba.
-- ---------------------------------------------------------------------------

revoke execute on function
  asistente_topes(), asistente_costo_maximo(bigint), asistente_costo_contado(llamadas_ia), asistente_limpiar(),
  asistente_abrir(text, text, text),
  asistente_tomar_turno(text, text, uuid, text, boolean),
  asistente_tomar_llamada(uuid, uuid, text),
  asistente_terminar_llamada(uuid, uuid, text, integer, integer, integer, numeric, integer, text),
  asistente_guardar_turno(uuid, uuid, jsonb),
  asistente_calcular_precio(integer, bigint, text),
  asistente_estado_del_dia()
from public, anon, authenticated, service_role;

grant execute on function
  asistente_abrir(text, text, text),
  asistente_tomar_turno(text, text, uuid, text, boolean),
  asistente_tomar_llamada(uuid, uuid, text),
  asistente_terminar_llamada(uuid, uuid, text, integer, integer, integer, numeric, integer, text),
  asistente_guardar_turno(uuid, uuid, jsonb),
  asistente_calcular_precio(integer, bigint, text)
to asistente_web;

grant execute on function asistente_estado_del_dia() to service_role;
grant usage on schema public to asistente_web;
