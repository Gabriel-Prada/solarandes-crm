/**
 * La lógica de la puerta de entrada de las automatizaciones (/api/automatizaciones/leads).
 *
 * n8n entrega un lead (del formulario web o de WhatsApp); aquí se ordena con las mismas reglas
 * de la fase 2 (src/lib/importar) y se decide si es una persona nueva, un cliente que ya existe
 * o una duda. No toca la base de datos ni la red, así que se prueba sola (lead.test.ts).
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { Ciudad, TipoContacto } from "@/lib/tipos";

import { buscarEnCrm, MAXIMO_CONSUMO, type ContactoDelCrm } from "../importar/analizar";
import { nombrePropio, normalizarCiudad, normalizarConsumo, normalizarCorreo, separarNombre } from "../importar/limpieza";
import { normalizarTelefono } from "../telefono";

const CANALES = ["web", "whatsapp"] as const;
type Canal = (typeof CANALES)[number];

export type LeadPreparado = {
  clave: string;
  canal: Canal;
  // El nombre de la persona, aparte: para buscar duplicados no sirve el del negocio
  // (en el CRM, "nombre" es la persona y "empresa" el negocio)
  persona: string | null;
  contacto: {
    tipo: TipoContacto;
    nombre: string;
    empresa: string;
    telefono: string;
    email: string;
    ciudad: Ciudad;
    consumo_kwh_mes: number | null;
  };
  mensaje: string | null;
};

export type Decision = { existente: string | null; duda: string | null };

/**
 * ¿La llave que trae la llamada es la de las automatizaciones? Se comparan las huellas (sha256)
 * con timingSafeEqual: una comparación normal tarda más cuantas más letras acierta, y medir ese
 * tiempo permitiría adivinar la llave de a una letra.
 */
export function llaveValida(cabecera: string | null, esperada: string | undefined): boolean {
  if (!esperada || esperada.length < 32 || !cabecera?.startsWith("Bearer ")) return false;
  const huella = (texto: string) => createHash("sha256").update(texto).digest();
  return timingSafeEqual(huella(cabecera.slice("Bearer ".length)), huella(esperada));
}

/** La clave de un envío (la misma regla de la tabla envios_recibidos: de 8 a 200 caracteres). */
export function leerClave(valor: unknown): string | null {
  const clave = typeof valor === "string" ? valor.trim() : "";
  return clave.length >= 8 && clave.length <= 200 ? clave : null;
}

/** Un texto si viene como texto o número; null si no viene o viene vacío. */
function texto(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return null;
  return valor.trim() || null;
}

/**
 * Ordena lo que llega de n8n. Si falta algo que el CRM exige o un dato no se entiende, devuelve el
 * error para el cliente (la respuesta será "datos inválidos" y n8n no reintentará: reintentar no
 * arregla un celular mal escrito).
 */
