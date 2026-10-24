-- Los avisos de un lead (bienvenida, aviso al asesor, aviso a la gerente) deben salir una sola vez.
--
-- Se probó primero con una tabla en n8n ("¿ya se avisó?" y anotar al terminar), y en una prueba en vivo
-- los avisos salieron dos veces: el mismo envío llegó de nuevo mientras los primeros correos todavía
-- se estaban mandando, y la revisión no encontró nada anotado. Es el problema de "revisar y después
-- actuar": entre las dos cosas queda una ventana. Como con la clave del envío (migración 009), lo que
-- no se puede romper vive en la base de datos: reservar los avisos es una sola operación, y solo la
-- primera ejecución que la pide la obtiene, aunque dos lleguen al mismo tiempo.

alter table envios_recibidos add column avisos_reservados_en timestamptz;

-- true una sola vez por clave: a la primera ejecución que pide avisar. false si ya los reservó otra
-- o si la clave no existe (el lead nunca quedó registrado)
create function reservar_avisos(p_clave text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- El update toma la fila con candado: si dos llegan juntas, la segunda espera y ya no la encuentra vacía
  update envios_recibidos set avisos_reservados_en = now()
  where clave = p_clave and avisos_reservados_en is null;
  return found;
end;
$$;

revoke execute on function reservar_avisos(text) from public, anon, authenticated;
grant execute on function reservar_avisos(text) to service_role;
