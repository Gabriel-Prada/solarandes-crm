import { decidir, llaveValida, prepararLead, tratarErrorDeBase } from "@/lib/automatizaciones/lead";
import { leerContactos } from "@/lib/importar/contactos-del-crm";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

// Un lead son unos pocos campos: un cuerpo más grande no es un lead
const TAMANO_MAXIMO = 20_000;

/**
 * La puerta de entrada de las automatizaciones: n8n entrega aquí cada lead (del formulario web o
 * de WhatsApp) y el CRM lo registra con sus reglas. El diseño está en docs/plan-fase-3.md, sección 4.
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
  const { lead } = preparado;

  const supabase = crearClienteDeServicio();
  let decision;
  try {
    decision = decidir(lead, await leerContactos(supabase));
  } catch (error) {
    console.error("No se pudieron leer los contactos del CRM", error);
    return Response.json({ error: "No se pudieron leer los contactos del CRM." }, { status: 500 });
  }

  const { data, error } = await supabase.rpc("capturar_lead", {
    p_clave: lead.clave,
    p_canal: lead.canal,
    p_contacto: lead.contacto,
    p_mensaje: lead.mensaje,
    p_existente: decision.existente,
    p_duda: decision.duda,
  });
  if (error) {
    const estado = tratarErrorDeBase(error.code);
    if (estado === 500) console.error("capturar_lead falló", error);
    const mensaje = estado === 400 ? error.message : "El CRM no pudo registrar el lead. Intenta de nuevo.";
    return Response.json({ error: mensaje }, { status: estado });
  }
  // Los datos ya limpios (nombre con mayúsculas, ciudad bien escrita), para que los avisos de n8n se vean bien
  const { nombre, empresa, ciudad, telefono } = lead.contacto;
  return Response.json({ ...data, contacto: { nombre, empresa, ciudad, telefono } });
}
