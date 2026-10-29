import { leerPedido } from "@/lib/automatizaciones/pedido";
import { armarAvisoPrioritario, calificarVuelta, type AvisoPrioritario } from "@/lib/automatizaciones/calificacion";
import { clienteAnthropic } from "@/lib/ia/cliente";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

// Hasta 5 leads en 20 segundos, y el último con Claude máximo 20 segundos: cabe en 60
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ventanilla de la calificación de leads (flujo 08 de n8n, migración 020). Acciones:
 * - { accion: "calificar", ejecucion }: califica hasta 5 leads que estén esperando, de a uno, y se detiene
 *   con el primero que no sale bien (calificarVuelta). No recibe texto: el mensaje lo saca de la base, así
 *   una llave filtrada no sirve como "Claude gratis". Devuelve cuántos calificó, por qué se detuvo, el
 *   código del error de Claude si lo hubo (y si es de configuración: sin saldo, llave inválida) y cuántos
 *   leads ya intentados llevan más de 30 minutos esperando (la señal de la alarma).
 * - { accion: "avisos", ejecucion }: los avisos de "lead prioritario" pendientes, como correos escritos;
 *   los atascados, y los leads que terminaron mal en las últimas 24 horas (para avisar una vez cada uno).
 * - { accion: "reservar_aviso" | "confirmar_aviso" | "soltar_aviso", ejecucion, id }: la reserva del aviso
 *   (sale una vez; si el correo no salió, se suelta para reintentarlo en la vuelta siguiente).
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
      return Response.json(await calificarVuelta(supabase, clienteAnthropic()));
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
    const { data: terminadasMal, error: errorTerminadas } = await supabase.rpc("calificaciones_terminadas_mal");
    if (errorTerminadas) {
      console.error("calificaciones_terminadas_mal falló", errorTerminadas);
      return Response.json({ error: "El CRM no pudo revisar los avisos. Intenta de nuevo." }, { status: 500 });
    }
    const origen = new URL(request.url).origin;
    const correos = (data.pendientes as AvisoPrioritario[]).map((a) => armarAvisoPrioritario(a, origen));
    return Response.json({ correos, atascados: data.atascados, terminadas_mal: terminadasMal });
  }

  const funciones = {
    reservar_aviso: ["reservar_aviso_prioritario", "reservado"],
    confirmar_aviso: ["confirmar_aviso_prioritario", "confirmado"],
    soltar_aviso: ["soltar_aviso_prioritario", "soltado"],
  } as const;
  if (accion === "reservar_aviso" || accion === "confirmar_aviso" || accion === "soltar_aviso") {
    if (typeof cuerpo.id !== "string" || !UUID.test(cuerpo.id)) {
      return Response.json({ error: "Falta el aviso." }, { status: 400 });
    }
    const [funcion, respuesta] = funciones[accion];
    const { data, error } = await supabase.rpc(funcion, { p_calificacion: cuerpo.id, p_ejecucion: ejecucion });
    if (error) {
      console.error(`${funcion} falló`, error);
      return Response.json({ error: "El CRM no pudo anotar el aviso. Intenta de nuevo." }, { status: 500 });
    }
    return Response.json({ [respuesta]: data === true });
  }

  return Response.json(
    { error: "La acción debe ser calificar, avisos, reservar_aviso, confirmar_aviso o soltar_aviso." },
    { status: 400 },
  );
}
