import Anthropic from "@anthropic-ai/sdk";
import { costoUsd, tokensEntrada } from "../precios";
import { sinEtiquetas, taparDatos } from "../privacidad";
import { ESQUEMA_FICHA, leerFicha, type Ficha } from "./ficha";
import { armarMensajeUsuario, SISTEMA, type EntradaLead } from "./prompt";

/** Decisión de Gabriel (plan de la fase 4, decisión C): el modelo más barato, pensando poco. */
export const MODELO_CALIFICACION = "claude-haiku-5-5";
export const ESFUERZO_CALIFICACION = "low" as const;

/** Lo que pasó en una llamada, con los mismos nombres que espera guardar_calificacion en la base. */
export type ResultadoLlamada = {
  resultado: "ok" | "rechazo" | "invalida" | "error";
  ficha: Ficha | null;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number | null; // null: el modelo no está en la tabla de precios
  duracionMs: number;
  error: string | null;
};

type Opciones = { modelo?: string; esfuerzo?: "low" | "medium" | "high"; ahora?: () => number };

/**
 * Le pide a Claude la ficha de un lead. Nunca lanza un error: todo termina en un resultado que se guarda
 * (si Claude no responde, "error"; la base decide cuándo reintentar).
 *
 * Espera máximo 20 segundos y no deja que la librería reintente por su cuenta: los reintentos los lleva
 * la base de datos (así el pedido nunca se acerca a los 60 segundos de Vercel y no se paga de más).
 */
export async function calificarLead(
  cliente: Anthropic,
  entrada: EntradaLead,
  opciones: Opciones = {},
): Promise<ResultadoLlamada> {
  const modelo = opciones.modelo ?? MODELO_CALIFICACION;
  const ahora = opciones.ahora ?? Date.now;
  const inicio = ahora();
  const vacio = { ficha: null, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0 };

  let respuesta: Anthropic.Message;
  try {
    respuesta = await cliente.messages.create(
      {
        model: modelo,
        max_tokens: 2000, // el pensamiento también cuenta aquí: con menos, la ficha podría quedar cortada
        system: SISTEMA,
        messages: [{ role: "user", content: armarMensajeUsuario({ ...entrada, mensaje: sinEtiquetas(taparDatos(entrada.mensaje)) }) }],
        output_config: {
          effort: opciones.esfuerzo ?? ESFUERZO_CALIFICACION,
          format: { type: "json_schema", schema: ESQUEMA_FICHA },
        },
      },
      { timeout: 20_000, maxRetries: 0 },
    );
  } catch (e) {
    return { resultado: "error", ...vacio, duracionMs: ahora() - inicio, error: codigoDeError(e) };
  }

  const uso = {
    tokensEntrada: tokensEntrada(respuesta.usage),
    tokensSalida: respuesta.usage.output_tokens,
    costoUsd: costoUsd(modelo, respuesta.usage),
    duracionMs: ahora() - inicio,
  };
  if (respuesta.stop_reason === "refusal") {
    return { resultado: "rechazo", ficha: null, ...uso, error: respuesta.stop_details?.category ?? "rechazo" };
  }
  if (respuesta.stop_reason === "max_tokens") {
    return { resultado: "invalida", ficha: null, ...uso, error: "respuesta_cortada" };
  }
  const texto = respuesta.content.find((b) => b.type === "text")?.text ?? "";
  let ficha: Ficha | null = null;
  try {
    ficha = leerFicha(JSON.parse(texto));
  } catch {
    ficha = null;
  }
  return ficha
    ? { resultado: "ok", ficha, ...uso, error: null }
    : { resultado: "invalida", ficha: null, ...uso, error: "ficha_invalida" };
}

/** Un código corto para el registro: nunca el texto del error (podría traer partes del pedido). */
function codigoDeError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "tiempo_agotado";
  if (e instanceof Anthropic.APIConnectionError) return "sin_conexion";
  if (e instanceof Anthropic.APIError) return `http_${e.status ?? "desconocido"}`;
  return "desconocido";
}
