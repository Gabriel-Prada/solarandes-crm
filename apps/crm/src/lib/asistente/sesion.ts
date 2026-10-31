import { createHash, randomBytes } from "node:crypto";

/**
 * La identidad de una conversación del asistente: un número aleatorio de 128 bits en una cookie que la
 * página no puede leer (httpOnly), que no viaja a otros sitios (SameSite=Strict) y vence a las 2 horas.
 * La base guarda solo su huella SHA-256, nunca el valor. No se ata a la IP: un celular que pasa de wifi
 * a datos perdería la conversación (docs/plan-fase-6.md, ajustes de la revisión).
 */

export const COOKIE = "asistente_conversacion";
export const DURACION_SEGUNDOS = 2 * 60 * 60;

export function nuevaClave(): string {
  return randomBytes(16).toString("base64url");
}

export function huellaDeClave(clave: string): string {
  return createHash("sha256").update(clave).digest("hex");
}

export function claveDeLaCookie(cabeceras: Headers): string | null {
  const cookies = cabeceras.get("cookie") ?? "";
  for (const parte of cookies.split(";")) {
    const [nombre, ...valor] = parte.trim().split("=");
    if (nombre === COOKIE) {
      const clave = valor.join("=");
      return /^[A-Za-z0-9_-]{22}$/.test(clave) ? clave : null;
    }
  }
  return null;
}

export function cookieDeConversacion(clave: string, produccion: boolean): string {
  return [
    `${COOKIE}=${clave}`,
    "Path=/",
    `Max-Age=${DURACION_SEGUNDOS}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(produccion ? ["Secure"] : []),
  ].join("; ");
}

/**
 * ¿El pedido viene de la propia página? El navegador pone la cabecera Origin y una página ajena no puede
 * cambiarla. Esto frena a otros sitios, NO a robots (un programa pone la cabecera que quiera): contra los
 * robots están los topes de la base.
 */
export function vieneDeLaPagina(cabeceras: Headers, urlDelPedido: string): boolean {
  const origen = cabeceras.get("origin");
  if (!origen) return false;
  try {
    const propio = new URL(urlDelPedido);
    const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? propio.host;
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

/** "viernes 30 de octubre de 2026, 8:15 p. m." en hora de Bogotá (Vercel corre en UTC). */
export function fechaHoraBogota(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(ahora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  const ampm = p("dayPeriod").toLowerCase().replace(/\s/g, "").startsWith("a") ? "a. m." : "p. m.";
  return `${p("weekday")} ${p("day")} de ${p("month")} de ${p("year")}, ${p("hour")}:${p("minute")} ${ampm}`;
}
