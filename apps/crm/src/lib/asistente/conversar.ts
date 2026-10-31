import Anthropic from "@anthropic-ai/sdk";

import { costoUsd, tokensEntrada } from "@/lib/ia/precios";

import type { BaseAsistente, MensajeGuardado, Resultado } from "./base";
import { armarMensajeDelVisitante, esSoloSaludo, HERRAMIENTAS, SALUDO_FIJO, SISTEMA, type Contexto } from "./prompt";

/**
 * Un turno de la conversación: el visitante escribe y el asistente responde, letra a letra.
 *
 * Todo lo que gasta pide permiso a la base ANTES (docs/plan-fase-6.md, sección 4): el turno (que vence
 * solo), cada llamada a Claude (máximo 3 por mensaje, bajo el tope de gasto) y al final se guarda el
 * historial. El historial lo carga la base: el navegador solo manda el mensaje nuevo.
 */

/** Decisión A de Gabriel: Haiku 5.5, pensando poco. La base solo acepta este modelo (migración 025). */
export const MODELO_ASISTENTE = "claude-haiku-5-5";
export const ESFUERZO_ASISTENTE = "low" as const;
const TOKENS_POR_RESPUESTA = 700;
const LLAMADAS_POR_TURNO = 3;

export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "formulario"; motivo: string }
  | { tipo: "fin"; cerrada: boolean }
  | { tipo: "aviso"; texto: string; cerrada: boolean };

export type ResultadoHerramienta = { contenido: string; esError?: boolean; evento?: Evento };

export type EjecutarHerramienta = (
  nombre: string,
  entrada: Record<string, unknown>,
  turno: { turnoId: string; pedido: string; textosDelVisitante: string[]; contexto: Contexto },
) => Promise<ResultadoHerramienta>;

/**
 * Si ya no queda cupo para que Claude redacte la respuesta final después de usar herramientas (por ejemplo,
 * el resumen para el asesor gastó una de las 3 llamadas), se responde con lo que dijeron las herramientas:
 * la persona no debe leer "no puedo responder" cuando su visita o su aviso ya quedaron hechos.
 */
export function respuestaDeRespaldo(resultados: Anthropic.ToolResultBlockParam[]): string | null {
  const partes: string[] = [];
  for (const r of resultados) {
    try {
      const d = JSON.parse(String(r.content)) as { estado?: string; mensaje?: string; cuando?: string };
      // "8 a. m." ya termina en punto: no se le pone otro
      const cuando = d.cuando ? `Te contactan ${d.cuando}${d.cuando.endsWith(".") ? "" : "."}` : null;
      if (d.estado === "hecho" && d.mensaje) partes.push(cuando ? `${d.mensaje} ${cuando}` : d.mensaje);
    } catch {
      // un resultado que no es JSON no aporta nada para la persona
    }
  }
  return partes.length ? partes.join(" ") : null;
}

/** Lo que escribió la persona en la conversación (para el resumen del asesor), sacado de los mensajes guardados. */
export function textosDelVisitante(mensajes: { role: string; content: unknown }[]): string[] {
  const textos: string[] = [];
  for (const m of mensajes) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as { type?: string; text?: string }[]) {
      const hallado = b.type === "text" ? /^<mensaje_del_visitante>\n([\s\S]*)\n<\/mensaje_del_visitante>$/.exec(b.text ?? "") : null;
      if (hallado) textos.push(hallado[1]);
    }
  }
  return textos;
}

export type Dependencias = {
  base: BaseAsistente;
  claude: Pick<Anthropic, "messages">;
  ejecutar: EjecutarHerramienta;
  fechaHora: () => string;
};

export const AVISOS = {
  noDisponible:
    "En este momento no puedo responder. Puedes dejar tus datos en el formulario de cotización (/cotiza) y un asesor te contacta.",
  ocupada: "Espera un momento: todavía estoy respondiendo tu mensaje anterior.",
  sinConversacion: "Esta conversación ya terminó. Recarga la página para empezar una nueva.",
  mensajeVacio: "Escribe tu pregunta para poder ayudarte.",
  mensajeLargo: "Tu mensaje es muy largo. ¿Me lo escribes más corto (máximo 600 letras)?",
  limiteConversacion:
    "Llegamos al máximo de mensajes de esta conversación. Si quieres seguir, deja tus datos en /cotiza y un asesor te contacta.",
  limitePersona: "Has escrito muchos mensajes seguidos. Intenta más tarde, o deja tus datos en /cotiza.",
  cortada: "Se me cortó la respuesta. ¿Me lo repites, por favor?",
  rechazo: "No puedo ayudarte con eso. Si quieres, te cuento sobre la energía solar o te doy una pre-cotización.",
} as const;

