-- Fase 6, piezas 3 a 5: dejar los datos, agendar la visita y pasar a un asesor
-- (docs/plan-fase-6.md, sección 5 y los ajustes de la revisión del diseño).
--
-- Reglas de fondo:
--   - Todo es sobre ESA conversación: las funciones reciben el turno (y el pedido dueño del turno), nunca
--     un código de cliente. No hay forma de agendar ni de escribir a nombre de otro.
--   - Atar el lead a la conversación lo decide la base, leyendo la respuesta guardada del envío: el
--     servidor no puede afirmar "fue creado" sin que la base lo compruebe.
--   - El asistente no deja ver si un celular ya es cliente: con un lead nuevo la visita se agenda de
--     verdad; si el celular ya era de alguien (existente o revisión), el horario pedido queda como tarea
--     para el asesor. La respuesta visible es la misma.
--   - Las reglas de la visita (fecha futura, venta abierta, técnico activo, la venta pasa a "visita
--     agendada") se sacan de agendar_visita (024) a visita_nucleo, y las dos puertas la usan.
--   - Lo que n8n tiene que avisar (visita pedida, asesor pedido) queda en avisos_asistente, con reserva,
--     como los avisos de las fases 3 y 4. Siempre a alguien del equipo, por el destino seguro.
-- Pruebas: tests/test_asistente_supabase.py.

-- ---------------------------------------------------------------------------
-- 1. Lo que sabe la conversación del lead, la visita y el asesor
-- ---------------------------------------------------------------------------

alter table conversaciones_asistente
  add column lead_clave text references envios_recibidos (clave) on delete set null,
  add column lead_tipo text check (lead_tipo in ('nuevo', 'existente', 'revision')),
  add column contacto_id uuid references contactos (id) on delete set null,
  add column oportunidad_id uuid references oportunidades (id) on delete set null,
  add column visita_en timestamptz,
  add column asesor_avisado_en timestamptz;
-- Un lead se ata a UNA sola conversación: si no, con un lead nuevo se agendarían visitas desde muchas
create unique index conversaciones_asistente_un_lead on conversaciones_asistente (lead_clave) where lead_clave is not null;

create table avisos_asistente (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones_asistente (id) on delete cascade,
  tipo text not null check (tipo in ('visita', 'asesor')),
  contacto_id uuid references contactos (id) on delete cascade,
  destinatario_id uuid not null references perfiles (id),
  detalle jsonb not null default '{}',
  creado_en timestamptz not null default now(),
  reservado_por text,
  reservado_en timestamptz,
  enviado_en timestamptz,
  unique (conversacion_id, tipo)
);
alter table avisos_asistente enable row level security;
revoke all on avisos_asistente from public, anon, authenticated, service_role;
grant select on avisos_asistente to authenticated;
create policy "la gerente ve los avisos del asistente" on avisos_asistente for select to authenticated
  using ((select mi_rol()) = 'gerente');

-- ---------------------------------------------------------------------------
-- 2. El corazón de la visita, compartido con agendar_visita (024)
-- ---------------------------------------------------------------------------

create function visita_nucleo(p_venta uuid, p_fecha timestamptz, p_nota text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  venta oportunidades%rowtype;
  tecnico perfiles%rowtype;
  nueva uuid;
begin
  select * into venta from oportunidades where id = p_venta for update;
  if venta.id is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'No se encontró la venta.');
  end if;
  if p_fecha is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'Elige la fecha y hora de la visita.');
  end if;
  if p_fecha < now() then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'La visita debe ser en el futuro.');
  end if;
  if venta.etapa in ('ganado', 'perdido') then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'La venta ya está cerrada.');
  end if;
  -- El técnico activo; si hubiera varios, siempre el mismo (por código)
  select * into tecnico from perfiles where perfiles.rol = 'tecnico' and activo order by codigo limit 1;
  if tecnico.id is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'No hay un técnico activo para asignar la visita.');
  end if;

  -- La visita queda asignada al técnico: le aparece en "Mis visitas" (vista visitas_tecnico)
  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
  values (venta.contacto_id, venta.id, tecnico.id, 'visita',
    coalesce(nullif(left(sin_bordes(p_nota), 300), ''), 'Visita técnica: revisar techo, sombras y tablero eléctrico.'),
    p_fecha, false)
  returning id into nueva;
  -- Solo si venía de antes; una venta en cotizado o negociación conserva su etapa
  update oportunidades set etapa = 'visita_agendada' where id = venta.id and etapa < 'visita_agendada';
  return jsonb_build_object('estado', 'hecho', 'actividad_id', nueva, 'tecnico', tecnico.nombre, 'tecnico_id', tecnico.id);
