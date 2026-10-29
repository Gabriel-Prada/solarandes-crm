import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { calificarLead, MODELO_CALIFICACION, type ResultadoLlamada } from "@/lib/ia/calificar-lead/calificar";
import { tienePrecio } from "@/lib/ia/precios";
import { VERSION_PROMPT, type EntradaLead } from "@/lib/ia/calificar-lead/prompt";

/**
 * La calificación de un lead, de punta a punta (fase 4, pieza 1; reglas en la migración 020):
 * 1. La base reserva el siguiente lead, toma un cupo del tope y anota la llamada ANTES de llamar.
 * 2. Claude llena la ficha (calificarLead).
 * 3. La base guarda la ficha y completa la llamada con su costo; si este pedido ya no es el dueño de la
 *    reserva, solo anota la llamada.
 *
 * Un lead por llamada a esta función; calificarVuelta la repite hasta 5 veces por pedido de n8n.
 */
export type ResultadoCalificacion =
  | { estado: "nada" | "sin_cupo"; atrasadas: number }
  | {
      estado: "calificado";
      resultado: ResultadoLlamada["resultado"];
      prioridad: string | null;
      guardada: boolean;
      error: string | null; // el código corto de la llamada (http_400, tiempo_agotado…), nunca el texto
      atrasadas: number;
    };

export async function calificarSiguiente(supabase: SupabaseClient, claude: Anthropic): Promise<ResultadoCalificacion> {
  // Sin precio no se sabría cuánto se gasta: mejor no llamar (el lead espera y suena la alarma de atrasados)
  if (!tienePrecio(MODELO_CALIFICACION)) throw new Error(`No hay precio para ${MODELO_CALIFICACION} en precios.ts`);
  const pedido = randomUUID(); // el dueño de la reserva es este pedido, no la ejecución de n8n
  const { data: tomada, error } = await supabase.rpc("tomar_calificacion", { p_pedido: pedido, p_modelo: MODELO_CALIFICACION });
  if (error) throw new Error(`tomar_calificacion falló: ${error.message}`);
  const atrasadas = Number(tomada.atrasadas) || 0;
  if (tomada.estado !== "tomada") return { estado: tomada.estado, atrasadas };

  const entrada = tomada.entrada as EntradaLead;
  const llamada = await calificarLead(claude, entrada);
  const guardar = (l: ResultadoLlamada) =>
    supabase.rpc("guardar_calificacion", {
      p_calificacion: tomada.calificacion_id,
      p_pedido: pedido,
      p_llamada: tomada.llamada_id,
      p_resultado: l.resultado,
      p_ficha: l.ficha,
      p_version: VERSION_PROMPT,
      p_tokens_entrada: l.tokensEntrada,
      p_tokens_salida: l.tokensSalida,
      p_costo_usd: l.costoUsd,
      p_duracion_ms: l.duracionMs,
      p_error: l.error,
    });
  let { data: guardado, error: errorAlGuardar } = await guardar(llamada);
  if (errorAlGuardar) {
    // La base no aceptó la ficha (por ejemplo, un texto que no puede guardar). La llamada ya se pagó: se
    // anota igual, sin la ficha, como respuesta inválida (cuenta para el límite de 3).
    console.error("guardar_calificacion falló; se anota sin la ficha", errorAlGuardar);
    ({ data: guardado, error: errorAlGuardar } = await guardar({ ...llamada, resultado: "invalida", ficha: null, error: "no_se_pudo_guardar" }));
  }
  // Si tampoco así, la reserva vence en 3 minutos y la llamada queda como "posiblemente cobrada"
  if (errorAlGuardar) throw new Error(`guardar_calificacion falló: ${errorAlGuardar.message}`);
  return {
    estado: "calificado",
    resultado: llamada.resultado,
    prioridad: guardado.prioridad ?? null,
    guardada: guardado.guardada === true,
    error: llamada.error,
    atrasadas,
  };
}

/**
 * Un rechazo de configuración: la API contestó que el pedido está mal (sin saldo, llave inválida, modelo que
 * no existe). No se arregla esperando: n8n lo avisa de inmediato. Un 429 (demasiadas solicitudes) sí se
 * arregla solo.
 */
