/**
 * Limpieza de los datos de un archivo importado: deja cada valor en el formato del CRM.
 *
 * Es la misma limpieza del Excel heredado (scripts/migracion/normalizar.py), traducida a
 * TypeScript. Las dos versiones resuelven los mismos casos de tests/casos_compartidos/limpieza.json.
 *
 * Principio: la limpieza nunca inventa datos. Si un valor no se entiende, queda en null.
 */

import type { Ciudad, TipoContacto } from "@/lib/tipos";

// Palabras con las que empieza el nombre de un negocio. Un negocio que no empiece así
// ("Tienda Don Pepe") se toma como nombre de persona.
const INICIOS_DE_NEGOCIO = new Set([
  "carniceria", "colegio", "drogueria", "ferreteria", "gimnasio", "hotel",
  "lavanderia", "oficinas", "panaderia", "restaurante", "supermercado", "taller",
]); // prettier-ignore

// Palabras que van en minúscula dentro de un nombre propio
const CONECTORES = new Set(["de", "del", "la", "las", "los", "y"]);

/** Minúsculas, sin tildes y sin espacios de sobra: "  Teléfono " → "telefono". */
export function simplificar(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "") // quita tildes y cualquier símbolo que no sea una letra simple
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function normalizarCorreo(valor: string | null): string | null {
  if (valor === null) return null;
  const correo = valor.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(correo) ? correo : null;
}

/** Se reconoce por cómo empieza: "Bta", "Bogota DC", "Cali - Valle". "Localidad de Suba" no es Cali. */
export function normalizarCiudad(valor: string | null): Ciudad | null {
  const texto = valor === null ? "" : simplificar(valor);
  if (texto.startsWith("bog") || texto.startsWith("bta")) return "Bogotá";
  if (texto.startsWith("medellin") || texto.startsWith("mde")) return "Medellín";
  if (/^(santiago de )?cali\b/.test(texto)) return "Cali";
  return null;
}

export function normalizarTipo(valor: string | null): TipoContacto | null {
  const texto = valor === null ? "" : simplificar(valor);
  if (["casa", "residencial", "hogar"].includes(texto)) return "hogar";
  if (["comercial", "negocio", "empresa"].includes(texto)) return "negocio";
  return null;
}

export function normalizarConsumo(valor: string | null): number | null {
  if (valor === null || valor.includes("-")) return null; // un consumo negativo no existe
  const numeros = valor.trim().replace(/(\d)\.0$/, "$1").match(/\d+/g) ?? []; // "604.0" es 604
  return numeros.length === 1 && Number(numeros[0]) > 0 ? Number(numeros[0]) : null;
}

/** "MILENA CORREA  ORDÓÑEZ " → "Milena Correa Ordóñez"; respeta "S.A.S." y los conectores. */
export function nombrePropio(texto: string): string {
  return texto
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra, i) => {
      if (simplificar(palabra) === "s.a.s.") return "S.A.S.";
      if (i > 0 && CONECTORES.has(palabra.toLowerCase())) return palabra.toLowerCase();
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    })
    .join(" ");
}

export function pareceNegocio(texto: string): boolean {
  const simple = simplificar(texto);
  return simple !== "" && (INICIOS_DE_NEGOCIO.has(simple.split(" ")[0]) || simple.includes("s.a.s"));
}

/**
 * Devuelve [persona, empresa, dudoso].
 *
 * "Hotel López - Milena Correa" → ["Milena Correa", "Hotel López", false]. Con guion, se parte
 * solo si uno de los dos lados parece un negocio; si ninguno lo parece ("Pedro Gómez - Hijo"),
 * no se adivina: queda vacío y marcado como dudoso.
 */
export function separarNombre(valor: string | null): [string | null, string | null, boolean] {
  if (valor === null || valor.trim() === "") return [null, null, false];
  const texto = valor.trim();
  if (texto.includes(" - ")) {
    const corte = texto.indexOf(" - ");
    const izquierda = texto.slice(0, corte);
    const derecha = texto.slice(corte + 3);
    if (pareceNegocio(izquierda)) return [nombrePropio(derecha), nombrePropio(izquierda), false];
    if (pareceNegocio(derecha)) return [nombrePropio(izquierda), nombrePropio(derecha), false];
    return [null, null, true];
  }
  if (pareceNegocio(texto)) return [null, nombrePropio(texto), false];
  return [nombrePropio(texto), null, false];
}
