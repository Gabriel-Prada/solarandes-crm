-- Dos ajustes a la calificación de leads (migraciones 020 y 021), encontrados en la revisión del
-- código del flujo 08:
--
-- 1. Un rechazo de configuración no gasta los intentos del lead. Si Claude rechaza el pedido porque está
--    mal configurado (sin saldo, llave inválida, modelo que no existe: un código 4xx que no sea 429),
--    esperar no lo arregla: lo arregla una persona. Antes, cada rechazo contaba como uno de los 8
--    intentos, y en unas 3 horas todos los leads de la noche quedaban "fallidos" para siempre, aunque al
--    otro día se recargara el saldo. Ahora el lead vuelve a la fila (cada 30 minutos) sin gastar intentos;
--    n8n avisa de inmediato, y a los 7 días el lead vence como cualquier otro.
-- 2. "Atrasado" se mide desde el primer intento, no desde que llegó el lead. Un lead que llegó de noche
--    y la primera vez que se intenta Claude tropieza un momento no es un atraso.

-- ---------------------------------------------------------------------------
-- 1. Rechazos de configuración
-- ---------------------------------------------------------------------------

create function es_rechazo_de_configuracion(p_error text) returns boolean
language sql immutable as $$
  select coalesce(p_error ~ '^http_4[0-9]{2}$' and p_error <> 'http_429', false)
$$;

create or replace function guardar_calificacion(
  p_calificacion uuid,
  p_pedido uuid,
  p_llamada uuid,
  p_resultado text,
  p_ficha jsonb,
  p_version text,
  p_tokens_entrada integer,
  p_tokens_salida integer,
  p_costo_usd numeric,
  p_duracion_ms integer,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fila calificaciones_lead%rowtype;
  resultado text := p_resultado;
  modelo_usado text;
  nuevo_estado estado_calificacion;
  configuracion boolean := p_resultado = 'error' and es_rechazo_de_configuracion(p_error);
begin
  if p_resultado is null or p_resultado not in ('ok', 'rechazo', 'invalida', 'error') then
    raise exception 'Resultado inválido: %', p_resultado using errcode = '22023';
  end if;
  if resultado = 'ok' and (p_ficha is null or not ficha_valida(p_ficha)) then
    resultado := 'invalida';
  end if;

  -- La llamada se completa siempre: se pagó aunque este pedido ya no sea el dueño de la reserva
  update llamadas_ia
  set estado = resultado, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
      costo_usd = p_costo_usd, duracion_ms = p_duracion_ms, error = left(p_error, 200), terminada_en = now()
  where id = p_llamada and referencia = p_calificacion and estado in ('en_curso', 'posiblemente_cobrada')
  returning modelo into modelo_usado;
  if modelo_usado is null then
    -- La llamada no corresponde a esta calificación (un error del CRM): no se guarda nada
    return jsonb_build_object('guardada', false, 'motivo', 'llamada_desconocida');
  end if;

  -- Solo el dueño de la reserva guarda: un pedido tardío no pisa el de otro
  select * into fila from calificaciones_lead where id = p_calificacion for update;
  if not found or fila.estado <> 'en_curso' or fila.reservada_por is distinct from p_pedido then
    return jsonb_build_object('guardada', false);
  end if;

  if configuracion then
    -- Sin gastar el intento: se deshace la cuenta que hizo tomar_calificacion, y se espera media hora
    update calificaciones_lead
    set estado = 'por_calificar', intentos = intentos - 1, proximo_intento_en = now() + interval '30 minutes',
        reservada_por = null, reservada_hasta = null
    where id = p_calificacion;
    return jsonb_build_object('guardada', true, 'estado', 'por_calificar', 'prioridad', null);
  end if;

  if resultado = 'ok' then
    nuevo_estado := 'calificada';
  elsif resultado = 'rechazo' then
    nuevo_estado := 'rechazada';
  elsif resultado = 'invalida' and fila.respuestas_invalidas + 1 >= 3 then
    nuevo_estado := 'fallida';
  elsif fila.intentos >= intentos_maximos_calificacion() then
    nuevo_estado := 'fallida'; -- Claude no respondió en unas 3 horas de intentos: no se sigue intentando
  else
    nuevo_estado := 'por_calificar';
  end if;

  update calificaciones_lead
  set estado = nuevo_estado,
      ficha = case when resultado = 'ok' then p_ficha else ficha end,
      modelo = case when resultado in ('ok', 'rechazo') then modelo_usado else modelo end,
      version_prompt = case when resultado in ('ok', 'rechazo') then left(p_version, 40) else version_prompt end,
      calificada_en = case when resultado = 'ok' then now() else calificada_en end,
      respuestas_invalidas = respuestas_invalidas + (resultado = 'invalida')::integer,
      -- Espera creciente antes del siguiente intento: 1, 2, 4, 8… minutos, máximo una hora
      proximo_intento_en = case when nuevo_estado = 'por_calificar' then now() + espera_calificacion(fila.intentos)
                                else proximo_intento_en end,
      reservada_por = null,
      reservada_hasta = null,
      -- Al terminar ya no hace falta la copia del mensaje (el original sigue en el historial del contacto)
      entrada = case when nuevo_estado = 'por_calificar' then entrada else entrada - 'mensaje' end
  where id = p_calificacion;

  return jsonb_build_object(
    'guardada', true,
    'estado', nuevo_estado,
    'prioridad', case when nuevo_estado = 'calificada' then prioridad_regla(p_ficha, fila.entrada) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Atrasados desde el primer intento
-- ---------------------------------------------------------------------------

alter table calificaciones_lead add column primer_intento_en timestamptz;

-- La hora la pone la base la primera vez que se intenta calificar el lead (y no se vuelve a cambiar)
create function marcar_primer_intento() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.intentos > old.intentos and new.primer_intento_en is null then
    new.primer_intento_en := now();
  end if;
  return new;
end;
$$;

create trigger calificacion_primer_intento
  before update of intentos on calificaciones_lead
  for each row execute function marcar_primer_intento();

create or replace function calificaciones_atrasadas() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from calificaciones_lead
  where estado in ('por_calificar', 'en_curso') and intentos > 0
    and primer_intento_en < now() - interval '30 minutes'
$$;

-- ---------------------------------------------------------------------------
-- Permisos: guardar_calificacion y calificaciones_atrasadas conservan los suyos ("create or replace");
-- las nuevas, solo por dentro
-- ---------------------------------------------------------------------------

revoke execute on function es_rechazo_de_configuracion(text) from public, anon, authenticated, service_role;
revoke execute on function marcar_primer_intento() from public, anon, authenticated, service_role;
