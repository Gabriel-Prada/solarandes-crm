/**
 * Las fechas del MCP, siempre en hora de Bogotá (docs/plan-fase-5.md, pieza 2). Vercel corre en UTC
 * y Claude no siempre sabe qué día es: por eso "hoy" lo dice el servidor y viaja en cada respuesta.
 * Bogotá está en UTC-5 todo el año (Colombia no cambia la hora).
 */

const DESFASE_MS = -5 * 60 * 60 * 1000;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
export const MAXIMO_DIAS_RANGO = 31;

/** La fecha de hoy en Bogotá, como AAAA-MM-DD. */
export function hoyEnBogota(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() + DESFASE_MS).toISOString().slice(0, 10);
}

/** Un momento guardado en la base, mostrado en hora de Bogotá: "2026-10-30 09:00". */
export function horaDeBogota(iso: string): string {
  return new Date(new Date(iso).getTime() + DESFASE_MS).toISOString().slice(0, 16).replace("T", " ");
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * UN_DIA_MS).toISOString().slice(0, 10);
}

/** ¿Es una fecha real con la forma AAAA-MM-DD? (2026-02-30 no lo es) */
function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

export type Rango =
  | { ok: true; desde: string; hasta: string; inicio: string; finExclusivo: string }
  | { ok: false; error: string };

/**
 * Un rango de días en Bogotá, con "hasta" incluido. Por omisión, de hoy a 7 días.
 * inicio y finExclusivo son los momentos exactos para consultar la base (con su -05:00).
 */
export function rangoEnBogota(desde: string | undefined, hasta: string | undefined, ahora: Date = new Date()): Rango {
  const malEscrita = { ok: false as const, error: "Las fechas van como AAAA-MM-DD, por ejemplo 2026-10-30." };
  const d = desde ?? hoyEnBogota(ahora);
  if (!fechaValida(d)) return malEscrita; // antes de sumarle días: una fecha inválida no se puede sumar
  const h = hasta ?? sumarDias(d, 7);
  if (!fechaValida(h)) return malEscrita;
  if (h < d) {
    const error = desde
      ? "La fecha final es anterior a la inicial."
      : `Sin fecha inicial se empieza hoy (${d}), y la final es anterior. Para ver días pasados, indica también desde cuándo.`;
    return { ok: false, error };
  }
  const dias = (Date.parse(`${h}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / UN_DIA_MS + 1;
  if (dias > MAXIMO_DIAS_RANGO) {
    return { ok: false, error: `El rango es de ${dias} días; el máximo es ${MAXIMO_DIAS_RANGO}. Pide un periodo más corto.` };
  }
  return { ok: true, desde: d, hasta: h, inicio: `${d}T00:00:00-05:00`, finExclusivo: `${sumarDias(h, 1)}T00:00:00-05:00` };
}
