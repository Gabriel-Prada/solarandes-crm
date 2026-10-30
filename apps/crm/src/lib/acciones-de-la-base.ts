/**
 * Lo que devuelven las tres acciones de la base (migración 024): registrar_actividad, mover_venta y
 * agendar_visita. Las usan el CRM y el MCP, así que las reglas existen una sola vez. Un rechazo no es un
 * error de la base: llega como estado "rechazada" con su mensaje en español, listo para mostrar.
 */
export type ResultadoAccion = { estado: "hecho" | "ya_estaba" | "rechazada"; mensaje: string; [extra: string]: unknown };

const ESTADOS = new Set(["hecho", "ya_estaba", "rechazada"]);

/** Solo es un resultado si trae uno de los tres estados conocidos y su mensaje: lo demás no se da por hecho. */
export const esResultado = (valor: unknown): valor is ResultadoAccion =>
  typeof valor === "object" &&
  valor !== null &&
  ESTADOS.has((valor as ResultadoAccion).estado) &&
  typeof (valor as ResultadoAccion).mensaje === "string";