end;
$$;

create or replace function agendar_visita(p_oportunidad uuid, p_fecha timestamptz, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  externa boolean := es_conexion_externa();
  accion constant text := 'agendar_visita';
  referencia text := (select codigo from oportunidades where id = p_oportunidad);
  venta oportunidades%rowtype;
  rol_actual rol_usuario;
  motivo text;
  hecho jsonb;
begin
  if externa then
    motivo := puerta_de_app();
    if motivo is not null then
      return resultado_de_accion(accion, referencia, 'rechazada', motivo);
    end if;
  end if;

  rol_actual := mi_rol();
  if rol_actual is null or rol_actual not in ('gerente', 'asesor') then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Tu rol no agenda visitas.');
  end if;
  -- El candado de la agenda del técnico ANTES de la venta (el mismo orden del asistente, 026): así el
  -- asistente ve la visita que el CRM está guardando y no aparta ese horario a la vez. El CRM no
  -- rechaza choques (Laura puede querer dos visitas seguidas): solo espera su turno
  perform pg_advisory_xact_lock(hashtext('agenda:' || coalesce(
    (select id::text from perfiles where rol = 'tecnico' and activo order by codigo limit 1), '')));
  -- Bloqueada hasta terminar: si alguien la marca ganada a la vez, uno espera al otro
  select * into venta from oportunidades where id = p_oportunidad for update;
  -- Como el CRM hoy: la venta y el contacto tienen que ser suyos (o es la gerente)
  if venta.id is null or not (rol_actual = 'gerente' or (venta.asesor_id = auth.uid() and es_mi_contacto(venta.contacto_id))) then
    return resultado_de_accion(accion, null, 'rechazada', 'No se encontró la venta.');
  end if;
  if p_fecha is null then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Elige la fecha y hora de la visita.');
  end if;
  if p_fecha < now() then
    return resultado_de_accion(accion, referencia, 'rechazada', 'La visita debe ser en el futuro.');
  end if;
  if venta.etapa in ('ganado', 'perdido') then
    return resultado_de_accion(accion, referencia, 'rechazada', 'La venta ya está cerrada.');
  end if;
  -- Solo apps: el seguimiento cuenta una visita pendiente si es a 30 días o menos (vista seguimiento_ventas)
  if externa and p_fecha > now() + interval '30 days' then
    return resultado_de_accion(accion, referencia, 'rechazada', 'La visita debe ser en los próximos 30 días.');
  end if;
  if externa and exists (
    select 1 from actividades
    where oportunidad_id = venta.id and tipo = 'visita' and fecha = p_fecha and not completada
  ) then
    return resultado_de_accion(accion, referencia, 'ya_estaba', 'Esa visita ya estaba agendada.');
  end if;

  hecho := visita_nucleo(venta.id, p_fecha, p_nota);
  if hecho->>'estado' <> 'hecho' then
    return resultado_de_accion(accion, referencia, 'rechazada', hecho->>'mensaje');
  end if;
  return resultado_de_accion(accion, referencia, 'hecho', 'Visita agendada y asignada al técnico.',
    jsonb_build_object('actividad_id', hecho->'actividad_id', 'tecnico', hecho->>'tecnico', 'fecha', p_fecha));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Piezas internas
-- ---------------------------------------------------------------------------

-- Una fecha y hora de Bogotá dicha en palabras: "martes 3 de noviembre de 2026, 10:00 a. m."
create function fecha_en_palabras(p_fecha timestamptz) returns text
language sql stable as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from l)::int + 1]
    || ' ' || extract(day from l)::int || ' de '
    || (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from l)::int]
    || ' de ' || extract(year from l)::int || ', '
    || (case when extract(hour from l)::int % 12 = 0 then 12 else extract(hour from l)::int % 12 end)
    || ':' || to_char(l, 'MI') || case when extract(hour from l) < 12 then ' a. m.' else ' p. m.' end
  from (select p_fecha at time zone 'America/Bogota' as l) x
