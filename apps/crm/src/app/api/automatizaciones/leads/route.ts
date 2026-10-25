import { datosDelEnvio, llaveValida, prepararLead } from "@/lib/automatizaciones/lead";
import { registrarLead } from "@/lib/automatizaciones/registrar";

// Un lead son unos pocos campos: un cuerpo más grande no es un lead
const TAMANO_MAXIMO = 20_000;

/**
 * La puerta de entrada de las automatizaciones: n8n entrega aquí cada lead (hoy desde su webhook de
 * pruebas; más adelante, WhatsApp) y el CRM lo registra con sus reglas. El formulario web público
 * no pasa por aquí: registra directo (/cotiza). El diseño está en docs/plan-fase-3.md, secciones 4 y 4b.
 *
 * No pasa por el portero de sesiones (proxy.ts): la protege su propia llave, AUTOMATIZACIONES_TOKEN.
 * Respuestas: 200 recibido, 400 datos inválidos (no reintentar), 401 llave equivocada,
 * 503 choque momentáneo (reintentar), 500 falla (reintentar y, si sigue, alerta).
 */
export async function POST(request: Request) {
  if (!llaveValida(request.headers.get("authorization"), process.env.AUTOMATIZACIONES_TOKEN)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const cuerpo = await request.text();
  if (cuerpo.length > TAMANO_MAXIMO) return Response.json({ error: "El envío es demasiado grande." }, { status: 400 });
  let entrada: unknown;
  try {
    entrada = JSON.parse(cuerpo);
  } catch {
    return Response.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }

  const preparado = prepararLead(entrada);
  if ("error" in preparado) return Response.json({ error: preparado.error }, { status: 400 });

  const registro = await registrarLead(preparado.lead, datosDelEnvio(entrada, preparado.lead));
  if (!registro.ok) return Response.json({ error: registro.mensaje }, { status: registro.estado });
  return Response.json(registro.respuesta);
}
