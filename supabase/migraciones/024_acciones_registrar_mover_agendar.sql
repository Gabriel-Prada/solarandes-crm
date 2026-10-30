-- Fase 5, pieza 3: las tres acciones (docs/plan-fase-5.md, sección 5, "La pieza 3, diseñada").
--
-- registrar_actividad, mover_venta y agendar_visita son la ÚNICA puerta por la que una app conectada
-- (Claude, con la llave de la gerente) puede escribir en el CRM: la 023 le cierra todo lo demás.
-- El CRM también las usa, así que cada regla existe una sola vez (antes vivían en TypeScript, en las
-- acciones del servidor del CRM). Las reglas que valen solo para las apps van marcadas con "externa".
--
-- Las funciones DEVUELVEN el resultado ({estado: hecho | ya_estaba | rechazada, mensaje}) en vez de
-- lanzar errores: un error deshace todo, también el registro, y un intento rechazado de una app
-- (por ejemplo "mueve a ganado", llegado por inyección) tiene que quedar a la vista. Por lo mismo, el
-- tipo, la etapa y el motivo llegan como texto y se convierten adentro: un valor inventado se
-- rechaza y queda anotado, en vez de fallar antes de empezar.
-- Pruebas: tests/test_acciones_supabase.py.

-- ---------------------------------------------------------------------------
-- 1. El registro de lo que hacen las apps (también lo rechazado). Solo lo escriben las funciones.
-- ---------------------------------------------------------------------------

create table acciones_de_apps (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references perfiles (id),
  client_id text not null,
  accion text not null check (accion in ('registrar_actividad', 'mover_venta', 'agendar_visita')),
  referencia text,
  resultado text not null check (resultado in ('hecho', 'ya_estaba', 'rechazada')),
  motivo text,
  creada_en timestamptz not null default now()
);

create index acciones_de_apps_por_persona on acciones_de_apps (usuario_id, creada_en);

alter table acciones_de_apps enable row level security;
revoke all on acciones_de_apps from anon, authenticated;
grant select on acciones_de_apps to authenticated;
create policy "la gerente ve las acciones de las apps" on acciones_de_apps for select to authenticated
  using ((select mi_rol()) = 'gerente');

-- Cuántas acciones hechas por día, y cuántos rechazos se anotan como máximo (un ciclo que insista
-- después del tope no debe llenar el registro sin fin)
create function tope_acciones_de_apps_dia() returns integer language sql immutable as $$ select 50 $$;
create function tope_rechazos_anotados_dia() returns integer language sql immutable as $$ select 200 $$;

create function inicio_del_dia_bogota() returns timestamptz
language sql stable as $$
  select date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
$$;

-- Quita espacios, tabuladores y saltos de línea de las puntas (trim() solo quita espacios)
create function sin_bordes(texto text) returns text
language sql immutable as $$ select btrim(coalesce(texto, ''), E' \t\r\n') $$;

