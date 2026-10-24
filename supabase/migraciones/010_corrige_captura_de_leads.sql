-- Correcciones a la captura de leads (migración 009), encontradas en la revisión de código.
-- La 009 ya estaba aplicada, así que no se edita: esta migración reemplaza las dos funciones.
--
-- 1. Un asesor sin ciudad quedaba primero en la fila y se llevaba todos los leads:
--    (null = 'Bogotá') es null, y al ordenar de mayor a menor Postgres pone los null primero.
-- 2. Si el asesor del contacto ya no está activo (renunció), la tarea quedaba a su nombre y nadie
--    la veía. Ahora va a la gerente, que decide a quién reasignar el cliente.
-- 3. Un dato raro tumbaba el lead completo (consumo fuera de rango o con decimales, "hogar" con
--    empresa, sin nombre de persona). Un lead vivo no puede perderse: se guarda igual.
-- 4. Dos leads al mismo tiempo podían irle al mismo asesor: la asignación ahora atiende de a uno.
-- 5. Supabase da por defecto permisos de más sobre las tablas nuevas: se quitan los de
--    envios_recibidos (nadie del equipo la toca directamente).

create or replace function asesor_para_lead(p_ciudad ciudad) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id
  from perfiles p
  where p.rol = 'asesor' and p.activo
  order by
    -- "is not distinct from": un asesor sin ciudad cuenta como "no es de esta ciudad", no como primero
    (p.ciudad is not distinct from p_ciudad) desc,
    (select max(c.creado_en) from contactos c where c.asesor_id = p.id) asc nulls first,
    p.codigo
  limit 1
$$;

