import { ACCION_NO_VALIDA, leerPedido } from "@/lib/automatizaciones/pedido";
import { armarCorreo, type ResumenDeLaBase } from "@/lib/automatizaciones/seguimiento";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla del seguimiento (flujo 3 de n8n, migraciones 016 y 017). Tres acciones:
 * - { accion: "tomar", ejecucion }: reserva los resúmenes de hoy que faltan y los devuelve como correos
 *   ya escritos. Si otra ejecución los tiene, no los devuelve: cada resumen sale una sola vez.
 * - { accion: "confirmar", ejecucion, resumen }: el correo salió; se anota qué se avisó.
 * - { accion: "soltar", ejecucion, resumen }: el correo falló; la hora siguiente lo intenta de nuevo.
 *
 * Devuelve nombres de clientes: la protege AUTOMATIZACIONES_TOKEN, como las demás puertas de n8n.
 */
export async function POST(request: Request) {
  const pedido = await leerPedido(request);
  if (pedido instanceof Response) return pedido;
  const { accion, ejecucion, cuerpo } = pedido;
  const supabase = crearClienteDeServicio();

  if (accion === "tomar") {
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

  if (accion === "confirmar" || accion === "soltar") {
    if (typeof cuerpo.resumen !== "string" || !UUID.test(cuerpo.resumen)) {
      return Response.json({ error: "Falta el resumen." }, { status: 400 });
    }
    const funcion = accion === "confirmar" ? "confirmar_resumen" : "soltar_resumen";
    const { data, error } = await supabase.rpc(funcion, { p_resumen: cuerpo.resumen, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el resumen. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [accion === "confirmar" ? "confirmado" : "soltado"]: data === true });
  }

  return ACCION_NO_VALIDA();
}
