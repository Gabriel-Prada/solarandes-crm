import { llaveValida } from "@/lib/automatizaciones/lead";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

/**
 * Lo que n8n pregunta cada minuto (flujo 01d): los leads registrados que todavía no tienen la reserva
 * de avisos (como máximo 20, los más viejos primero), las reservas atascadas (más de 15 minutos sin
 * confirmar, con la ejecución que las tomó) y cuántos envíos lleva el formulario frente a sus topes
 * (migraciones 014 y 015), más si el servidor tiene la llave de las huellas.
 *
 * Devuelve datos personales de leads: la protege AUTOMATIZACIONES_TOKEN, como las demás puertas de n8n.
 */
export async function GET(request: Request) {
  if (!llaveValida(request.headers.get("authorization"), process.env.AUTOMATIZACIONES_TOKEN)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  const { data, error } = await crearClienteDeServicio().rpc("avisos_pendientes", { p_limite: 20 });
  if (error) {
    console.error("avisos_pendientes falló", error);
    return Response.json({ error: "El CRM no pudo leer los pendientes." }, { status: 500 });
  }
  // Si el servidor no tiene HUELLA_SECRETA, el formulario responde "intenta más tarde" a todos: se
  // informa aquí para que n8n haga sonar la alarma (si no, los leads se perderían en silencio)
  const secreto = process.env.HUELLA_SECRETA;
  const huellaConfigurada = Boolean(secreto && secreto.length >= 32);
  return Response.json({ ...data, formulario: { ...data.formulario, huella_configurada: huellaConfigurada } });
}
