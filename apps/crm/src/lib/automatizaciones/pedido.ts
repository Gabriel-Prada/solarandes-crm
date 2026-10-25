import { llaveValida } from "./lead";

export type Pedido = { accion: unknown; ejecucion: string; cuerpo: Record<string, unknown> };

/**
 * Lo común de las ventanillas que n8n llama para tomar, confirmar o soltar envíos (seguimiento, reporte
 * semanal y posventa): revisa la llave de las automatizaciones, lee el JSON y exige el número de la
 * ejecución de n8n, que es el dueño de la reserva. Si algo falta, devuelve la respuesta de error lista.
 */
export async function leerPedido(request: Request): Promise<Pedido | Response> {
  if (!llaveValida(request.headers.get("authorization"), process.env.AUTOMATIZACIONES_TOKEN)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  let entrada: unknown;
  try {
    entrada = JSON.parse((await request.text()).slice(0, 2_000));
  } catch {
    return Response.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }
  const cuerpo = (typeof entrada === "object" && entrada !== null ? entrada : {}) as Record<string, unknown>;
  const ejecucion = typeof cuerpo.ejecucion === "string" && cuerpo.ejecucion.trim() ? cuerpo.ejecucion.trim().slice(0, 100) : null;
  if (!ejecucion) return Response.json({ error: "Falta la ejecución." }, { status: 400 });
  return { accion: cuerpo.accion, ejecucion, cuerpo };
}

export const ACCION_NO_VALIDA = () =>
  Response.json({ error: "La acción debe ser tomar, confirmar o soltar." }, { status: 400 });