-- Anota la acción si la hizo una app. El client_id sale de la llave, nunca de un parámetro.
create function anotar_accion_de_app(p_accion text, p_referencia text, p_resultado text, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_conexion_externa() or not exists (select 1 from perfiles where id = auth.uid()) then
    return;
  end if;
  if p_resultado = 'rechazada' and (
    select count(*) from acciones_de_apps
    where usuario_id = auth.uid() and resultado = 'rechazada' and creada_en >= inicio_del_dia_bogota()
  ) >= tope_rechazos_anotados_dia() then
    return;
  end if;
  insert into acciones_de_apps (usuario_id, client_id, accion, referencia, resultado, motivo)
  values (auth.uid(), auth.jwt() ->> 'client_id', p_accion, p_referencia, p_resultado, p_motivo);
end;
$$;

-- El resultado de una acción, anotado si vino de una app
create function resultado_de_accion(p_accion text, p_referencia text, p_estado text, p_mensaje text, p_extra jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform anotar_accion_de_app(p_accion, p_referencia, p_estado, case when p_estado = 'rechazada' then p_mensaje end);
  return jsonb_build_object('estado', p_estado, 'mensaje', p_mensaje) || coalesce(p_extra, '{}');
end;
$$;

-- La puerta de las apps, revisada en la base y no solo en el MCP: la llave también sirve para hablarle
-- directo a Supabase. Toma un candado por persona ANTES de leer nada, para que dos pedidos a la vez
-- no pasen los dos con 49, ni los dos vean "no hay repetido", ni uno lea una venta que el otro está
-- cambiando. El tope cuenta solo lo hecho (los rechazos no gastan el cupo del día).
-- Devuelve el motivo del rechazo, o null.
create function puerta_de_app() returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('acciones_apps:' || coalesce(auth.uid()::text, '')));
  if not mi_app_esta_aprobada() then
    return 'Esta aplicación no está aprobada para usar el CRM.';
  end if;
  if mi_rol() is distinct from 'gerente' then
    return 'Por ahora solo la gerente puede actuar en el CRM desde Claude.';
  end if;
  if (select count(*) from acciones_de_apps
      where usuario_id = auth.uid() and resultado in ('hecho', 'ya_estaba') and creada_en >= inicio_del_dia_bogota())
     >= tope_acciones_de_apps_dia() then
    return format('Llegaste al máximo de %s acciones desde Claude por hoy; sigue en el CRM.', tope_acciones_de_apps_dia());
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Registrar una actividad (antes: registrarActividad del CRM)
-- ---------------------------------------------------------------------------

create function registrar_actividad(
  p_contacto uuid,
  p_oportunidad uuid,
  p_tipo text,
  p_descripcion text,
  p_fecha timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  externa boolean := es_conexion_externa();
  accion constant text := 'registrar_actividad';
  referencia text := (select codigo from contactos where id = p_contacto);
  contacto contactos%rowtype;
  rol_actual rol_usuario;
  tipo_elegido tipo_actividad;
  descripcion_limpia text := sin_bordes(p_descripcion);
  fecha_actividad timestamptz := now();
  motivo text;
  nueva uuid;
begin
  if externa then
    motivo := puerta_de_app();
    if motivo is not null then
      return resultado_de_accion(accion, referencia, 'rechazada', motivo);
    end if;
  end if;

  rol_actual := mi_rol();
  if rol_actual is null or rol_actual not in ('gerente', 'asesor') then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Tu rol no registra actividades.');
  end if;
  select * into contacto from contactos where id = p_contacto;
  -- Lo mismo que revisaría RLS: el contacto es suyo, o es la gerente (mismo mensaje si no existe)
  if contacto.id is null or not (rol_actual = 'gerente' or contacto.asesor_id = auth.uid()) then
    return resultado_de_accion(accion, null, 'rechazada', 'No se encontró el cliente.');
  end if;
  begin
    tipo_elegido := p_tipo::tipo_actividad;
  exception when invalid_text_representation then
    tipo_elegido := null;
  end;
  if tipo_elegido is null or tipo_elegido not in ('llamada', 'whatsapp', 'correo', 'nota', 'tarea') then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Elige un tipo de actividad.');
  end if;
  if length(descripcion_limpia) < 3 or length(descripcion_limpia) > 500 then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Escribe una descripción de entre 3 y 500 caracteres.');
  end if;

  if tipo_elegido = 'tarea' then
    if p_fecha is null then
      return resultado_de_accion(accion, referencia, 'rechazada', 'Elige la fecha y hora de la tarea.');
    end if;
    -- Solo apps: una tarea con fecha pasada nacería vencida y caería en los resúmenes de seguimiento
    if externa and (p_fecha <= now() or p_fecha > now() + interval '30 days') then
      return resultado_de_accion(accion, referencia, 'rechazada', 'La tarea debe ser en los próximos 30 días.');
    end if;
    fecha_actividad := p_fecha;
  end if;

  -- La venta tiene que ser de este contacto y de quien la anota (o es la gerente), como lo hacía RLS
  if p_oportunidad is not null and not exists (
    select 1 from oportunidades
    where id = p_oportunidad and contacto_id = p_contacto and (rol_actual = 'gerente' or asesor_id = auth.uid())
  ) then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Esa venta no pertenece a este contacto.');
  end if;

  -- Solo apps: un reintento de Claude no duplica (en el CRM, dos llamadas iguales seguidas son normales)
  if externa and exists (
    select 1 from actividades a
    where a.contacto_id = p_contacto and a.usuario_id = auth.uid() and a.tipo = tipo_elegido
      and a.descripcion = descripcion_limpia and a.creada_en > now() - interval '10 minutes'
  ) then
    return resultado_de_accion(accion, referencia, 'ya_estaba', 'Esa actividad ya estaba registrada.');
  end if;

  -- Quien la anota es el responsable; lo que no es tarea ya ocurrió (queda hecho, con fecha de ahora)
  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
  values (p_contacto, p_oportunidad, auth.uid(), tipo_elegido, descripcion_limpia, fecha_actividad, tipo_elegido <> 'tarea')
  returning id into nueva;

  return resultado_de_accion(accion, referencia, 'hecho', 'Actividad registrada.', jsonb_build_object('actividad_id', nueva));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Mover una venta de etapa (antes: moverOportunidad del CRM). El historial, la fecha de cierre y la
--    probabilidad los pone el trigger registrar_cambio_etapa, que anota a auth.uid() (quien llama).
-- ---------------------------------------------------------------------------

create function mover_venta(p_oportunidad uuid, p_etapa text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  externa boolean := es_conexion_externa();
  accion constant text := 'mover_venta';
  referencia text := (select codigo from oportunidades where id = p_oportunidad);
  venta oportunidades%rowtype;
  rol_actual rol_usuario;
  etapa_nueva etapa_oportunidad;
  motivo_nuevo motivo_perdida;
  motivo text;
begin
  -- Primero la puerta (y su candado), después la venta, bloqueada hasta terminar (for update): así
  -- nadie la cambia entre que se revisa y se mueve
  if externa then
    motivo := puerta_de_app();
    if motivo is not null then
      return resultado_de_accion(accion, referencia, 'rechazada', motivo);
    end if;
  end if;

  rol_actual := mi_rol();
  if rol_actual is null or rol_actual not in ('gerente', 'asesor') then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Tu rol no mueve ventas.');
  end if;
  select * into venta from oportunidades where id = p_oportunidad for update;
  if venta.id is null or not (rol_actual = 'gerente' or venta.asesor_id = auth.uid()) then
    return resultado_de_accion(accion, null, 'rechazada', 'No se encontró la venta.');
  end if;
  begin
    etapa_nueva := p_etapa::etapa_oportunidad;
    motivo_nuevo := nullif(p_motivo, '')::motivo_perdida;
  exception when invalid_text_representation then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Etapa o motivo no válido.');
  end;
  if etapa_nueva is null then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Etapa no válida.');
  end if;
  if etapa_nueva = 'perdido' and motivo_nuevo is null then
    return resultado_de_accion(accion, referencia, 'rechazada', 'Para marcar una venta como perdida hay que indicar el motivo.');
  end if;

  -- Solo apps (decisión 2 de Gabriel): ganar dispara la posventa de n8n; reabrir se hace en el tablero
  if externa and venta.etapa in ('ganado', 'perdido') then
    return resultado_de_accion(accion, referencia, 'rechazada',
      'La venta ya está cerrada: solo se puede reabrir desde el tablero del CRM.');
  end if;
  if externa and etapa_nueva = 'ganado' then
    return resultado_de_accion(accion, referencia, 'rechazada',
      'Marcar una venta como ganada se hace en el tablero del CRM: dispara la posventa.');
  end if;

  if venta.etapa = etapa_nueva
     and venta.motivo_perdida is not distinct from (case when etapa_nueva = 'perdido' then motivo_nuevo end) then
    return resultado_de_accion(accion, referencia, 'ya_estaba', 'La venta ya estaba en esa etapa.');
  end if;

  update oportunidades
  set etapa = etapa_nueva, motivo_perdida = case when etapa_nueva = 'perdido' then motivo_nuevo end
  where id = venta.id;

  return resultado_de_accion(accion, referencia, 'hecho', 'Venta movida.',
    jsonb_build_object('etapa_anterior', venta.etapa, 'etapa_nueva', etapa_nueva));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Agendar una visita técnica (antes: agendarVisita del CRM)
-- ---------------------------------------------------------------------------

create function agendar_visita(p_oportunidad uuid, p_fecha timestamptz, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  externa boolean := es_conexion_externa();
  accion constant text := 'agendar_visita';
  referencia text := (select codigo from oportunidades where id = p_oportunidad);
  venta oportunidades%rowtype;
  rol_actual rol_usuario;
  tecnico perfiles%rowtype;
  nota text := left(sin_bordes(p_nota), 300);
  motivo text;
  nueva uuid;
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

  -- El técnico activo; si hubiera varios, siempre el mismo (por código)
  select * into tecnico from perfiles where perfiles.rol = 'tecnico' and activo order by codigo limit 1;
  if tecnico.id is null then
    return resultado_de_accion(accion, referencia, 'rechazada', 'No hay un técnico activo para asignar la visita.');
  end if;

  if externa and exists (
    select 1 from actividades
    where oportunidad_id = venta.id and tipo = 'visita' and fecha = p_fecha and not completada
  ) then
    return resultado_de_accion(accion, referencia, 'ya_estaba', 'Esa visita ya estaba agendada.');
  end if;

  -- La visita queda asignada al técnico: le aparece en "Mis visitas" (vista visitas_tecnico)
  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
  values (venta.contacto_id, venta.id, tecnico.id, 'visita',
    coalesce(nullif(nota, ''), 'Visita técnica: revisar techo, sombras y tablero eléctrico.'), p_fecha, false)
  returning id into nueva;

  -- Solo si venía de antes; una venta en cotizado o negociación conserva su etapa
  update oportunidades set etapa = 'visita_agendada' where id = venta.id and etapa < 'visita_agendada';

  return resultado_de_accion(accion, referencia, 'hecho', 'Visita agendada y asignada al técnico.',
    jsonb_build_object('actividad_id', nueva, 'tecnico', tecnico.nombre, 'fecha', p_fecha));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permisos. Las tres acciones, para quien tiene sesión; las piezas internas, para nadie (solo las
--    usan las funciones, que corren con el permiso de su dueño).
-- ---------------------------------------------------------------------------

revoke execute on function
  tope_acciones_de_apps_dia(), tope_rechazos_anotados_dia(), inicio_del_dia_bogota(), sin_bordes(text),
  anotar_accion_de_app(text, text, text, text), resultado_de_accion(text, text, text, text, jsonb), puerta_de_app()
from public, anon, authenticated;

revoke execute on function
  registrar_actividad(uuid, uuid, text, text, timestamptz),
  mover_venta(uuid, text, text),
  agendar_visita(uuid, timestamptz, text)
from public, anon;
grant execute on function
  registrar_actividad(uuid, uuid, text, text, timestamptz),
  mover_venta(uuid, text, text),
  agendar_visita(uuid, timestamptz, text)
to authenticated;
