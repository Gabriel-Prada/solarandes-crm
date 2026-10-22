-- Búsqueda de contactos que ignora tildes y mayúsculas: "panaderia" encuentra "Panadería".

create extension if not exists unaccent with schema extensions;

-- unaccent() no se declara "inmutable" (depende de un diccionario configurable), y una columna
-- calculada solo acepta funciones inmutables. Esta envoltura fija el diccionario y lo garantiza.
create function sin_tildes(texto text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, texto)
$$;

-- Campo de búsqueda que la base de datos mantiene sola cada vez que cambia el contacto
alter table contactos add column busqueda text generated always as (
  lower(sin_tildes(
    coalesce(nombre, '') || ' ' || coalesce(empresa, '') || ' ' || telefono || ' ' || codigo
  ))
) stored;
