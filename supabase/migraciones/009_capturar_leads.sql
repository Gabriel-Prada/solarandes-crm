-- Fase 3, flujo 1: captura de leads desde las automatizaciones (formulario web; después WhatsApp).
-- El diseño está en docs/plan-fase-3.md, sección 4.
--
-- n8n no escribe en las tablas: le entrega el lead a la puerta del CRM
-- (/api/automatizaciones/leads), que revisa duplicados con las reglas de la fase 2 y llama
-- a capturar_lead(). Aquí viven lo que no se puede romper: que un envío repetido no duplique
-- nada y a quién se asigna el lead.

-- ---------------------------------------------------------------------------
-- 1. El "libro de radicados": cada envío llega con una clave única.
--    La llave primaria es la que frena la segunda copia, aunque las dos lleguen juntas.
-- ---------------------------------------------------------------------------

create table envios_recibidos (
  clave text primary key check (length(clave) between 8 and 200),
  canal canal_origen not null,
  recibido_en timestamptz not null default now(),
  resultado text check (resultado in ('creado', 'existente', 'revision')),
  contacto_id uuid references contactos (id) on delete set null
);

-- Nadie del equipo la lee ni la escribe directamente: solo capturar_lead()
alter table envios_recibidos enable row level security;

-- ---------------------------------------------------------------------------
-- 2. A quién se asigna un lead nuevo (requisitos.md: "cada lead se asigna al asesor de su ciudad").
--    Primero los asesores activos de la ciudad; entre ellos, el que lleva más tiempo sin recibir
--    un contacto (rotación). Si la ciudad no tiene asesor activo, rota entre todos.
-- ---------------------------------------------------------------------------

create function asesor_para_lead(p_ciudad ciudad) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id
  from perfiles p
  where p.rol = 'asesor' and p.activo
  order by
    (p.ciudad = p_ciudad) desc,
    (select max(c.creado_en) from contactos c where c.asesor_id = p.id) asc nulls first,
    p.codigo
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3. Registrar un lead en una sola operación: o se guarda todo, o nada.
--
--    p_existente: código del contacto si la revisión de duplicados dijo "es la misma persona".
--    p_duda: el motivo, si la revisión no pudo decidir. En la captura lo dudoso NO se queda
--            afuera (un lead vivo no puede esperar): se crea y se avisa. Pero si su celular ya es
--            de otro contacto, no se puede crear (un celular = un contacto, migración 005) ni se
--            unen datos: se anota en ese contacto para que una persona decida.
--
--    security definer y solo para service_role: la llama la puerta del CRM, nunca el navegador.
--    Como no hay sesión, auth.uid() es nulo y el historial queda con cambiado_por vacío, que en
--    este modelo significa "lo hizo el sistema" (docs/modelo-datos.md, D2).
-- ---------------------------------------------------------------------------

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
  previo envios_recibidos%rowtype;
  contacto contactos%rowtype;
  venta_id uuid;
  asesor perfiles%rowtype;
  decision text;
  ciudad_lead ciudad := (p_contacto->>'ciudad')::ciudad;
  consumo integer := nullif(p_contacto->>'consumo_kwh_mes', '')::integer;
  nombre_visible text := coalesce(nullif(p_contacto->>'empresa', ''), p_contacto->>'nombre');
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
    select * into asesor from perfiles where id = contacto.asesor_id;
    return jsonb_build_object(
      'resultado', 'ya_procesado',
      'resultado_original', previo.resultado,
      'codigo', contacto.codigo,
      'asesor', jsonb_build_object('codigo', asesor.codigo, 'nombre', asesor.nombre, 'email', asesor.email)
    );
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
      insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
      values (
        contacto.id, contacto.asesor_id, 'nota',
        format('Escribió por %s alguien con este celular que podría ser otra persona: %s. %s',
               canal_texto, nombre_visible, coalesce(p_duda, 'Revisar si es la misma persona.')),
        now()
      );
    else
      -- Lead nuevo (o dudoso sin choque de celular): se crea con su primera venta
      decision := case when p_duda is null then 'creado' else 'revision' end;
      if consumo is not null then
        select c.potencia_kwp, c.valor_total into potencia, valor from calcular_cotizacion(consumo, ciudad_lead) c;
      end if;

      insert into contactos (tipo, nombre, empresa, telefono, email, ciudad, consumo_kwh_mes, canal_origen, asesor_id)
      values (
        (p_contacto->>'tipo')::tipo_contacto,
        p_contacto->>'nombre',
        nullif(p_contacto->>'empresa', ''),
        p_contacto->>'telefono',
        nullif(p_contacto->>'email', ''),
        ciudad_lead,
        consumo,
        p_canal,
        asesor_para_lead(ciudad_lead)
      )
      returning * into contacto;

      if contacto.asesor_id is null then
        raise exception 'No hay ningún asesor activo para asignar el lead' using errcode = '22023';
      end if;

      -- El trigger de la migración 001 anota el primer paso ("nuevo") en el historial
      insert into oportunidades (contacto_id, asesor_id, tipo, nombre, potencia_kwp, valor_cop)
      values (
        contacto.id, contacto.asesor_id, 'nueva',
        case when consumo is null then 'Sistema por definir - ' || nombre_visible
             else 'Sistema ' || replace(potencia::text, '.', ',') || ' kWp - ' || nombre_visible end,
        potencia,
        valor
      )
      returning id into venta_id;

      if p_duda is not null then
        insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)
        values (contacto.id, contacto.asesor_id, 'nota', 'Posible duplicado, revisar: ' || p_duda, now());
      end if;
    end if;
  end if;

  select * into asesor from perfiles where id = contacto.asesor_id;

  -- Lo que escribió el cliente queda en su historial
  if nullif(trim(p_mensaje), '') is not null then
    insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha)
    values (
      contacto.id, venta_id, contacto.asesor_id,
      (case when p_canal = 'whatsapp' then 'whatsapp' else 'nota' end)::tipo_actividad,
      format('Mensaje por %s: %s', canal_texto, left(trim(p_mensaje), 2000)),
      now()
    );
  end if;

  -- La tarea del asesor: es lo que el flujo de seguimiento vigilará
  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha)
  values (
    contacto.id, venta_id, contacto.asesor_id, 'tarea',
    case decision
      when 'existente' then format('Contactar: el cliente volvió a escribir por %s', canal_texto)
      when 'revision' then format('Contactar y revisar si es un duplicado (llegó por %s)', canal_texto)
      else format('Contactar al lead nuevo (llegó por %s)', canal_texto)
    end,
    now()
  );

  update envios_recibidos set resultado = decision, contacto_id = contacto.id where clave = p_clave;

  return jsonb_build_object(
    'resultado', decision,
    'codigo', contacto.codigo,
    'nuevo', venta_id is not null,
    'asesor', jsonb_build_object('codigo', asesor.codigo, 'nombre', asesor.nombre, 'email', asesor.email),
    -- Solo en leads nuevos: un cliente que ya existía conserva su asesor
    'fuera_de_ciudad', venta_id is not null and asesor.ciudad is distinct from contacto.ciudad,
    'duda', p_duda
  );
end;
$$;

-- Solo la puerta del CRM (llave de servicio) puede registrar leads y elegir asesor
revoke execute on function asesor_para_lead(ciudad) from public, anon, authenticated;
revoke execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function asesor_para_lead(ciudad) to service_role;
grant execute on function capturar_lead(text, canal_origen, jsonb, text, text, text) to service_role;
