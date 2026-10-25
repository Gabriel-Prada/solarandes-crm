/**
 * La huella de la conexión de quien envía el formulario público (/cotiza), para el límite de envíos.
 * Nunca se guarda la IP: solo un HMAC (una huella calculada con una llave secreta, HUELLA_SECRETA).
 * Sin la llave no se puede saber qué IP produjo una huella, aunque se pruebe con todas las IPv4.
 */

import { createHmac } from "node:crypto";

/**
 * La IP de quien envía. Vercel pone estas cabeceras él mismo y descarta las que trae el visitante,
 * así que no se pueden falsificar (dejaría de ser cierto si se pone otro servicio adelante, como
 * Cloudflare). En local no existen: se usa "local".
 */
export function ipDeLaPeticion(cabeceras: Headers): string {
  const real = cabeceras.get("x-real-ip")?.trim();
  const reenviada = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return real || reenviada || "local";
}

/**
 * Con IPv6 (la usan muchos celulares), cada equipo tiene millones de direcciones dentro de su bloque
 * /64 y un robot las cambia gratis: se agrupa por el bloque. Con IPv4, la dirección tal cual.
 */
export function grupoDeLaIp(ip: string): string {
  const sinZona = ip.trim().toLowerCase().split("%")[0];
  const ipv4EnIpv6 = sinZona.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4EnIpv6) return ipv4EnIpv6[1];
  if (!sinZona.includes(":")) return sinZona;

  const [izquierda, derecha] = sinZona.split("::");
  const grupos = (texto: string | undefined) => (texto ? texto.split(":") : []);
  const completa =
    derecha === undefined
      ? grupos(izquierda)
      : [
          ...grupos(izquierda),
          ...Array(Math.max(0, 8 - grupos(izquierda).length - grupos(derecha).length)).fill("0"),
          ...grupos(derecha),
        ];
  return `${completa.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

export function huellaDeIp(ip: string, secreto: string | undefined): string {
  if (!secreto || secreto.length < 32) throw new Error("Falta HUELLA_SECRETA en el servidor (al menos 32 caracteres)");
  return createHmac("sha256", secreto).update(grupoDeLaIp(ip)).digest("hex");
}
