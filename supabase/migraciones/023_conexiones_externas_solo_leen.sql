-- Fase 5: las conexiones de afuera solo leen (docs/plan-fase-5.md, sección 4).
--
-- Cuando la gerente conecta Claude al CRM, Supabase le entrega a Claude una llave a nombre de ella
-- (OAuth). Esa llave es una llave a la base: quien la tenga podría hablarle a Supabase directamente,
-- sin pasar por el MCP, y la gerente sí tiene permiso de borrar. Por eso el candado vive aquí:
-- toda llave que trae la marca client_id (la app que la pidió) puede leer lo que su dueño ve, pero no
-- insertar, cambiar ni borrar. Las acciones del MCP (fase 5, pieza 3) pasarán por funciones de lista
-- blanca. Las pruebas están en tests/test_conexiones_externas_supabase.py.

-- ---------------------------------------------------------------------------
-- 1. ¿La llave viene de una app conectada?
-- ---------------------------------------------------------------------------

create function es_conexion_externa() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
$$;

-- ---------------------------------------------------------------------------
-- 2. Reglas restrictivas: se suman a las de siempre y solo pueden quitar permisos, nunca dar.
--    Tres por tabla (insertar, cambiar, borrar) y ninguna para leer: una regla "for all"
--    también bloquearía la lectura. Son las tablas donde una sesión puede escribir; una prueba
--    falla si aparece otra sin su regla.
-- ---------------------------------------------------------------------------

do $$
declare
  tabla text;
