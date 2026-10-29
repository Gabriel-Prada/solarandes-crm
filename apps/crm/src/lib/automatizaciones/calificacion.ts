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
 * Un lead por pedido: así el pedido nunca se acerca al tiempo máximo de Vercel. n8n vuelve a preguntar.
 */
export type ResultadoCalificacion =
  | { estado: "nada" | "sin_cupo"; atrasadas: number }
  | { estado: "calificado"; resultado: string; prioridad: string | null; guardada: boolean; atrasadas: number };

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
    atrasadas,
  };
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
