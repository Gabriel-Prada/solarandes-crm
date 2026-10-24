-- La puerta de las automatizaciones (/api/automatizaciones/leads) usa la llave de servicio y
-- necesita comparar cada lead con los contactos del CRM para encontrar duplicados.
--
-- El proyecto no da permisos sobre las tablas por defecto (migración 001), ni siquiera a la llave
-- de servicio. Aquí se le da lo mínimo: leer las seis columnas que se comparan. Nada de consumos,
-- direcciones ni valores, y nada de escribir directo: para escribir solo tiene capturar_lead().

grant usage on schema public to service_role;
grant select (codigo, nombre, empresa, telefono, email, ciudad) on contactos to service_role;
