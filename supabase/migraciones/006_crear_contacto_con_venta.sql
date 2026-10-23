-- Crea un contacto y su primera venta en una sola operación: o se guardan los dos, o ninguno.
-- Si se guardaran por separado y fallara la venta, quedaría un contacto sin venta que el asesor
-- ni siquiera podría borrar (solo la gerente borra).
--
-- security invoker: corre con los permisos de quien la llama, así que las reglas de la
-- migración 001 se siguen aplicando (un asesor solo puede crear contactos a su nombre).

create function crear_contacto_con_venta(contacto jsonb, venta jsonb) returns text
language plpgsql security invoker set search_path = public as $$
declare
  nuevo contactos%rowtype;
begin
  insert into contactos (
    tipo, nombre, empresa, telefono, email, ciudad, direccion, estrato,
    consumo_kwh_mes, canal_origen, asesor_id
  ) values (
    (contacto->>'tipo')::tipo_contacto,
    contacto->>'nombre',
    nullif(contacto->>'empresa', ''),
    contacto->>'telefono',
    nullif(contacto->>'email', ''),
    (contacto->>'ciudad')::ciudad,
    nullif(contacto->>'direccion', ''),
    (contacto->>'estrato')::smallint,
    (contacto->>'consumo_kwh_mes')::integer,
    (contacto->>'canal_origen')::canal_origen,
    (contacto->>'asesor_id')::uuid
  )
  returning * into nuevo;

  -- El trigger de la migración 001 anota este primer paso ("nuevo") en el historial
  insert into oportunidades (contacto_id, asesor_id, tipo, nombre, potencia_kwp, valor_cop)
  values (
    nuevo.id,
    nuevo.asesor_id,
    'nueva',
    venta->>'nombre',
    (venta->>'potencia_kwp')::numeric,
    (venta->>'valor_cop')::bigint
  );

  return nuevo.codigo;
end;
$$;

revoke execute on function crear_contacto_con_venta(jsonb, jsonb) from public, anon;
grant execute on function crear_contacto_con_venta(jsonb, jsonb) to authenticated;
