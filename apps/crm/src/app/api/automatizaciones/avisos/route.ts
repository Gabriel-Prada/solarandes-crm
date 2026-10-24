import { leerClave, llaveValida } from "@/lib/automatizaciones/lead";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

/**
 * Reserva los avisos de un lead: n8n la pide antes de mandar la bienvenida y los avisos al equipo,
 * y solo la primera ejecución que la pide recibe { reservado: true }. Así los avisos salen una sola
 * vez aunque el mismo envío llegue dos veces al mismo tiempo (migraciones 012 y 013).
 *
 * Como la puerta de leads, no pasa por el portero de sesiones: la protege AUTOMATIZACIONES_TOKEN.
 */
export async function POST(request: Request) {
  if (!llaveValida(request.headers.get("authorization"), process.env.AUTOMATIZACIONES_TOKEN)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  let entrada: unknown;
  try {
    entrada = JSON.parse((await request.text()).slice(0, 2_000));
  } catch {
    return Response.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }
  const cuerpo = (entrada ?? {}) as { clave?: unknown; ejecucion?: unknown };
  const clave = leerClave(cuerpo.clave);
  if (!clave) return Response.json({ error: "Falta la clave del envío (entre 8 y 200 caracteres)." }, { status: 400 });
  // El número de la ejecución de n8n: si la misma ejecución vuelve a pedir (porque se perdió la
  // respuesta), la reserva sigue siendo suya (migración 013)
  const ejecucion = typeof cuerpo.ejecucion === "string" && cuerpo.ejecucion.trim() ? cuerpo.ejecucion.trim().slice(0, 100) : null;

  const { data, error } = await crearClienteDeServicio().rpc("reservar_avisos", { p_clave: clave, p_ejecucion: ejecucion });
  if (error) {
    console.error("reservar_avisos falló", error);
    return Response.json({ error: "El CRM no pudo reservar los avisos. Intenta de nuevo." }, { status: 500 });
  }
  return Response.json({ reservado: data === true });
}
