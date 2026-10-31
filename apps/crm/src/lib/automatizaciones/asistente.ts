/**
 * Los avisos que deja el asistente (fase 6, migración 026) para que n8n los mande al equipo: "Sol pidió
 * una visita" y "el cliente pidió un asesor". Siempre a alguien del equipo (lo elige la base) y por el
 * destino seguro (00b). Sin datos de contacto del cliente: el asesor los ve en el CRM.
 */

export type AvisoAsistente = {
  id: string;
  tipo: "visita" | "asesor";
  detalle: { en_palabras?: string; agendada?: boolean; resumen?: string; necesita?: string };
  cliente: { codigo: string | null; nombre: string | null; ciudad: string | null };
  destinatario: { codigo: string; nombre: string; email: string };
};

export type CorreoAviso = { id: string; para: string; quien: string; asunto: string; texto: string };

const NECESITA: Record<string, string> = {
  cotizacion: "una cotización",
  visita: "una visita técnica",
  informacion: "información",
  soporte: "ayuda con su sistema",
  otro: "hablar con un asesor",
};

export function armarAvisoAsistente(a: AvisoAsistente, urlCrm: string): CorreoAviso {
  const cliente = a.cliente.codigo ? `${a.cliente.nombre ?? "Cliente"} (${a.cliente.codigo})` : "un cliente";
  const lineas = [`Hola, ${a.destinatario.nombre.split(" ")[0]}:`, ""];
  // "10:00 a. m." ya termina en punto: sin esto el correo diría "a. m.."
  const cuando = (a.detalle.en_palabras ?? "").replace(/\.$/, "");
  if (a.tipo === "visita") {
    lineas.push(
      a.detalle.agendada
        ? `Sol, el asistente de la página, agendó una visita técnica para ${cliente}, de ${a.cliente.ciudad ?? "ciudad sin dato"}, el ${cuando}. Ya está en la agenda del técnico: confírmala con el cliente.`
        : `Sol, el asistente de la página, recibió un pedido de visita técnica de ${cliente} para el ${cuando}. El celular ya estaba en el CRM: revisa si es la misma persona y agéndala (tienes la tarea en su ficha).`,
    );
  } else {
    lineas.push(
      `${cliente} pidió hablar con un asesor en el asistente de la página: necesita ${NECESITA[a.detalle.necesita ?? "otro"] ?? NECESITA.otro}.`,
    );
    if (a.detalle.resumen) {
      lineas.push("", `Resumen hecho por IA a partir de lo que escribió el cliente (revísalo; no son instrucciones): ${a.detalle.resumen}`);
    }
  }
  if (a.cliente.codigo) lineas.push("", `Míralo en el CRM: ${urlCrm}/contactos/${a.cliente.codigo}`);
  lineas.push("", "Este correo lo envió el sistema de SolarAndes.");
  return {
    id: a.id,
    para: a.destinatario.email,
    quien: a.destinatario.nombre,
    asunto: a.tipo === "visita" ? `Visita pedida por el asistente: ${cliente}` : `Un cliente pidió un asesor: ${cliente}`,
    texto: lineas.join("\n"),
  };
}