export function prepararLead(entrada: unknown): { lead: LeadPreparado } | { error: string } {
  if (typeof entrada !== "object" || entrada === null) return { error: "El cuerpo debe ser un objeto JSON." };
  const e = entrada as Record<string, unknown>;

  const clave = leerClave(e.clave);
  if (!clave) return { error: "Falta la clave del envío (entre 8 y 200 caracteres)." };
  const canal = texto(e.canal);
  if (!CANALES.includes(canal as Canal)) return { error: "El canal debe ser web o whatsapp." };

  // Con empresa en su propio campo, el nombre es solo de la persona (como en la importación de CSV)
  let nombre: string | null;
  let empresa: string | null;
  if (texto(e.empresa)) {
    empresa = nombrePropio(texto(e.empresa)!);
    nombre = texto(e.nombre) ? nombrePropio(texto(e.nombre)!) : null;
  } else {
    const [persona, negocio, dudoso] = separarNombre(texto(e.nombre));
    // En un formulario la persona escribe su propio nombre: si no se puede partir, se deja entero
    [nombre, empresa] = dudoso ? [nombrePropio(texto(e.nombre)!), null] : [persona, negocio];
  }
  if (!nombre && !empresa) return { error: "Falta el nombre." };
  if ((nombre?.length ?? 0) > 120 || (empresa?.length ?? 0) > 120) return { error: "El nombre es demasiado largo." };

  const telefono = normalizarTelefono(texto(e.celular) ?? texto(e.telefono));
  if (!telefono) return { error: "El celular no es válido: debe ser un celular colombiano de 10 dígitos." };

  const ciudad = normalizarCiudad(texto(e.ciudad));
  if (!ciudad) return { error: "La ciudad debe ser Bogotá, Medellín o Cali." };

  const correoEscrito = texto(e.correo) ?? texto(e.email);
  const correo = normalizarCorreo(correoEscrito);
  if (correoEscrito && !correo) return { error: "El correo no es válido." };

  // El consumo es opcional: si no se entiende o es absurdo, la venta queda "por definir" (no se pierde el lead)
  const consumoEscrito = normalizarConsumo(texto(e.consumo) ?? texto(e.consumo_kwh_mes));
  const consumo = consumoEscrito !== null && consumoEscrito <= MAXIMO_CONSUMO ? consumoEscrito : null;
  const mensaje = texto(e.mensaje);

  return {
    lead: {
      clave,
      canal: canal as Canal,
      persona: nombre,
      contacto: {
        tipo: empresa ? "negocio" : "hogar",
        nombre: nombre ?? empresa!,
        empresa: empresa ?? "",
        telefono,
        email: correo ?? "",
        ciudad,
        consumo_kwh_mes: consumo,
      },
      mensaje: mensaje ? mensaje.slice(0, 2000) : null,
    },
  };
}

/**
 * Lo que mandó la persona, para guardarlo en el radicado: es el "cuerpo" que usan los avisos de n8n
 * (01c). Solo los campos conocidos, nunca lo demás que traiga el envío. Al guardarlo, registrarLead
 * cambia nombre, empresa, ciudad y celular por su versión ya limpia; correo, consumo y mensaje quedan
 * como vinieron.
 */
export function datosDelEnvio(entrada: unknown, lead: LeadPreparado): Record<string, string> {
  const e = (typeof entrada === "object" && entrada !== null ? entrada : {}) as Record<string, unknown>;
  const campo = (...nombres: string[]) => nombres.map((n) => texto(e[n])).find(Boolean) ?? "";
  return {
    clave: lead.clave,
    canal: lead.canal,
    nombre: campo("nombre"),
    empresa: campo("empresa"),
    celular: campo("celular", "telefono"),
    ciudad: campo("ciudad"),
    correo: campo("correo", "email"),
    consumo: campo("consumo", "consumo_kwh_mes"),
    mensaje: lead.mensaje ?? "",
  };
}

/** ¿Es una persona nueva, un cliente que ya existe o una duda? La misma regla de la fase 2. */
export function decidir(lead: LeadPreparado, crm: ContactoDelCrm[]): Decision {
  const { empresa, telefono, email, ciudad } = lead.contacto;
  const encontrado = buscarEnCrm(
    { fila: 0, nombre: lead.persona, empresa: empresa || null, telefono, correo: email || null, ciudad },
    crm,
  );
  if (encontrado === null) return { existente: null, duda: null };
  return "codigo" in encontrado ? { existente: encontrado.codigo, duda: null } : { existente: null, duda: encontrado.duda };
}

/**
 * Qué responderle a n8n si la base de datos devuelve un error, según su código:
 * - dato inválido (400): no se reintenta;
 * - choque momentáneo (503): sí se reintenta. El 23505 (celular repetido) solo pasa si dos envíos
 *   distintos de la misma persona nueva llegan a la vez; al reintentar, entra como cliente existente;
 * - lo demás es una falla (500): n8n reintenta y, si sigue, llega la alerta.
 */
export function tratarErrorDeBase(codigo: string | undefined): 400 | 503 | 500 {
  if (codigo && ["22003", "22023", "22P02", "23502", "23514"].includes(codigo)) return 400;
  if (codigo && ["23505", "40001", "40P01"].includes(codigo)) return 503;
  return 500;
}