$$;

-- Los festivos de Colombia (Ley Emiliani: varios se pasan al lunes). Hay que agregar los de 2028 antes de
-- que acabe 2027; una prueba avisa cuando falten menos de 60 días.
create function festivos_colombia() returns date[]
language sql immutable as $$
  select array[
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18',
    '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12',
    '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10',
    '2027-05-31', '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18',
    '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25'
  ]::date[]
$$;

-- Los horarios de visita que ofrece el asistente: días hábiles (lunes a viernes, sin festivos) a las 8, 10,
-- 13 y 15 (hora de Bogotá; una visita dura cerca de una hora y termina antes de las 5), desde el siguiente
-- día hábil y hasta 30 días (lo que el seguimiento cuenta como visita pendiente). Libre = el técnico no
-- tiene otra visita a menos de 90 minutos, ni otra conversación del asistente pidió ese horario (así un
-- horario pedido con un celular que ya era de un cliente también queda apartado: la respuesta no delata
-- si alguien es cliente).
create function horarios_de_visita(p_desde date, p_cantidad integer) returns setof timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  with hoy as (select (now() at time zone 'America/Bogota')::date as d),
  tecnico as (select id from perfiles where rol = 'tecnico' and activo order by codigo limit 1),
  dias as (
    select g::date as d from hoy, generate_series(hoy.d + 1, hoy.d + 30, interval '1 day') g
    where extract(isodow from g) between 1 and 5 and g::date >= coalesce(p_desde, hoy.d + 1)
      and not g::date = any(festivos_colombia())
  ),
  candidatos as (
    select (d + h * interval '1 hour') at time zone 'America/Bogota' as fecha
    from dias, unnest(array[8, 10, 13, 15]) h
  )
  select c.fecha from candidatos c, tecnico t
  where c.fecha > now() and c.fecha <= now() + interval '30 days'
    and not exists (
      select 1 from actividades a
      where a.usuario_id = t.id and a.tipo = 'visita' and not a.completada
        and a.fecha > c.fecha - interval '90 minutes' and a.fecha < c.fecha + interval '90 minutes'
    )
    and not exists (
      select 1 from conversaciones_asistente ca
      where ca.visita_en > c.fecha - interval '90 minutes' and ca.visita_en < c.fecha + interval '90 minutes'
    )
  order by c.fecha
  limit least(greatest(coalesce(p_cantidad, 6), 1), 12)
$$;

-- El turno es válido si es de ese pedido, está en curso y no venció. Devuelve la conversación, bloqueada.
create function conversacion_del_turno(p_turno uuid, p_pedido uuid) returns conversaciones_asistente
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t turnos_asistente%rowtype;
  conv conversaciones_asistente%rowtype;
begin
  select * into t from turnos_asistente where id = p_turno;
  if not found or t.pedido is distinct from p_pedido or t.estado <> 'en_curso' then
    return null;
  end if;
  select * into conv from conversaciones_asistente where id = t.conversacion_id for update;
  if conv.turno_id is distinct from t.id or conv.turno_hasta < now() then
    return null;
  end if;
  return conv;
end;
$$;

-- Quién atiende: el asesor del contacto si sigue activo; si no, la gerente (la regla de capturar_lead)
create function responsable_del_contacto(p_contacto uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.id from contactos c join perfiles p on p.id = c.asesor_id where c.id = p_contacto and p.activo),
    (select id from perfiles where rol = 'gerente' and activo order by codigo limit 1)
  )