function avisoPorTurno(r: Resultado): Evento {
  if (r.estado === "ocupada") return { tipo: "aviso", texto: AVISOS.ocupada, cerrada: false };
  if (r.estado === "sin_conversacion") return { tipo: "aviso", texto: AVISOS.sinConversacion, cerrada: true };
  if (r.motivo === "mensaje_vacio") return { tipo: "aviso", texto: AVISOS.mensajeVacio, cerrada: false };
  if (r.motivo === "mensaje_largo") return { tipo: "aviso", texto: AVISOS.mensajeLargo, cerrada: false };
  if (r.motivo === "conversacion") return { tipo: "aviso", texto: AVISOS.limiteConversacion, cerrada: true };
  if (r.motivo === "persona") return { tipo: "aviso", texto: AVISOS.limitePersona, cerrada: false };
  return { tipo: "aviso", texto: AVISOS.noDisponible, cerrada: false };
}

/** El código de un error de Claude, nunca su texto (puede traer el pedido completo). */
export function codigoDeError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "tiempo_agotado";
  if (e instanceof Anthropic.APIConnectionError) return "sin_conexion";
  if (e instanceof Anthropic.APIError && typeof e.status === "number") return `http_${e.status}`;
  return "desconocido";
}

function contextoDe(r: Resultado, fechaHora: string): Contexto {
  const c = (r.contexto ?? {}) as Partial<{ datos_dejados: boolean; visita: string | null; asesor_avisado: boolean }>;
  return {
    fechaHora,
    datosDejados: c.datos_dejados === true,
    visita: typeof c.visita === "string" ? c.visita : null,
    asesorAvisado: c.asesor_avisado === true,
  };
}

