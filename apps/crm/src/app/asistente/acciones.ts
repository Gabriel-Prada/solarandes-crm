"use server";

import { cookies, headers } from "next/headers";

import { baseAsistente } from "@/lib/asistente/base";
import { COOKIE, huellaDeClave } from "@/lib/asistente/sesion";
import { prepararLead } from "@/lib/automatizaciones/lead";
import { registrarLead } from "@/lib/automatizaciones/registrar";
import { leerEnvio, VERSION_AUTORIZACION, type CamposDelLead } from "@/lib/formulario/envio";
import { huellaDeIp, ipDeLaPeticion } from "@/lib/formulario/huella";
import { crearClienteDeServicio } from "@/lib/supabase/servicio";

export type EstadoDatos = { enviado: boolean; error: string | null; valores?: CamposDelLead };

const GRACIAS: EstadoDatos = { enviado: true, error: null };
const MAS_TARDE = "No pudimos recibir tus datos en este momento. Intenta de nuevo en unos minutos.";

/**
 * El formulario de datos DENTRO del chat (fase 6, pieza 3). Va por el mismo camino de /cotiza: el límite
 * de envíos por huella, la limpieza y los duplicados de la fase 2, la asignación, los avisos de n8n y la
 * calificación de la fase 4. Claude nunca ve estos datos: solo se entera de que la persona los dejó.
 *
 * Este es un camino aparte del asistente a propósito: usa la llave de servicio (registrarLead la necesita
 * para buscar duplicados), cosa que el código del asistente nunca hace (decisión 3 del plan). Después ata
 * el lead a la conversación con el usuario del asistente: la base comprueba el envío.
 * La respuesta es la misma sea el lead nuevo, uno que ya era cliente o uno en revisión.
 */
export async function enviarDatosAsistente(_previo: EstadoDatos, formulario: FormData): Promise<EstadoDatos> {
  const envio = leerEnvio((campo) => String(formulario.get(campo) ?? ""));
  if (envio.trampa) return GRACIAS;
  if (!envio.idEnvio) return { enviado: false, error: "No se pudo enviar. Intenta de nuevo.", valores: envio.campos };
  if (!envio.autorizo) {
    return { enviado: false, error: "Para enviar tus datos debes autorizar su tratamiento.", valores: envio.campos };
  }
  const clave = (await cookies()).get(COOKIE)?.value;
  if (!clave || !/^[A-Za-z0-9_-]{22}$/.test(clave)) {
    return { enviado: false, error: "La conversación terminó. Recarga la página.", valores: envio.campos };
  }

  let huella: string;
  try {
    huella = huellaDeIp(ipDeLaPeticion(await headers()), process.env.HUELLA_SECRETA);
  } catch {
    return { enviado: false, error: MAS_TARDE, valores: envio.campos };
  }
  const servicio = crearClienteDeServicio();
  const { data: permiso, error: errorPermiso } = await servicio.rpc("permitir_envio_formulario", { p_huella: huella });
  if (errorPermiso || permiso !== "ok") return { enviado: false, error: MAS_TARDE, valores: envio.campos };

  const claveEnvio = `asistente:${envio.idEnvio}`;
  const mensaje = envio.campos.mensaje ? `(Llegó por el asistente Sol) ${envio.campos.mensaje}` : "(Llegó por el asistente Sol)";
  const preparado = prepararLead({ ...envio.campos, empresa: "", consumo: "", mensaje, clave: claveEnvio, canal: "web" });
  if ("error" in preparado) return { enviado: false, error: preparado.error, valores: envio.campos };

  const registro = await registrarLead(preparado.lead, {
    ...envio.campos,
    clave: claveEnvio,
    canal: "web",
    mensaje: preparado.lead.mensaje ?? "",
    autorizacion: { aceptada_en: new Date().toISOString(), version: VERSION_AUTORIZACION },
  });
  if (!registro.ok) {
    return {
      enviado: false,
      error: registro.estado === 400 ? "Revisa los datos e intenta de nuevo." : MAS_TARDE,
      valores: envio.campos,
    };
  }

  try {
    const atado = await baseAsistente.atarLead(huellaDeClave(clave), claveEnvio);
    if (atado.estado !== "ok") console.error("asistente: atar_lead", atado.motivo ?? atado.estado);
  } catch (e) {
    // El lead ya quedó registrado y el asesor recibe el aviso: solo falta atarlo a la conversación
    console.error("asistente: atar_lead falló", (e as { code?: string }).code ?? "sin_codigo");
  }
  return GRACIAS;
}