$$;

-- Cuándo contactan a la persona: hoy, si es día hábil antes de las 5 p. m.; si no, el siguiente día hábil
create function cuando_contactan() returns text
language sql stable as $$
  select case
    when extract(isodow from l) between 1 and 5 and extract(hour from l) < 17 then 'hoy mismo, en el horario de atención (hasta las 6 p. m.)'
    when extract(isodow from l) in (5, 6) or (extract(isodow from l) = 7) then 'el lunes desde las 8 a. m.'
    else 'mañana desde las 8 a. m.'
  end
  from (select now() at time zone 'America/Bogota' as l) x
$$;

-- ---------------------------------------------------------------------------
-- 4. Lo que puede hacer el asistente (además de las seis de la 025)
-- ---------------------------------------------------------------------------

-- El contexto que el asistente recibe en cada turno ahora dice si la persona dejó sus datos, si hay visita
-- y si se avisó a un asesor (create or replace: mismo cuerpo de la 025 más el contexto)
create or replace function asistente_tomar_turno(p_clave_hash text, p_huella text, p_pedido uuid, p_mensaje text, p_llama_claude boolean)
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
    'contexto', jsonb_build_object(
      'datos_dejados', conv.lead_tipo is not null,
      'visita', case when conv.visita_en is not null then 'pedida para el ' || fecha_en_palabras(conv.visita_en) end,
      'asesor_avisado', conv.asesor_avisado_en is not null
    ),
    'historial', case when p_llama_claude then coalesce((
      select jsonb_agg(jsonb_build_object('role', rol, 'content', contenido) order by orden)
      from mensajes_asistente where conversacion_id = conv.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- Atar a la conversación el lead que la persona dejó en el formulario del chat. Lo llama el servidor
-- después de registrar el lead por el camino de /cotiza. La base comprueba el envío (reciente, procesado)
-- y deja uno solo por conversación. La respuesta es igual sea el lead nuevo o no.
create function asistente_atar_lead(p_clave_hash text, p_clave_envio text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  conv conversaciones_asistente%rowtype;
  envio envios_recibidos%rowtype;
  tipo text;
  venta uuid;
begin
  -- Con la contraseña del asistente alguien podría hacerse pasar por una persona del equipo (el historial
  -- de etapas anota a quien dice la sesión): lo que hace el asistente siempre queda como "el sistema"
  perform set_config('request.jwt.claims', '', true);
  if coalesce(p_clave_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_clave_envio, '') !~ '^asistente:[0-9a-f-]{36}$' then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'datos_invalidos');
  end if;
  select * into conv from conversaciones_asistente where clave_hash = p_clave_hash for update;
  if not found or conv.texto_borrado_en is not null
     or conv.abierta_en < now() - make_interval(hours => (asistente_topes()->>'horas_por_conversacion')::int) then
    return jsonb_build_object('estado', 'sin_conversacion');
  end if;
  if conv.lead_tipo is not null then
    return jsonb_build_object('estado', 'ok'); -- ya tenía uno: se queda el primero
  end if;
  select * into envio from envios_recibidos
  where clave = p_clave_envio and recibido_en > now() - interval '10 minutes' and resultado is not null
    and contacto_id is not null;
  if not found then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'envio');
  end if;
  -- Ya atado a otra conversación: no se reutiliza
  if exists (select 1 from conversaciones_asistente where lead_clave = envio.clave) then
    return jsonb_build_object('estado', 'rechazada', 'motivo', 'envio');
  end if;

  tipo := case envio.resultado
    when 'creado' then 'nuevo'
    when 'existente' then 'existente'
    else 'revision'
  end;
  -- Solo un lead creado en este envío tiene una venta propia que se pueda agendar
  if tipo = 'nuevo' then
    select id into venta from oportunidades where contacto_id = envio.contacto_id order by creada_en desc limit 1;
  end if;
  update conversaciones_asistente
  set lead_clave = envio.clave, lead_tipo = tipo, contacto_id = envio.contacto_id, oportunidad_id = venta
  where id = conv.id;
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- Los próximos horarios libres para la visita
create function asistente_horarios(p_turno uuid, p_pedido uuid, p_desde date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  conv conversaciones_asistente%rowtype := conversacion_del_turno(p_turno, p_pedido);
begin
  if conv.id is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'Turno inválido.');
  end if;
  if conv.lead_tipo is null then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'La persona todavía no ha dejado sus datos: ofrece primero el formulario (pedir_datos_de_contacto).');
  end if;
  return jsonb_build_object(
    'estado', 'ok',
    'horarios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fecha', to_char(f at time zone 'America/Bogota', 'YYYY-MM-DD'),
        'hora', to_char(f at time zone 'America/Bogota', 'HH24:MI'),
        'en_palabras', fecha_en_palabras(f)) order by f)
      from horarios_de_visita(p_desde, 6) f
    ), '[]'::jsonb)
  );
