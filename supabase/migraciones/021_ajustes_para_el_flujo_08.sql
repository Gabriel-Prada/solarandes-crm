-- Ajustes a la calificación de leads (migración 020) que encontró la revisión del diseño del flujo 08
-- de n8n. Diseño en docs/plan-fase-4.md, sección "El flujo 08 en n8n".
--
-- 1. "Atrasados" cuenta solo los leads que ya se intentaron calificar. Los que nadie ha intentado
--    (por ejemplo, los que llegaron de noche con el PC apagado) no son una falla: al prender, la
--    primera vuelta no debe sonar una falsa alarma.
-- 2. Los leads que terminaron mal (fallidos, rechazados o vencidos) quedan con la hora en que se
--    cerraron, y n8n los pregunta para avisar una vez por cada uno: antes desaparecían en silencio
--    (el conteo de atrasados bajaba a cero como si todo se hubiera arreglado).
-- 3. Un aviso de prioritario cuyo correo no salió se puede soltar para reintentarlo en la vuelta
--    siguiente. Perder el aviso de un lead caliente es peor que un correo repetido al equipo.
-- 4. Confirmar un aviso que esa misma ejecución ya confirmó responde "sí": un reintento de n8n
--    después de una confirmación cuya respuesta se perdió no da falsa alarma.

-- ---------------------------------------------------------------------------
-- 1. Atrasados: solo los que ya se intentaron
-- ---------------------------------------------------------------------------

create or replace function calificaciones_atrasadas() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from calificaciones_lead
  where estado in ('por_calificar', 'en_curso') and intentos > 0 and creada_en < now() - interval '30 minutes'
$$;

-- ---------------------------------------------------------------------------
-- 2. Los que terminaron mal: cuándo se cerraron, y la lista para n8n
-- ---------------------------------------------------------------------------

alter table calificaciones_lead add column cerrada_en timestamptz;

-- La hora la pone la base cada vez que una calificación entra a un estado final que no salió bien
create function marcar_cierre_de_calificacion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado in ('fallida', 'rechazada', 'vencida') and new.estado is distinct from old.estado then
    new.cerrada_en := now();
  end if;
  return new;
end;
$$;

create trigger calificacion_cerrada
  before update of estado on calificaciones_lead
  for each row execute function marcar_cierre_de_calificacion();

-- Las de las últimas 24 horas, con el código del último error (nunca el mensaje ni datos del lead)
create function calificaciones_terminadas_mal() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'calificacion_id', c.id,
    'estado', c.estado,
    'intentos', c.intentos,
    'error', (select l.error from llamadas_ia l where l.referencia = c.id order by l.iniciada_en desc limit 1)
  ) order by c.cerrada_en), '[]'::jsonb)
  from calificaciones_lead c
  where c.estado in ('fallida', 'rechazada', 'vencida') and c.cerrada_en > now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------------------
-- 3. Soltar un aviso cuyo correo no salió (solo la ejecución que lo reservó, y si no se envió)
-- ---------------------------------------------------------------------------

create function soltar_aviso_prioritario(p_calificacion uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update calificaciones_lead
  set aviso_reservado_en = null, aviso_reservado_por = null
  where id = p_calificacion and aviso_reservado_por = p_ejecucion and aviso_enviado_en is null;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Confirmar dos veces desde la misma ejecución: "sí" las dos veces
-- ---------------------------------------------------------------------------

create or replace function confirmar_aviso_prioritario(p_calificacion uuid, p_ejecucion text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update calificaciones_lead set aviso_enviado_en = now()
  where id = p_calificacion and aviso_reservado_por = p_ejecucion and aviso_enviado_en is null;
  if found then
    return true;
  end if;
  return exists (
    select 1 from calificaciones_lead
    where id = p_calificacion and aviso_reservado_por = p_ejecucion and aviso_enviado_en is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos: las de n8n, solo con la llave de servicio; la del trigger, nadie
-- ---------------------------------------------------------------------------

revoke execute on function marcar_cierre_de_calificacion() from public, anon, authenticated, service_role;
revoke execute on function calificaciones_terminadas_mal() from public, anon, authenticated;
revoke execute on function soltar_aviso_prioritario(uuid, text) from public, anon, authenticated;
grant execute on function calificaciones_terminadas_mal() to service_role;
grant execute on function soltar_aviso_prioritario(uuid, text) to service_role;
