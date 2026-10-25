import "server-only";

import { leerContactos } from "@/lib/importar/contactos-del-crm";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

import { decidir, tratarErrorDeBase, type LeadPreparado } from "./lead";

export type Registro =
  | { ok: true; respuesta: Record<string, unknown> }
  | { ok: false; estado: 400 | 503 | 500; mensaje: string };

/**
 * Registra un lead ya preparado: busca duplicados con las reglas de la fase 2 y llama a
 * capturar_lead(). Lo usan la puerta de n8n (/api/automatizaciones/leads) y el formulario público
 * (/cotiza): una sola copia de la regla.
 *
 * `datos` es lo que mandó la persona (con su clave), guardado en el radicado para que los avisos
 * salgan completos gane quien gane la reserva (migración 014). Se borra al confirmar los avisos.
 */
export async function registrarLead(lead: LeadPreparado, datosEscritos: Record<string, unknown>): Promise<Registro> {
  // Nombre, empresa, ciudad y celular van ya limpios: así los avisos se ven bien venga de donde venga el lead
  const { nombre, empresa, ciudad, telefono } = lead.contacto;
  const datos = { ...datosEscritos, nombre, empresa, ciudad, celular: telefono };
  const supabase = crearClienteDeServicio();
  let decision;
  try {
    decision = decidir(lead, await leerContactos(supabase));
  } catch (error) {
    console.error("No se pudieron leer los contactos del CRM", error);
    return { ok: false, estado: 500, mensaje: "No se pudieron leer los contactos del CRM." };
  }

  const { data, error } = await supabase.rpc("capturar_lead", {
    p_clave: lead.clave,
    p_canal: lead.canal,
    p_contacto: lead.contacto,
    p_mensaje: lead.mensaje,
    p_existente: decision.existente,
    p_duda: decision.duda,
    p_datos: datos,
  });
  if (error) {
    const estado = tratarErrorDeBase(error.code);
    if (estado === 500) console.error("capturar_lead falló", error);
    const mensaje = estado === 400 ? error.message : "El CRM no pudo registrar el lead. Intenta de nuevo.";
    return { ok: false, estado, mensaje };
  }
  return { ok: true, respuesta: { ...data, contacto: { nombre, empresa, ciudad, telefono } } };
}