end;
$$;

-- Agendar (o pedir) la visita de la persona que escribe
create function asistente_agendar_visita(p_turno uuid, p_pedido uuid, p_fecha date, p_hora text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  conv conversaciones_asistente%rowtype := conversacion_del_turno(p_turno, p_pedido);
  fecha timestamptz;
  tecnico uuid;
  hecho jsonb;
  destinatario uuid;
  respuesta text;
  huella_turno text := (select huella from turnos_asistente where id = p_turno);
begin
  perform set_config('request.jwt.claims', '', true);
  if conv.id is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'Turno inválido.');
  end if;
  if conv.lead_tipo is null then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'La persona todavía no ha dejado sus datos: ofrece primero el formulario (pedir_datos_de_contacto).');
  end if;
  if conv.visita_en is not null then
    return jsonb_build_object('estado', 'ya_estaba',
      'mensaje', 'Ya hay una visita pedida en esta conversación para el ' || fecha_en_palabras(conv.visita_en) || '.');
  end if;
  if p_fecha is null or coalesce(p_hora, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'Fecha u hora inválida: usa AAAA-MM-DD y HH:MM.');
  end if;
  fecha := (p_fecha + p_hora::time) at time zone 'America/Bogota';

  -- Revisar que el horario esté libre y apartarlo, en la misma operación y bajo el candado del técnico:
  -- dos conversaciones que eligen el mismo martes a las 10 no quedan las dos agendadas
  select id into tecnico from perfiles where rol = 'tecnico' and activo order by codigo limit 1;
  perform pg_advisory_xact_lock(hashtext('agenda:' || coalesce(tecnico::text, '')));
  -- Topes, bajo el mismo candado: nadie llena la agenda del mes con leads inventados. Una visita por persona
  -- al día y máximo 8 visitas del asistente pendientes a la vez; al llegar, se ofrece un asesor
  if exists (select 1 from avisos_asistente av join turnos_asistente t on t.conversacion_id = av.conversacion_id
             where av.tipo = 'visita' and av.creado_en >= inicio_del_dia_bogota() and t.huella = huella_turno)
     or (select count(*) from conversaciones_asistente where visita_en > now()) >= 8 then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'Por ahora no se pueden pedir más visitas desde el asistente. Ofrece pasar a un asesor (pasar_a_asesor).');
  end if;
  if not exists (select 1 from horarios_de_visita(p_fecha, 12) h where h = fecha) then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'Ese horario no está disponible. Ofrece los de horarios_disponibles.',
      'horarios', (select jsonb_agg(jsonb_build_object(
        'fecha', to_char(f at time zone 'America/Bogota', 'YYYY-MM-DD'),
        'hora', to_char(f at time zone 'America/Bogota', 'HH24:MI'),
        'en_palabras', fecha_en_palabras(f)) order by f) from horarios_de_visita(null, 6) f));
  end if;

  destinatario := responsable_del_contacto(conv.contacto_id);
  -- Solo un lead nuevo, sin otra visita pendiente en su venta, se agenda de verdad
  if conv.lead_tipo = 'nuevo' and conv.oportunidad_id is not null and not exists (
       select 1 from actividades where oportunidad_id = conv.oportunidad_id and tipo = 'visita' and not completada
     ) then
    hecho := visita_nucleo(conv.oportunidad_id, fecha, 'Agendada por el asistente Sol: confirmar con el cliente. Revisar techo, sombras y tablero eléctrico.');
    if hecho->>'estado' <> 'hecho' then
      return jsonb_build_object('estado', 'rechazada', 'mensaje', 'No se pudo agendar. Ofrece pasar a un asesor.');
    end if;
  else
    -- El celular ya era de alguien: no se toca la agenda ni se confirma nada del cliente; el asesor lo revisa
    insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
    values (conv.contacto_id, destinatario, 'tarea',
      'El asistente Sol recibió un pedido de visita técnica para el ' || fecha_en_palabras(fecha)
        || '. Confirmar con el cliente (revisar si es la misma persona) y agendarla.', now());
  end if;

  update conversaciones_asistente set visita_en = fecha where id = conv.id;
  insert into avisos_asistente (conversacion_id, tipo, contacto_id, destinatario_id, detalle)
  values (conv.id, 'visita', conv.contacto_id, destinatario,
    jsonb_build_object('fecha', fecha, 'en_palabras', fecha_en_palabras(fecha), 'agendada', conv.lead_tipo = 'nuevo'))
  on conflict (conversacion_id, tipo) do nothing;

  respuesta := 'Visita pedida para el ' || fecha_en_palabras(fecha) || '. Un asesor la confirmará con la persona.';
  return jsonb_build_object('estado', 'hecho', 'mensaje', respuesta, 'en_palabras', fecha_en_palabras(fecha));