begin
  foreach tabla in array array['contactos', 'oportunidades', 'actividades', 'perfiles', 'productos'] loop
    execute format(
      'create policy "apps conectadas no insertan" on %I as restrictive for insert to authenticated
         with check (not (select es_conexion_externa()))', tabla);
    execute format(
      'create policy "apps conectadas no cambian" on %I as restrictive for update to authenticated
         using (not (select es_conexion_externa())) with check (not (select es_conexion_externa()))', tabla);
    execute format(
      'create policy "apps conectadas no borran" on %I as restrictive for delete to authenticated
         using (not (select es_conexion_externa()))', tabla);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Las funciones con permiso propio se saltan RLS (su dueño, postgres, no tiene reglas), así que
--    las dos que escriben y una sesión puede ejecutar reciben el mismo freno. El resto del cuerpo
--    es igual al de las migraciones 007 y 020.
-- ---------------------------------------------------------------------------

create or replace function crear_cotizacion(p_oportunidad_id uuid, p_consumo integer, p_descuento numeric default 0)
returns text
language plpgsql security definer set search_path = public as $$
declare
  venta oportunidades%rowtype;
  ciudad_contacto ciudad;
  calculo record;
  descuento numeric := round(coalesce(p_descuento, 0), 1);
  numero_nuevo text;
begin
  if es_conexion_externa() then
    raise exception 'Las aplicaciones conectadas solo pueden leer' using errcode = '42501';
  end if;

  select * into venta from oportunidades where id = p_oportunidad_id;
  if venta.id is null or not (
    mi_rol() = 'gerente' or (mi_rol() = 'asesor' and venta.asesor_id = auth.uid())
  ) then
    -- Mismo mensaje si no existe o si es ajena: no revela qué ventas existen
    raise exception 'Venta no encontrada' using errcode = '42501';
  end if;
  if venta.etapa in ('ganado', 'perdido') then
    raise exception 'La venta ya está cerrada' using errcode = '22023';
  end if;

  select ciudad into ciudad_contacto from contactos where id = venta.contacto_id;
  select * into calculo from calcular_cotizacion(p_consumo, ciudad_contacto, descuento);

  -- El número y la versión los pone el trigger preparar_cotizacion (migración 005)
  insert into cotizaciones (oportunidad_id, consumo_kwh_mes, potencia_kwp, num_paneles, precio_kwp, descuento_pct, valor_total)
  values (venta.id, p_consumo, calculo.potencia_kwp, calculo.num_paneles, calculo.precio_kwp, descuento, calculo.valor_total)
  returning numero into numero_nuevo;

  -- La venta toma el valor cotizado y, si venía de atrás, pasa a "cotizado"
  -- (el trigger de la migración 001 anota el cambio en el historial con quien llamó la función)
  update oportunidades set
    valor_cop = calculo.valor_total,
    potencia_kwp = calculo.potencia_kwp,
    etapa = case when etapa < 'cotizado' then 'cotizado'::etapa_oportunidad else etapa end
  where id = venta.id;

  insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
  values (
    venta.contacto_id, venta.id, auth.uid(), 'correo',
    format('Envío de cotización %s: %s paneles, %s kWp, $%s.',
      numero_nuevo, calculo.num_paneles, replace(calculo.potencia_kwp::text, '.', ','),
      replace(to_char(calculo.valor_total, 'FM999,999,999,999'), ',', '.')),
    now(), true
  );

  return numero_nuevo;
end;
$$;

create or replace function cambiar_prioridad(p_calificacion uuid, p_prioridad prioridad_lead) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_contacto uuid;
begin
  if es_conexion_externa() then
    raise exception 'Las aplicaciones conectadas solo pueden leer' using errcode = '42501';
  end if;

  select contacto_id into v_contacto from calificaciones_lead where id = p_calificacion;
  if v_contacto is null or not ((select mi_rol()) = 'gerente' or es_mi_contacto(v_contacto)) then
    raise exception 'No puedes cambiar esta prioridad' using errcode = '42501';
  end if;
  update calificaciones_lead
  set prioridad_asesor = p_prioridad,
      prioridad_asesor_por = case when p_prioridad is null then null else auth.uid() end,
      prioridad_asesor_en = case when p_prioridad is null then null else now() end
  where id = p_calificacion;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Las apps aprobadas. Las llaves de Supabase no dicen para qué servidor son, así que el MCP
--    solo acepta llaves de apps que la gerente aprobó en /oauth/consent. Borrar la fila corta la
--    app en el siguiente pedido; para que al reconectar vuelva a preguntar, además se le quita el
--    permiso en Supabase (revokeGrant o el panel).
-- ---------------------------------------------------------------------------

create table apps_conectadas (
  client_id text primary key,
  nombre text not null default '',
  dominio_regreso text not null,
  aprobada_por uuid not null references perfiles (id),
  aprobada_en timestamptz not null default now()
);

alter table apps_conectadas enable row level security;
revoke all on apps_conectadas from anon, authenticated;
grant select on apps_conectadas to authenticated;
create policy "la gerente ve las apps conectadas" on apps_conectadas for select to authenticated
  using ((select mi_rol()) = 'gerente');

-- La llama la página de autorización con la sesión normal de la gerente, nunca una app conectada
create function aprobar_app(p_client_id text, p_nombre text, p_dominio text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if es_conexion_externa() then
    raise exception 'Las aplicaciones conectadas solo pueden leer' using errcode = '42501';
  end if;
  if mi_rol() is distinct from 'gerente' then
    raise exception 'Solo la gerente puede aprobar aplicaciones' using errcode = '42501';
  end if;
  if coalesce(p_client_id, '') = '' or coalesce(p_dominio, '') = '' then
    raise exception 'Faltan los datos de la aplicación' using errcode = '22023';
  end if;
  insert into apps_conectadas (client_id, nombre, dominio_regreso, aprobada_por)
  values (p_client_id, left(coalesce(p_nombre, ''), 200), left(p_dominio, 200), auth.uid())
  on conflict (client_id) do update
    set nombre = excluded.nombre, dominio_regreso = excluded.dominio_regreso,
        aprobada_por = excluded.aprobada_por, aprobada_en = now();
end;
$$;

-- ¿La app de la llave con que se llama está aprobada? Solo responde por la propia: no sirve para
-- averiguar qué otras apps existen.
create function mi_app_esta_aprobada() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from apps_conectadas where client_id = auth.jwt() ->> 'client_id')
$$;

-- ---------------------------------------------------------------------------
-- 5. Permisos de las funciones. Postgres deja por defecto que cualquiera (incluso un visitante
--    anónimo) ejecute una función nueva: se cierra. Y se cierran a los anónimos cinco funciones
--    pequeñas de las fases 1 y 2 que nunca se cerraron (solo leen, pero no tienen por qué estar abiertas).
-- ---------------------------------------------------------------------------

revoke execute on function es_conexion_externa(), aprobar_app(text, text, text), mi_app_esta_aprobada()
  from public, anon;
grant execute on function es_conexion_externa(), mi_app_esta_aprobada() to authenticated, service_role;
grant execute on function aprobar_app(text, text, text) to authenticated;

revoke execute on function mi_rol(), es_mi_contacto(uuid), es_mi_oportunidad(uuid), sin_tildes(text), en_carga_masiva()
  from public, anon;
grant execute on function mi_rol(), es_mi_contacto(uuid), es_mi_oportunidad(uuid), sin_tildes(text), en_carga_masiva()
  to authenticated, service_role;
