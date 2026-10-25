"use server";

import { headers } from "next/headers";

import { prepararLead } from "@/lib/automatizaciones/lead";
import { registrarLead } from "@/lib/automatizaciones/registrar";
import { leerEnvio, VERSION_AUTORIZACION, type CamposDelLead } from "@/lib/formulario/envio";
import { huellaDeIp, ipDeLaPeticion } from "@/lib/formulario/huella";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

// Lo que escribió la persona vuelve con el error: React borra el formulario al enviarlo y tendría
// que llenarlo todo otra vez solo para corregir un dato
export type EstadoCotiza = { enviado: boolean; error: string | null; valores?: CamposDelLead };

// La página pública solo dice tres cosas, iguales para un lead nuevo, uno que ya era cliente, uno
// en revisión o un envío repetido: decir más revelaría si un celular es cliente y quién lo atiende
const GRACIAS: EstadoCotiza = { enviado: true, error: null };
const MAS_TARDE: EstadoCotiza = {
  enviado: false,
  error: "No pudimos recibir tu solicitud en este momento. Intenta de nuevo en unos minutos.",
};
const conError = (error: string, valores?: CamposDelLead): EstadoCotiza => ({ enviado: false, error, valores });

/**
 * El formulario público de cotización. Es una Server Action: Next.js compara la cabecera Origin (de
 * qué sitio dice venir la petición) con el dominio, así que otra página no puede hacer que el
 * navegador de sus visitantes envíe a este formulario. Eso no frena a un robot que fabrique la
 * petición él mismo: contra los robots están el campo trampa y el límite de envíos.
 * El diseño, con lo que puede fallar, está en docs/plan-fase-3.md, sección 4b.
 */
export async function enviarCotizacion(_previo: EstadoCotiza, formulario: FormData): Promise<EstadoCotiza> {
  const envio = leerEnvio((campo) => String(formulario.get(campo) ?? ""));

  // Un robot que llenó el campo trampa: se le dice "gracias" y no se guarda nada (no sabe que falló)
  if (envio.trampa) return GRACIAS;
  if (!envio.idEnvio) return conError("No se pudo enviar. Recarga la página e intenta de nuevo.", envio.campos);
  if (!envio.autorizo) return conError("Para enviar tus datos debes autorizar su tratamiento.", envio.campos);

  // El límite de envíos, con una huella de la conexión (nunca la IP)
  let huella: string;
  try {
    huella = huellaDeIp(ipDeLaPeticion(await headers()), process.env.HUELLA_SECRETA);
  } catch (error) {
    console.error("No se pudo calcular la huella del envío", error);
    return { ...MAS_TARDE, valores: envio.campos };
  }
  const { data: permiso, error: errorPermiso } = await crearClienteDeServicio().rpc("permitir_envio_formulario", {
    p_huella: huella,
  });
  if (errorPermiso) {
    console.error("permitir_envio_formulario falló", errorPermiso);
    return { ...MAS_TARDE, valores: envio.campos };
  }
  if (permiso !== "ok") return { ...MAS_TARDE, valores: envio.campos };

  // Las mismas reglas de siempre: limpiar (fase 2), buscar duplicados y registrar
  const clave = `form:${envio.idEnvio}`;
  const preparado = prepararLead({ ...envio.campos, clave, canal: "web" });
  if ("error" in preparado) return conError(preparado.error, envio.campos);

  const registro = await registrarLead(preparado.lead, {
    ...envio.campos,
    clave,
    canal: "web",
    mensaje: preparado.lead.mensaje ?? "",
    // Ley 1581: la prueba de la autorización (queda aunque se borren los demás datos del radicado)
    autorizacion: { aceptada_en: new Date().toISOString(), version: VERSION_AUTORIZACION },
  });
  if (!registro.ok) {
    // Nunca el mensaje crudo de la base de datos: solo un aviso general
    return registro.estado === 400
      ? conError("Revisa los datos e intenta de nuevo.", envio.campos)
      : { ...MAS_TARDE, valores: envio.campos };
  }
  return GRACIAS;
}