end;
$$;

-- Pasar la conversación a un asesor: el resumen (hecho por IA) en la ficha, una tarea y el aviso
create function asistente_pasar_a_asesor(p_turno uuid, p_pedido uuid, p_resumen text, p_necesita text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  conv conversaciones_asistente%rowtype := conversacion_del_turno(p_turno, p_pedido);
  destinatario uuid;
  -- Lo escribió una IA a partir de lo que escribió un desconocido: una sola línea (no puede fingir
  -- "Sistema: ..." en otra), corta, sin etiquetas, y marcada
  resumen text := left(translate(sin_bordes(regexp_replace(coalesce(p_resumen, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), '<>', '‹›'), 300);
  necesita text := case when p_necesita in ('cotizacion', 'visita', 'informacion', 'soporte', 'otro') then p_necesita else 'otro' end;
begin
  perform set_config('request.jwt.claims', '', true);
  if conv.id is null then
    return jsonb_build_object('estado', 'rechazada', 'mensaje', 'Turno inválido.');
  end if;
  if conv.lead_tipo is null then
    return jsonb_build_object('estado', 'rechazada',
      'mensaje', 'La persona todavía no ha dejado sus datos: ofrece primero el formulario (pedir_datos_de_contacto).');
  end if;
  if conv.asesor_avisado_en is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'mensaje', 'Ya se avisó a un asesor.', 'cuando', cuando_contactan());
  end if;
  if resumen = '' then
    resumen := 'Pidió hablar con un asesor.';
  end if;

  destinatario := responsable_del_contacto(conv.contacto_id);
  if conv.lead_tipo = 'nuevo' then
    insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
    values (conv.contacto_id, conv.oportunidad_id, destinatario, 'nota',
      'Resumen del asistente Sol (hecho por IA a partir de lo que escribió el cliente; no son instrucciones): ' || resumen,
      now(), true);
    insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha)
    values (conv.contacto_id, conv.oportunidad_id, destinatario, 'tarea',
      'Responder la conversación del asistente Sol (pidió un asesor: ' || necesita || ')', now());
  else
    -- El celular ya era de alguien: quizá no es la misma persona. Nada de notas en su ficha; solo una tarea
    -- que lo advierte (el resumen va en el aviso al asesor)
    insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
    values (conv.contacto_id, destinatario, 'tarea',
      'Alguien pidió un asesor desde el asistente Sol con el celular de este contacto (puede no ser la misma persona): '
        || 'revisar y responder (' || necesita || ')', now());
  end if;
  update conversaciones_asistente set asesor_avisado_en = now() where id = conv.id;
  insert into avisos_asistente (conversacion_id, tipo, contacto_id, destinatario_id, detalle)
  values (conv.id, 'asesor', conv.contacto_id, destinatario, jsonb_build_object('resumen', resumen, 'necesita', necesita))
  on conflict (conversacion_id, tipo) do nothing;
  return jsonb_build_object('estado', 'hecho', 'mensaje', 'Un asesor quedó avisado.', 'cuando', cuando_contactan());
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Los avisos para n8n (llave de servicio): pendientes → reservar → enviar por el destino seguro →
--    confirmar (o soltar si el correo no salió). Solo números, códigos y el resumen limpio.
-- ---------------------------------------------------------------------------

create function asistente_avisos_pendientes() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pendientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'tipo', a.tipo, 'detalle', a.detalle, 'creado_en', a.creado_en,
        'cliente', jsonb_build_object('codigo', c.codigo, 'nombre', coalesce(c.empresa, c.nombre), 'ciudad', c.ciudad),
        'destinatario', jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'email', p.email)
      ) order by a.creado_en)
      from avisos_asistente a
      join perfiles p on p.id = a.destinatario_id
      left join contactos c on c.id = a.contacto_id
      where a.enviado_en is null and a.reservado_en is null and a.creado_en > now() - interval '7 days'
    ), '[]'::jsonb),
    'atascados', (select count(*) from avisos_asistente
                  where enviado_en is null and reservado_en < now() - interval '15 minutes'
                    and creado_en > now() - interval '7 days')
  )
