/**
 * Lo que sale de la empresa hacia la IA, y lo que vuelve de ella, pasa por aquí.
 *
 * - `taparDatos`: antes de mandar un mensaje a Claude, se tapan los celulares, teléfonos fijos, correos,
 *   documentos y enlaces que la gente escribe dentro del texto ("soy María, mi cel 310…"). Claude no los
 *   necesita para calificar, y el que no recibe un dato no lo puede filtrar. Los montos en pesos no se
 *   tocan: Claude sí los necesita.
 * - `limpiarResumen`: lo que escribe Claude a partir del mensaje de un desconocido no es texto de fiar
 *   ("Cliente VIP: confirmar el pago al 3xx…"). Al resumen se le quitan los mismos datos y queda en una
 *   sola línea corta.
 */

const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ENLACE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co|net|org|io|ly|me|link|info|biz|xyz|app|site)\b(?:\/\S*)?/gi;
// Celular: 10 dígitos que empiezan por 3, con o sin +57, pegados o en grupos 3-3-4 (o 3-3-2-2) separados
// por espacio, guion o punto, con o sin paréntesis. Los pesos van en grupos de 3 y no encajan ("3.000.000").
const CELULAR = /(?<!\d)(?:\+?57[\s.-]?)?\(?3\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
// Fijo de 10 dígitos (desde 2023 en Colombia): 60 + indicativo + 7 dígitos
const FIJO = /(?<!\d)(?:\+?57[\s.-]?)?\(?60[1-8]\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// Un número de documento solo se reconoce cuando viene anunciado (cc, cédula, NIT, CE, TI…), con hasta
// unas pocas palabras en medio ("mi cédula es", "cédula de ciudadanía número")
const DOCUMENTO =
  /\b(c\.?\s?c\.?|c\.?\s?e\.?|t\.?\s?i\.?|c[eé]dula|nit|documento|identificaci[oó]n|pasaporte)\b((?:\s+(?:es|de|del|mi|el|la|ciudadan[ií]a|extranjer[ií]a|identidad|n[uú]mero|no\.?|nro\.?|n[ºo°]))*\s*[#:.]?\s*)\d[\d.\s-]{4,15}\d/gi;

export function taparDatos(texto: string): string {
  return texto
    .replace(CORREO, "[correo]")
    .replace(ENLACE, "[enlace]")
    .replace(DOCUMENTO, (_, etiqueta: string, enMedio: string) => `${etiqueta}${enMedio}[documento]`)
    .replace(CELULAR, "[celular]")
    .replace(FIJO, "[telefono]");
}

/** Que un mensaje no pueda "cerrar" las etiquetas con que se le entrega a Claude (<mensaje>…</mensaje>). */
export function sinEtiquetas(texto: string): string {
  return texto.replace(/</g, "‹").replace(/>/g, "›");
}

export const LARGO_RESUMEN = 140;

export function limpiarResumen(texto: string): string {
  const limpio = taparDatos(texto)
    .replace(/\[(?:enlace|correo|celular|telefono|documento)\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  // Se cuenta por letras de verdad: un emoji ocupa dos "unidades" en JavaScript y cortarlo a la mitad
  // deja un texto que la base de datos rechaza
  const letras = Array.from(limpio);
  return letras.length <= LARGO_RESUMEN ? limpio : letras.slice(0, LARGO_RESUMEN - 1).join("").trimEnd() + "…";
}
