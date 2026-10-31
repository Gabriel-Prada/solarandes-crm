-- Fase 6: "un asesor te contacta el lunes desde las 8" no puede caer en un festivo.
-- La prueba en el navegador (viernes 30 de octubre de 2026, de noche) dijo "el lunes", y el lunes 2 de
-- noviembre es festivo. Ahora cuando_contactan() usa los mismos días hábiles que los horarios de visita
-- (lunes a viernes, sin festivos_colombia(), migración 026) y recibe la hora para poder probarla.
-- Pruebas: tests/test_asistente_supabase.py.

drop function cuando_contactan();

create function cuando_contactan(p_ahora timestamptz default now()) returns text
language sql stable as $$
  with l as (select p_ahora at time zone 'America/Bogota' as l),
  siguiente as (
    select min(g::date) as d from l, generate_series(l.l::date + 1, l.l::date + 15, interval '1 day') g
    where extract(isodow from g) between 1 and 5 and not g::date = any(festivos_colombia())
  )
  select case
    when extract(isodow from l.l) between 1 and 5 and not l.l::date = any(festivos_colombia())
         and extract(hour from l.l) < 17
      then 'hoy mismo, en el horario de atención (hasta las 6 p. m.)'
    when s.d = l.l::date + 1 then 'mañana desde las 8 a. m.'
    else 'el ' || (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from s.d)::int + 1]
         || ' ' || extract(day from s.d)::int || ' desde las 8 a. m.'
  end
  from l, siguiente s
$$;

revoke execute on function cuando_contactan(timestamptz) from public, anon, authenticated, service_role;