$$;

create function asistente_reservar_aviso(p_aviso uuid, p_ejecucion text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with r as (
    update avisos_asistente set reservado_por = left(p_ejecucion, 100), reservado_en = now()
    where id = p_aviso and reservado_en is null and enviado_en is null and coalesce(trim(p_ejecucion), '') <> ''
    returning 1
  )
  select exists (select 1 from r)
$$;

create function asistente_confirmar_aviso(p_aviso uuid, p_ejecucion text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with r as (
    update avisos_asistente set enviado_en = coalesce(enviado_en, now())
    where id = p_aviso and reservado_por = left(p_ejecucion, 100)
    returning 1
  )
  select exists (select 1 from r)
$$;

create function asistente_soltar_aviso(p_aviso uuid, p_ejecucion text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with r as (
    update avisos_asistente set reservado_por = null, reservado_en = null
    where id = p_aviso and reservado_por = left(p_ejecucion, 100) and enviado_en is null
    returning 1
  )
  select exists (select 1 from r)
$$;

-- ---------------------------------------------------------------------------
-- 6. Permisos (lista exacta: tests/test_asistente_supabase.py)
-- ---------------------------------------------------------------------------

revoke execute on function
  visita_nucleo(uuid, timestamptz, text), fecha_en_palabras(timestamptz), festivos_colombia(),
  horarios_de_visita(date, integer),
  conversacion_del_turno(uuid, uuid), responsable_del_contacto(uuid), cuando_contactan(),
  asistente_atar_lead(text, text), asistente_horarios(uuid, uuid, date),
  asistente_agendar_visita(uuid, uuid, date, text), asistente_pasar_a_asesor(uuid, uuid, text, text),
  asistente_avisos_pendientes(), asistente_reservar_aviso(uuid, text), asistente_confirmar_aviso(uuid, text),
  asistente_soltar_aviso(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  asistente_atar_lead(text, text), asistente_horarios(uuid, uuid, date),
  asistente_agendar_visita(uuid, uuid, date, text), asistente_pasar_a_asesor(uuid, uuid, text, text)
to asistente_web;

grant execute on function
  asistente_avisos_pendientes(), asistente_reservar_aviso(uuid, text), asistente_confirmar_aviso(uuid, text),
  asistente_soltar_aviso(uuid, text)
to service_role;
