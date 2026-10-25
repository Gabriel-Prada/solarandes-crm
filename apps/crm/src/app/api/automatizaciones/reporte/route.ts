import { ACCION_NO_VALIDA, leerPedido } from "@/lib/automatizaciones/pedido";
import { armarReporte, type ReporteDeLaBase } from "@/lib/automatizaciones/reporte";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La ventanilla del reporte semanal (flujo 5 de n8n, migración 018). Tres acciones:
 * - { accion: "tomar", ejecucion }: reserva el reporte de la semana que acaba de terminar, si no ha
 *   salido, y lo devuelve como correo ya escrito (una lista con uno o ninguno, como las otras ventanillas).
 * - { accion: "confirmar" | "soltar", ejecucion, id }: el correo salió o falló. El id es el lunes de la semana.
 *
 * La semana la decide la base de datos con la fecha de hoy: por aquí nadie puede pedir otras semanas.
 */
export async function POST(request: Request) {
  const pedido = await leerPedido(request);
  if (pedido instanceof Response) return pedido;
  const { accion, ejecucion, cuerpo } = pedido;
  const supabase = crearClienteDeServicio();

  if (accion === "tomar") {
    const { data, error } = await supabase.rpc("tomar_reporte_semanal", { p_ejecucion: ejecucion });
    if (error) {
      console.error("tomar_reporte_semanal falló", error);
      return Response.json({ error: "El CRM no pudo armar el reporte. Intenta de nuevo." }, { status: 500 });
    }
    const reporte = data.reporte as ReporteDeLaBase | null;
    const correos = reporte ? [armarReporte(reporte, new URL(request.url).origin)] : [];
    return Response.json({ correos, sin_gerente: data.sin_gerente === true });
  }

  if (accion === "confirmar" || accion === "soltar") {
    if (typeof cuerpo.id !== "string" || !FECHA.test(cuerpo.id)) {
      return Response.json({ error: "Falta la semana del reporte." }, { status: 400 });
    }
    const funcion = accion === "confirmar" ? "confirmar_reporte" : "soltar_reporte";
    const { data, error } = await supabase.rpc(funcion, { p_semana: cuerpo.id, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el reporte. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [accion === "confirmar" ? "confirmado" : "soltado"]: data === true });
  }

  return ACCION_NO_VALIDA();
}
