-- Cierra los huecos que encontró la revisión de código. La idea de fondo: la app no es la única
-- puerta. Con la llave publicable, cualquier usuario con sesión puede hablarle a la base de datos
-- directamente, así que las reglas importantes tienen que vivir aquí.

-- ---------------------------------------------------------------------------
-- 1. La fórmula de cotización también en la base de datos (la autoridad final).
--    Es la misma de scripts/datos/reglas.py y apps/crm/src/lib/cotizacion.ts; las pruebas
--    comparan las tres. El descuento se calcula con enteros para que coincidan exactamente.
-- ---------------------------------------------------------------------------

create function calcular_cotizacion(p_consumo integer, p_ciudad ciudad, p_descuento numeric default 0)
returns table (
  num_paneles integer,
  potencia_kwp numeric,
  precio_kwp bigint,
  valor_sin_descuento bigint,
  valor_total bigint
)
language plpgsql immutable set search_path = public as $$
declare
  hsp numeric;
  paneles integer;
  vatios integer;
  precio bigint;
  sin_descuento bigint;
  decimas integer;
begin
  if p_consumo is null or p_consumo <= 0 or p_consumo > 100000 then
    raise exception 'El consumo debe estar entre 1 y 100.000 kWh' using errcode = '22023';
  end if;
  if p_descuento is null or p_descuento < 0 or p_descuento > 30 then
    raise exception 'El descuento debe estar entre 0 %% y 30 %%' using errcode = '22023';
  end if;

  hsp := case p_ciudad when 'Bogotá' then 4.0 when 'Medellín' then 4.5 when 'Cali' then 4.8 end;
  -- round(..., 6) antes de subir: el mismo cuidado que en Python y TypeScript
  paneles := ceil(round(p_consumo / (hsp * 30 * 0.8) * 1000 / 550, 6));
  vatios := paneles * 550;
  precio := case when vatios <= 10000 then 4500000 else 3800000 end;
  sin_descuento := vatios::bigint * precio / 1000;
  decimas := round(p_descuento * 10);

  return query select
    paneles,
    vatios / 1000.0,
    precio,
    sin_descuento,
    -- En miles de pesos y décimas de porcentaje; la mitad sube. La división entre enteros trunca.
    ((sin_descuento / 1000) * (1000 - decimas) + 500) / 1000 * 1000;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Cotizar en una sola operación: calcula, numera, actualiza la venta y anota la actividad.
--    security definer porque escribe en cotizaciones, que ya nadie puede tocar directamente
--    (ver punto 4). Por eso revisa a mano lo que RLS revisaría: quién es y si la venta es suya.
-- ---------------------------------------------------------------------------

create function crear_cotizacion(p_oportunidad_id uuid, p_consumo integer, p_descuento numeric default 0)
returns text
language plpgsql security definer set search_path = public as $$
declare
  venta oportunidades%rowtype;
  ciudad_contacto ciudad;
  calculo record;
  descuento numeric := round(coalesce(p_descuento, 0), 1);
  numero_nuevo text;
begin
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

-- ---------------------------------------------------------------------------
-- 3. Numeración a prueba de valores raros: solo cuenta números con el formato correcto
--    y no recorta los consecutivos de más de 4 cifras.
-- ---------------------------------------------------------------------------

create or replace function preparar_cotizacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  anio text := to_char(coalesce(new.fecha, now()) at time zone 'America/Bogota', 'YYYY');
  siguiente integer;
begin
  if en_carga_masiva() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('numeracion_cotizaciones'));

  select coalesce(max(split_part(numero, '-', 3)::integer), 0) + 1 into siguiente
  from cotizaciones
  where numero ~ ('^COT-' || anio || '-[0-9]+$');
  new.numero := 'COT-' || anio || '-' || lpad(siguiente::text, greatest(4, length(siguiente::text)), '0');

  select coalesce(max(version), 0) + 1 into new.version
  from cotizaciones
  where oportunidad_id = new.oportunidad_id;

  update cotizaciones set estado = 'reemplazada'
  where oportunidad_id = new.oportunidad_id and estado = 'enviada';

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Permisos por columna: cada quien puede cambiar solo lo que la app necesita cambiar.
-- ---------------------------------------------------------------------------

-- Cotizaciones: solo a través de crear_cotizacion(). Nadie inserta ni edita directamente.
revoke insert, update on cotizaciones from authenticated;

-- Actividades: solo se marca "completada" (por ejemplo, el técnico no puede cambiar el cliente
-- de una visita para ver los datos de otro cliente en su vista).
revoke update on actividades from authenticated;
grant update (completada) on actividades to authenticated;

-- Ventas: la app solo cambia la etapa y el motivo de pérdida; el valor lo pone crear_cotizacion().
revoke update on oportunidades from authenticated;
grant update (etapa, motivo_perdida) on oportunidades to authenticated;

revoke execute on function calcular_cotizacion(integer, ciudad, numeric) from public, anon;
grant execute on function calcular_cotizacion(integer, ciudad, numeric) to authenticated;
revoke execute on function crear_cotizacion(uuid, integer, numeric) from public, anon;
grant execute on function crear_cotizacion(uuid, integer, numeric) to authenticated;