create or replace function capturar_lead(
  p_clave text,
  p_canal canal_origen,
  p_contacto jsonb,
  p_mensaje text default null,
  p_existente text default null,
  p_duda text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  previo envios_recibidos%rowtype;
  contacto contactos%rowtype;
  venta_id uuid;
  responsable perfiles%rowtype; -- quien recibe la tarea: el asesor, o la gerente si el asesor ya no está
  asesor_inactivo boolean := false;
  decision text;
  ciudad_lead ciudad := (p_contacto->>'ciudad')::ciudad;
  empresa text := nullif(trim(p_contacto->>'empresa'), '');
  -- Con empresa es negocio (la misma regla de la importación de CSV)
  tipo tipo_contacto := case when empresa is not null then 'negocio'
                             else coalesce(nullif(p_contacto->>'tipo', ''), 'hogar') end::tipo_contacto;
  nombre text := coalesce(nullif(trim(p_contacto->>'nombre'), ''), empresa);
  consumo integer := round(nullif(p_contacto->>'consumo_kwh_mes', '')::numeric)::integer;
  nombre_visible text := coalesce(empresa, nombre);
  canal_texto text := case p_canal when 'web' then 'el formulario web' when 'whatsapp' then 'WhatsApp' else p_canal::text end;
  potencia numeric;
  valor bigint;
begin
  -- Radicar el envío. Si la clave ya existe, esto no inserta nada; si otro envío con la misma
  -- clave está en curso, espera a que termine y luego tampoco inserta.
  insert into envios_recibidos (clave, canal) values (p_clave, p_canal) on conflict (clave) do nothing;
  if not found then
    select * into previo from envios_recibidos where clave = p_clave;
    select * into contacto from contactos where id = previo.contacto_id;
    select * into responsable from perfiles where id = contacto.asesor_id;
    return jsonb_build_object(
      'resultado', 'ya_procesado',
      'resultado_original', previo.resultado,
      'codigo', contacto.codigo,
      'asesor', jsonb_build_object('codigo', responsable.codigo, 'nombre', responsable.nombre, 'email', responsable.email)
    );
  end if;

  if nombre is null then
    raise exception 'El lead no trae nombre ni empresa' using errcode = '22023';
  end if;
  if consumo is not null and consumo <= 0 then
    consumo := null; -- un consumo de 0 o negativo no dice nada
  end if;

  if p_existente is not null then
    -- Ya era cliente: no se duplica, se anota que volvió a escribir
    select * into contacto from contactos where codigo = p_existente;
    if not found then
      raise exception 'No existe el contacto %', p_existente using errcode = '22023';
    end if;
    decision := 'existente';
  else
    select * into contacto from contactos where telefono = p_contacto->>'telefono';
    if found then
      -- El celular ya es de otro contacto: no se crea otro ni se mezclan datos
      decision := 'revision';
    else
      -- Lead nuevo (o dudoso sin choque de celular): se crea con su primera venta
      decision := case when p_duda is null then 'creado' else 'revision' end;
      -- Fuera del rango de la cotización se guarda igual, con la venta por definir
      if consumo between 1 and 100000 then
        select c.potencia_kwp, c.valor_total into potencia, valor from calcular_cotizacion(consumo, ciudad_lead) c;
      end if;

      -- Un turno para asignar: si llegan dos leads a la vez, el segundo ve la asignación del primero
      perform pg_advisory_xact_lock(hashtext('asignar_leads'));

      insert into contactos (tipo, nombre, empresa, telefono, email, ciudad, consumo_kwh_mes, canal_origen, asesor_id)
      values (
        tipo, nombre, empresa, p_contacto->>'telefono', nullif(trim(p_contacto->>'email'), ''),
        ciudad_lead, consumo, p_canal, asesor_para_lead(ciudad_lead)
      )
      returning * into contacto;

      if contacto.asesor_id is null then
        raise exception 'No hay ningún asesor activo para asignar el lead' using errcode = '22023';
      end if;

      -- El trigger de la migración 001 anota el primer paso ("nuevo") en el historial
      insert into oportunidades (contacto_id, asesor_id, tipo, nombre, potencia_kwp, valor_cop)
      values (
        contacto.id, contacto.asesor_id, 'nueva',
        case when potencia is null then 'Sistema por definir - ' || nombre_visible
             else 'Sistema ' || replace(potencia::text, '.', ',') || ' kWp - ' || nombre_visible end,
        potencia,
        valor
      )
      returning id into venta_id;
    end if;
  end if;

  -- ¿Quién atiende? El asesor del contacto, si sigue activo; si no, la gerente
  select * into responsable from perfiles where id = contacto.asesor_id;
  if not responsable.activo then
    asesor_inactivo := true;
    select * into responsable from perfiles where rol = 'gerente' and activo order by codigo limit 1;
  end if;

  -- Las notas para revisar
  if decision = 'revision' and venta_id is null then
    insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
    values (
      contacto.id, responsable.id, 'nota',
      format('Escribió por %s alguien con este celular que podría ser otra persona: %s. %s',
             canal_texto, nombre_visible, coalesce(p_duda, 'Revisar si es la misma persona.')),
      now()
    );
  elsif p_duda is not null then
    insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
    values (contacto.id, responsable.id, 'nota', 'Posible duplicado, revisar: ' || p_duda, now());
  end if;

  -- Lo que escribió el cliente queda en su historial
  if nullif(trim(p_mensaje), '') is not null then
    insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha)
    values (
      contacto.id, venta_id, responsable.id,
      (case when p_canal = 'whatsapp' then 'whatsapp' else 'nota' end)::tipo_actividad,
      format('Mensaje por %s: %s', canal_texto, left(trim(p_mensaje), 2000)),
      now()
    );
  end if;

  -- La tarea: es lo que el flujo de seguimiento vigilará
  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha)
  values (
    contacto.id, venta_id, responsable.id, 'tarea',
    case
      when asesor_inactivo then format('Reasignar: el cliente escribió por %s y su asesor ya no está activo', canal_texto)
      when decision = 'existente' then format('Contactar: el cliente volvió a escribir por %s', canal_texto)
      when decision = 'revision' then format('Contactar y revisar si es un duplicado (llegó por %s)', canal_texto)
      else format('Contactar al lead nuevo (llegó por %s)', canal_texto)
    end,
    now()
  );

  update envios_recibidos set resultado = decision, contacto_id = contacto.id where clave = p_clave;

  return jsonb_build_object(
    'resultado', decision,
    'codigo', contacto.codigo,
    'nuevo', venta_id is not null,
    'asesor', jsonb_build_object('codigo', responsable.codigo, 'nombre', responsable.nombre, 'email', responsable.email),
    'asesor_inactivo', asesor_inactivo,
    -- Solo en leads nuevos: un cliente que ya existía conserva su asesor
    'fuera_de_ciudad', venta_id is not null and responsable.ciudad is distinct from contacto.ciudad,
    'duda', p_duda
  );
end;
$$;

-- "create or replace" conserva los permisos de la 009 (solo service_role); se repiten por claridad
revoke execute on function asesor_para_lead(ciudad) from public, anon, authenticated;
revoke execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function asesor_para_lead(ciudad) to service_role;
grant execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) to service_role;

revoke all on envios_recibidos from anon, authenticated;
