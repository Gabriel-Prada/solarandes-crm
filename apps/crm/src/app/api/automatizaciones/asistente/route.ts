import { armarAvisoAsistente, type AvisoAsistente } from "@/lib/automatizaciones/asistente";
import { leerPedido } from "@/lib/automatizaciones/pedido";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla de los avisos del asistente (flujo 09 de n8n, migración 026). Acciones:
 * - { accion: "avisos", ejecucion }: los avisos pendientes como correos escritos, cuántos quedaron
 *   atascados y cómo va el día del asistente (gasto y topes, para la alarma de "tope alcanzado").
 * - { accion: "reservar_aviso" | "confirmar_aviso" | "soltar_aviso", ejecucion, id }: la reserva del aviso.
 * La protege AUTOMATIZACIONES_TOKEN; los correos van al equipo y n8n los manda por destino seguro.
 */
export async function POST(request: Request) {
  const pedido = await leerPedido(request);
  if (pedido instanceof Response) return pedido;
  const { accion, ejecucion, cuerpo } = pedido;
  const supabase = crearClienteDeServicio();

  if (accion === "avisos") {
    const [avisos, dia] = await Promise.all([
      supabase.rpc("asistente_avisos_pendientes"),
      supabase.rpc("asistente_estado_del_dia"),
    ]);
    if (avisos.error || dia.error) {
      console.error("avisos del asistente fallaron", avisos.error ?? dia.error);
      return Response.json({ error: "El CRM no pudo revisar los avisos del asistente. Intenta de nuevo." }, { status: 500 });
    }
    const origen = new URL(request.url).origin;
    const correos = (avisos.data.pendientes as AvisoAsistente[]).map((a) => armarAvisoAsistente(a, origen));
    const d = dia.data as { gasto_usd: number; conversaciones: number; topes: { gasto_usd_por_dia: number; conversaciones_por_dia: number } };
    return Response.json({
      correos,
      atascados: avisos.data.atascados,
      dia: {
        gasto_usd: Number(d.gasto_usd),
        conversaciones: d.conversaciones,
        tope_alcanzado:
          Number(d.gasto_usd) >= Number(d.topes.gasto_usd_por_dia) * 0.98 || d.conversaciones >= d.topes.conversaciones_por_dia,
      },
    });
  }

  const funciones = {
    reservar_aviso: ["asistente_reservar_aviso", "reservado"],
    confirmar_aviso: ["asistente_confirmar_aviso", "confirmado"],
    soltar_aviso: ["asistente_soltar_aviso", "soltado"],
  } as const;
  if (accion === "reservar_aviso" || accion === "confirmar_aviso" || accion === "soltar_aviso") {
    if (typeof cuerpo.id !== "string" || !UUID.test(cuerpo.id)) return Response.json({ error: "Falta el aviso." }, { status: 400 });
    const [funcion, respuesta] = funciones[accion];
    const { data, error } = await supabase.rpc(funcion, { p_aviso: cuerpo.id, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el aviso. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [respuesta]: data === true });
  }

  return Response.json({ error: "La acción debe ser avisos, reservar_aviso, confirmar_aviso o soltar_aviso." }, { status: 400 });
}
