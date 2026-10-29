import { ACCION_NO_VALIDA, leerPedido } from "@/lib/automatizaciones/pedido";
import { armarAvisoPrioritario, calificarSiguiente, type AvisoPrioritario } from "@/lib/automatizaciones/calificacion";
import { clienteAnthropic } from "@/lib/ia/cliente";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

// Un lead por pedido y Claude con máximo 20 segundos: sobra con 60
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla de la calificación de leads (flujo 08 de n8n, migración 020). Acciones:
 * - { accion: "calificar", ejecucion }: califica el siguiente lead que esté esperando (uno solo). No
 *   recibe texto: el mensaje lo saca de la base, así una llave filtrada no sirve como "Claude gratis".
 *   Devuelve "nada", "sin_cupo" o el resultado, y cuántos leads llevan más de 30 minutos esperando
 *   (la señal de la alarma).
 * - { accion: "avisos", ejecucion }: los avisos de "lead prioritario" pendientes, como correos escritos.
 * - { accion: "reservar_aviso" | "confirmar_aviso", ejecucion, id }: la reserva del aviso (sale una vez).
 *
 * La protege AUTOMATIZACIONES_TOKEN; los correos van al equipo y n8n los manda por destino seguro.
 */
export async function POST(request: Request) {
  const pedido = await leerPedido(request);
  if (pedido instanceof Response) return pedido;
  const { accion, ejecucion, cuerpo } = pedido;
  const supabase = crearClienteDeServicio();

  if (accion === "calificar") {
    try {
      return Response.json(await calificarSiguiente(supabase, clienteAnthropic()));
    } catch (e) {
      console.error("La calificación falló", e);
      return Response.json({ error: "El CRM no pudo calificar el lead. Intenta de nuevo." }, { status: 500 });
    }
  }

  if (accion === "avisos") {
    const { data, error } = await supabase.rpc("avisos_prioritarios_pendientes");
    if (error) {
      console.error("avisos_prioritarios_pendientes falló", error);
      return Response.json({ error: "El CRM no pudo revisar los avisos. Intenta de nuevo." }, { status: 500 });
    }
    const origen = new URL(request.url).origin;
    const correos = (data.pendientes as AvisoPrioritario[]).map((a) => armarAvisoPrioritario(a, origen));
    return Response.json({ correos, atascados: data.atascados });
  }

  if (accion === "reservar_aviso" || accion === "confirmar_aviso") {
    if (typeof cuerpo.id !== "string" || !UUID.test(cuerpo.id)) {
      return Response.json({ error: "Falta el aviso." }, { status: 400 });
    }
    const funcion = accion === "reservar_aviso" ? "reservar_aviso_prioritario" : "confirmar_aviso_prioritario";
    const { data, error } = await supabase.rpc(funcion, { p_calificacion: cuerpo.id, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el aviso. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [accion === "reservar_aviso" ? "reservado" : "confirmado"]: data === true });
  }

  return ACCION_NO_VALIDA();
}
