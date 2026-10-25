import { ACCION_NO_VALIDA, leerPedido } from "@/lib/automatizaciones/pedido";
import { armarRecordatorio, type AvisoDeLaBase } from "@/lib/automatizaciones/posventa";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla de la posventa (flujo 6 de n8n, migración 018). Tres acciones:
 * - { accion: "tomar", ejecucion }: crea las tareas de mantenimiento de los aniversarios nuevos (eso lo
 *   hace la base de datos, sin esperar al correo), reserva los recordatorios a clientes que faltan y los
 *   devuelve como correos ya escritos. También dice cuántos se vencieron (7 días sin salir).
 * - { accion: "confirmar" | "soltar", ejecucion, id }: el recordatorio salió o falló.
 *
 * Devuelve correos de clientes: la protege AUTOMATIZACIONES_TOKEN, y n8n los manda por destino seguro.
 */
export async function POST(request: Request) {
  const pedido = await leerPedido(request);
  if (pedido instanceof Response) return pedido;
  const { accion, ejecucion, cuerpo } = pedido;
  const supabase = crearClienteDeServicio();

  if (accion === "tomar") {
    const { data, error } = await supabase.rpc("tomar_posventa", { p_ejecucion: ejecucion });
    if (error) {
      console.error("tomar_posventa falló", error);
      return Response.json({ error: "El CRM no pudo revisar la posventa. Intenta de nuevo." }, { status: 500 });
    }
    const correos = (data.correos as AvisoDeLaBase[]).map(armarRecordatorio);
    return Response.json({ correos, sin_gerente: data.sin_gerente === true, vencidos: Number(data.vencidos) || 0 });
  }

  if (accion === "confirmar" || accion === "soltar") {
    if (typeof cuerpo.id !== "string" || !UUID.test(cuerpo.id)) {
      return Response.json({ error: "Falta el aviso." }, { status: 400 });
    }
    const funcion = accion === "confirmar" ? "confirmar_posventa" : "soltar_posventa";
    const { data, error } = await supabase.rpc(funcion, { p_aviso: cuerpo.id, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el aviso. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [accion === "confirmar" ? "confirmado" : "soltado"]: data === true });
  }

  return ACCION_NO_VALIDA();
}
