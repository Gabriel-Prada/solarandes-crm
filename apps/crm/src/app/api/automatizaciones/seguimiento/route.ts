import { llaveValida } from "@/lib/automatizaciones/lead";
import { armarCorreo, type ResumenDeLaBase } from "@/lib/automatizaciones/seguimiento";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla del seguimiento (flujo 3 de n8n, migración 016). Tres acciones:
 * - { accion: "tomar", ejecucion }: reserva los resúmenes de hoy que faltan y los devuelve como correos
 *   ya escritos. Si otra ejecución los tiene, no los devuelve: cada resumen sale una sola vez.
 * - { accion: "confirmar", ejecucion, resumen }: el correo salió; se anota qué se avisó.
 * - { accion: "soltar", ejecucion, resumen }: el correo falló; la hora siguiente lo intenta de nuevo.
 *
 * Devuelve nombres de clientes: la protege AUTOMATIZACIONES_TOKEN, como las demás puertas de n8n.
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
  const cuerpo = (entrada ?? {}) as { accion?: unknown; ejecucion?: unknown; resumen?: unknown };
  // El número de la ejecución de n8n: es el dueño de la reserva
  const ejecucion = typeof cuerpo.ejecucion === "string" && cuerpo.ejecucion.trim() ? cuerpo.ejecucion.trim().slice(0, 100) : null;
  if (!ejecucion) return Response.json({ error: "Falta la ejecución." }, { status: 400 });
  const supabase = crearClienteDeServicio();

  if (cuerpo.accion === "tomar") {
    const { data, error } = await supabase.rpc("tomar_resumenes_seguimiento", { p_ejecucion: ejecucion });
    if (error) {
      console.error("tomar_resumenes_seguimiento falló", error);
      return Response.json({ error: "El CRM no pudo armar los resúmenes. Intenta de nuevo." }, { status: 500 });
    }
    // Los enlaces de los correos apuntan a este mismo CRM
    const crm = new URL(request.url).origin;
    const resumenes = (data.resumenes as ResumenDeLaBase[]).map((r) => armarCorreo(r, crm));
    // sin_gerente: no hay gerente activa y los avisos de 7+ días no tienen a quién llegar (n8n avisa)
    return Response.json({ dia: data.dia, correos: resumenes, sin_gerente: data.sin_gerente === true });
  }

  if (cuerpo.accion === "confirmar" || cuerpo.accion === "soltar") {
    if (typeof cuerpo.resumen !== "string" || !UUID.test(cuerpo.resumen)) {
      return Response.json({ error: "Falta el resumen." }, { status: 400 });
    }
    const funcion = cuerpo.accion === "confirmar" ? "confirmar_resumen" : "soltar_resumen";
    const { data, error } = await supabase.rpc(funcion, { p_resumen: cuerpo.resumen, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el resumen. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [cuerpo.accion === "confirmar" ? "confirmado" : "soltado"]: data === true });
  }

  return Response.json({ error: "La acción debe ser tomar, confirmar o soltar." }, { status: 400 });
}
