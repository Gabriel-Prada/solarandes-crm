-- La potencia de calcular_cotizacion() (migración 007) salía con todos los decimales de la
-- división ("3.8500000000000000"), y así aparecía en el texto de la actividad. Ahora se redondea
-- a dos decimales y se quitan los ceros sobrantes: 3,85 kWp, 3,3 kWp, 14,85 kWp.

create or replace function calcular_cotizacion(p_consumo integer, p_ciudad ciudad, p_descuento numeric default 0)
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
  paneles := ceil(round(p_consumo / (hsp * 30 * 0.8) * 1000 / 550, 6));
  vatios := paneles * 550;
  precio := case when vatios <= 10000 then 4500000 else 3800000 end;
  sin_descuento := vatios::bigint * precio / 1000;
  decimas := round(p_descuento * 10);

  return query select
    paneles,
    trim_scale(round(vatios / 1000.0, 2)),
    precio,
    sin_descuento,
    ((sin_descuento / 1000) * (1000 - decimas) + 500) / 1000 * 1000;
end;
$$;
