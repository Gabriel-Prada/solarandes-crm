-- Lo que necesita el CRM para empezar ventas desde cero y cotizar.

-- 1. Un teléfono = un contacto. La regla vive aquí porque un asesor no puede ver los
--    contactos de los demás (RLS) y por eso no podría comprobar duplicados desde la app.
alter table contactos add constraint contactos_telefono_unico unique (telefono);

-- 2. Numeración y versiones de las cotizaciones.
--    security definer: para numerar hay que ver TODAS las cotizaciones, y un asesor solo ve
--    las suyas; si numerara "en su nombre", podría repetir el número de otro asesor.
create function preparar_cotizacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  anio text := to_char(coalesce(new.fecha, now()) at time zone 'America/Bogota', 'YYYY');
  siguiente integer;
begin
  if en_carga_masiva() then
    return new; -- los datos de prueba ya traen su número y versión
  end if;

  -- Candado: si dos asesores cotizan al mismo tiempo, uno espera al otro y no se repite el número
  perform pg_advisory_xact_lock(hashtext('numeracion_cotizaciones'));

  select coalesce(max(split_part(numero, '-', 3)::integer), 0) + 1 into siguiente
  from cotizaciones
  where numero like 'COT-' || anio || '-%';
  new.numero := 'COT-' || anio || '-' || lpad(siguiente::text, 4, '0');

  -- Versión dentro de la venta: 1 la primera, 2 la siguiente... La anterior queda "reemplazada"
  select coalesce(max(version), 0) + 1 into new.version
  from cotizaciones
  where oportunidad_id = new.oportunidad_id;

  update cotizaciones set estado = 'reemplazada'
  where oportunidad_id = new.oportunidad_id and estado = 'enviada';

  return new;
end;
$$;

create trigger cotizaciones_numerar
  before insert on cotizaciones
  for each row execute function preparar_cotizacion();