export function esErrorDeConfiguracion(codigo: string | null): boolean {
  return codigo !== null && /^http_4\d\d$/.test(codigo) && codigo !== "http_429";
}

export type ResultadoVuelta = {
  calificados: number; // cuántos leads se intentaron bien en esta vuelta (incluye respuestas inválidas, que vuelven a la fila)
  fin: "nada" | "sin_cupo" | "fallo_claude" | "limite";
  error: string | null; // el código del fallo de Claude que detuvo la vuelta
  error_de_configuracion: boolean;
  atrasadas: number;
};

/**
 * Una vuelta de n8n: califica de a uno, hasta `maximo`, y se detiene con el primero que no sale bien
 * (nada que calificar, sin cupo, Claude que no responde) o cuando pasa el tiempo. Si siguiera pidiendo con
 * Claude caído, cada intento gastaría cupo del tope y uno de los intentos de cada lead. Con 20 s de
 * presupuesto, el último lead (Claude espera máximo 20 s) termina hacia los 40 s: cabe en los 60 s de
 * Vercel y deja margen para que la vuelta completa de n8n (avisos y correos) quepa en el minuto, sin que
 * la vuelta siguiente se le cruce.
 */
export async function calificarVuelta(
  supabase: SupabaseClient,
  claude: Anthropic,
  opciones: { maximo?: number; presupuestoMs?: number; ahora?: () => number } = {},
): Promise<ResultadoVuelta> {
  const maximo = opciones.maximo ?? 5;
  const presupuestoMs = opciones.presupuestoMs ?? 20_000;
  const ahora = opciones.ahora ?? Date.now;
  const inicio = ahora();
  let calificados = 0;
  let atrasadas = 0;
  for (let i = 0; i < maximo; i++) {
    if (i > 0 && ahora() - inicio > presupuestoMs) break;
    const r = await calificarSiguiente(supabase, claude);
    atrasadas = r.atrasadas;
    if (r.estado !== "calificado") return { calificados, fin: r.estado, error: null, error_de_configuracion: false, atrasadas };
    if (r.resultado === "error" || !r.guardada) {
      return {
        calificados,
        fin: "fallo_claude",
        error: r.error,
        error_de_configuracion: esErrorDeConfiguracion(r.error),
        atrasadas,
      };
    }
    calificados += 1;
  }
  return { calificados, fin: "limite", error: null, error_de_configuracion: false, atrasadas };
}

/** Lo que devuelve avisos_prioritarios_pendientes por cada lead. */
export type AvisoPrioritario = {
  calificacion_id: string;
  contacto: { codigo: string; nombre: string; ciudad: string };
  venta: string | null;
  resumen: string | null;
  consumo_estimado: number | null;
  destinatario: { codigo: string; nombre: string; email: string };
};

export type CorreoPrioritario = { id: string; para: string; quien: string; asunto: string; texto: string };

/**
 * El correo de "lead prioritario" al asesor. Texto plano. El resumen lo escribió una IA a partir del
 * mensaje de un desconocido: va marcado como tal, y el mensaje original está en el CRM.
 */
export function armarAvisoPrioritario(a: AvisoPrioritario, urlCrm: string): CorreoPrioritario {
  const lineas = [
    `Hola, ${a.destinatario.nombre.split(" ")[0]}:`,
    "",
    `Llegó un lead de prioridad ALTA: ${a.contacto.nombre} (${a.contacto.codigo}), de ${a.contacto.ciudad}.`,
  ];
  if (a.resumen) lineas.push("", `Resumen hecho por IA (revísalo con el mensaje original): ${a.resumen}`);
  if (a.consumo_estimado) lineas.push(`Consumo estimado: ${a.consumo_estimado} kWh/mes.`);
  lineas.push("", `Míralo en el CRM: ${urlCrm}/contactos/${a.contacto.codigo}`, "", "Este correo lo envió el sistema de SolarAndes.");
  return {
    id: a.calificacion_id,
    para: a.destinatario.email,
    quien: a.destinatario.nombre,
    asunto: `Lead prioritario: ${a.contacto.nombre} (${a.contacto.codigo})`,
    texto: lineas.join("\n"),
  };
}