export async function* responderTurno(
  entrada: { claveHash: string; huella: string; pedido: string; mensaje: string },
  deps: Dependencias,
): AsyncGenerator<Evento> {
  const llamaClaude = !esSoloSaludo(entrada.mensaje);
  let turno: Resultado;
  try {
    turno = await deps.base.tomarTurno(entrada.claveHash, entrada.huella, entrada.pedido, entrada.mensaje, llamaClaude);
  } catch (e) {
    console.error("asistente: tomar_turno falló", (e as { code?: string }).code ?? "sin_codigo");
    yield { tipo: "aviso", texto: AVISOS.noDisponible, cerrada: false };
    return;
  }
  if (turno.estado !== "ok") {
    yield avisoPorTurno(turno);
    return;
  }
  const turnoId = String(turno.turno_id);
  const mensajeVisitante: MensajeGuardado = {
    role: "user",
    content: armarMensajeDelVisitante(String(turno.mensaje), contextoDe(turno, deps.fechaHora())),
  };

  // Un saludo solo: respuesta fija, sin Claude y sin gasto
  if (!llamaClaude) {
    yield { tipo: "texto", texto: SALUDO_FIJO };
    await deps.base.guardarTurno(turnoId, entrada.pedido, [
      mensajeVisitante,
      { role: "assistant", content: [{ type: "text", text: SALUDO_FIJO }] },
    ]);
    yield { tipo: "fin", cerrada: false };
    return;
  }

  const historial = (Array.isArray(turno.historial) ? turno.historial : []) as Anthropic.MessageParam[];
  const contexto = contextoDe(turno, deps.fechaHora());
  const nuevos: MensajeGuardado[] = [mensajeVisitante];
  let escribio = false;
  let ultimosResultados: Anthropic.ToolResultBlockParam[] = [];
  // Suelta el turno sin guardar nada (el historial tiene que quedar válido para el siguiente mensaje)
  const soltar = () => deps.base.guardarTurno(turnoId, entrada.pedido, []).catch(() => undefined);

  for (let vuelta = 1; vuelta <= LLAMADAS_POR_TURNO; vuelta++) {
    let permiso: Resultado;
    try {
      permiso = await deps.base.tomarLlamada(turnoId, entrada.pedido, MODELO_ASISTENTE);
    } catch (e) {
      console.error("asistente: tomar_llamada falló", (e as { code?: string }).code ?? "sin_codigo");
      permiso = { estado: "error" };
    }
    if (permiso.estado !== "ok") {
      const respaldo = vuelta > 1 ? respuestaDeRespaldo(ultimosResultados) : null;
      if (respaldo) {
        // Lo que ya se hizo (visita, aviso) se le cuenta a la persona y el turno queda guardado completo
        yield { tipo: "texto", texto: respaldo };
        nuevos.push({ role: "assistant", content: [{ type: "text", text: respaldo }] });
        break;
      }
      await soltar();
      yield { tipo: "aviso", texto: escribio ? AVISOS.cortada : AVISOS.noDisponible, cerrada: false };
      return;
    }
    const llamadaId = String(permiso.llamada_id);
    const inicio = Date.now();
    // En la última vuelta ya no puede pedir herramientas: tiene que responder con lo que tiene
    const ultima = vuelta === LLAMADAS_POR_TURNO;

    let final: Anthropic.Message;
    try {
      const stream = deps.claude.messages.stream(
        {
          model: MODELO_ASISTENTE,
          max_tokens: TOKENS_POR_RESPUESTA,
          system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
          tools: HERRAMIENTAS,
          tool_choice: ultima ? { type: "none" } : { type: "auto" },
          messages: [...historial, ...nuevos] as Anthropic.MessageParam[],
          output_config: { effort: ESFUERZO_ASISTENTE },
          cache_control: { type: "ephemeral" },
        },
        { timeout: 20_000, maxRetries: 0 },
      );
      for await (const evento of stream) {
        if (evento.type === "content_block_delta" && evento.delta.type === "text_delta" && evento.delta.text) {
          escribio = true;
          yield { tipo: "texto", texto: evento.delta.text };
        }
      }
      final = await stream.finalMessage();
    } catch (e) {
      const codigo = codigoDeError(e);
      await deps.base
        .terminarLlamada({
          llamada: llamadaId, turno: turnoId, resultado: "error", tokensEntrada: 0, tokensSalida: 0,
          tokensCacheLeidos: 0, costoUsd: codigo.startsWith("http_") || codigo === "sin_conexion" ? 0 : null,
          duracionMs: Date.now() - inicio, error: codigo,
        })
        .catch(() => undefined);
      await soltar();
      console.error("asistente: Claude falló", codigo);
      yield { tipo: "aviso", texto: escribio ? AVISOS.cortada : AVISOS.noDisponible, cerrada: false };
      return;
    }

    const resultado = final.stop_reason === "refusal" ? "rechazo" : final.stop_reason === "max_tokens" ? "invalida" : "ok";
    // Anotar el costo no debe tumbar la respuesta: si falla, la base cuenta lo reservado
    await deps.base.terminarLlamada({
      llamada: llamadaId,
      turno: turnoId,
      resultado,
      tokensEntrada: tokensEntrada(final.usage),
      tokensSalida: final.usage.output_tokens,
      tokensCacheLeidos: final.usage.cache_read_input_tokens ?? 0,
      costoUsd: costoUsd(MODELO_ASISTENTE, final.usage),
      duracionMs: Date.now() - inicio,
      error: resultado === "ok" ? null : (final.stop_reason ?? null),
    }).catch(() => undefined);

    const pideHerramientas = final.content.some((b) => b.type === "tool_use");
    const vacia = !pideHerramientas && !final.content.some((b) => b.type === "text" && b.text.trim() !== "");
    // Una respuesta rechazada, a medias o VACÍA no se guarda: la API rechaza un mensaje vacío en medio del
    // historial, y la conversación quedaría inservible desde el turno siguiente
    if (final.stop_reason === "refusal" || (final.stop_reason === "max_tokens" && pideHerramientas) || vacia) {
      const respaldo = vacia && final.stop_reason !== "refusal" ? respuestaDeRespaldo(ultimosResultados) : null;
      if (respaldo) {
        yield { tipo: "texto", texto: respaldo };
        nuevos.push({ role: "assistant", content: [{ type: "text", text: respaldo }] });
        break;
      }
      await soltar();
      yield { tipo: "aviso", texto: final.stop_reason === "refusal" ? AVISOS.rechazo : AVISOS.cortada, cerrada: false };
      return;
    }
    nuevos.push({ role: "assistant", content: final.content as unknown[] });
    if (final.stop_reason === "max_tokens") {
      // Texto cortado a media frase: es válido y se guarda, pero se avisa
      yield { tipo: "aviso", texto: AVISOS.cortada, cerrada: false };
      break;
    }
    if (final.stop_reason !== "tool_use" || !pideHerramientas) break;

    // Las herramientas que pidió, todas juntas en un solo mensaje de respuesta
    const respuestas: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of final.content) {
      if (bloque.type !== "tool_use") continue;
      let r: ResultadoHerramienta;
      try {
        r = await deps.ejecutar(bloque.name, (bloque.input ?? {}) as Record<string, unknown>, {
          turnoId,
          pedido: entrada.pedido,
          textosDelVisitante: textosDelVisitante([...historial, ...nuevos] as { role: string; content: unknown }[]),
          contexto,
        });
      } catch (e) {
        console.error("asistente: herramienta falló", bloque.name, (e as { code?: string }).code ?? "sin_codigo");
        r = { contenido: JSON.stringify({ estado: "error", mensaje: "No se pudo completar. Ofrece un asesor." }), esError: true };
      }
      if (r.evento) yield r.evento;
      respuestas.push({ type: "tool_result", tool_use_id: bloque.id, content: r.contenido, is_error: r.esError });
    }
    nuevos.push({ role: "user", content: respuestas });
    ultimosResultados = respuestas;
    if (escribio) yield { tipo: "texto", texto: "\n\n" };
  }

  const guardado = await deps.base
    .guardarTurno(turnoId, entrada.pedido, nuevos)
    .catch((): Resultado => ({ estado: "error" }));
  if (guardado.estado !== "ok") {
    // Si no se pudo guardar, se suelta el turno: si no, el siguiente mensaje esperaría 90 segundos
    console.error("asistente: guardar_turno", guardado.motivo ?? guardado.estado);
    await soltar();
  }
  const mensajes = Number(turno.mensajes_visitante ?? 0) + 1;
  yield { tipo: "fin", cerrada: mensajes >= 20 };
}
