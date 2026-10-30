/**
 * Lo que necesitan las acciones del MCP (pieza 3) antes y después de llamar a la base: leer la fecha y
 * hora que manda Claude (en hora de Bogotá) y devolverla en palabras, para que la gerente vea en la
 * confirmación si Claude calculó mal "el jueves" (docs/plan-fase-5.md, pieza 3, decisión 4); y revisar
 * que lo que pidió Claude sea coherente antes de escribir (que nada se ignore en silencio).
 * Las reglas de las acciones viven en la base (migración 024); aquí no hay ninguna.
 */
import { DESFASE_MS } from "./fechas";

export { esResultado, type ResultadoAccion } from "@/lib/acciones-de-la-base";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export type FechaHora = { ok: true; iso: string } | { ok: false; error: string };

/** "2026-11-05 09:00" (hora de Bogotá; los segundos son opcionales) → el momento exacto, con su -05:00. */
export function leerFechaHora(texto: string): FechaHora {
  const partes = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto.trim());
  const error = "La fecha y hora van como AAAA-MM-DD HH:MM en hora de Bogotá, por ejemplo 2026-11-05 09:00.";
  if (!partes) return { ok: false, error };
  const [, anio, mes, dia, hora, minuto, segundo = "00"] = partes;
  const iso = `${anio}-${mes}-${dia}T${hora}:${minuto}:${segundo}-05:00`;
  const momento = new Date(iso);
  if (Number.isNaN(momento.getTime())) return { ok: false, error }; // antes de convertirla: una inválida no se convierte
  // Si la fecha no existe (30 de febrero), el reloj se corre y ya no dice lo mismo
  const deVuelta = new Date(momento.getTime() + DESFASE_MS).toISOString().slice(0, 16);
  if (deVuelta !== `${anio}-${mes}-${dia}T${hora}:${minuto}`) return { ok: false, error };
  return { ok: true, iso };
}

/** Un momento en palabras, en hora de Bogotá: "jueves 5 de noviembre de 2026, 9:00 a. m." */
export function enPalabras(iso: string): string {
  const b = new Date(new Date(iso).getTime() + DESFASE_MS);
  const horas = b.getUTCHours();
  const minutos = String(b.getUTCMinutes()).padStart(2, "0");
  const hora12 = horas % 12 === 0 ? 12 : horas % 12;
  const sufijo = horas < 12 ? "a. m." : "p. m.";
  return `${DIAS[b.getUTCDay()]} ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}, ${hora12}:${minutos} ${sufijo}`;
}

/** No se bloquea (puede ser a propósito), pero se avisa: domingo, o fuera de 7 a. m. a 6 p. m. */
export function avisoDeHorario(iso: string): string | undefined {
  const b = new Date(new Date(iso).getTime() + DESFASE_MS);
  const minutosDelDia = b.getUTCHours() * 60 + b.getUTCMinutes();
  if (b.getUTCDay() === 0) return "Ojo: es domingo.";
  if (minutosDelDia < 7 * 60 || minutosDelDia > 18 * 60) return "Ojo: es fuera del horario de 7 a. m. a 6 p. m.";
  return undefined;
}

// ---------------------------------------------------------------------------
// Que nada se ignore en silencio
// ---------------------------------------------------------------------------

/** La fecha solo va en tareas: una "llamada el jueves" no puede quedar como una llamada ya hecha. */
export function revisarActividad(tipo: string, fechaHora: string | undefined): string | null {
  if (tipo === "tarea" && !fechaHora) return "Una tarea lleva fecha y hora (AAAA-MM-DD HH:MM).";
  if (tipo !== "tarea" && fechaHora) {
    return "La fecha solo va en las tareas. Si es algo por hacer, regístralo como tarea; si ya pasó, sin fecha.";
  }
  return null;
}

/** El motivo solo va con "perdido". */
export function revisarMovimiento(etapa: string, motivo: string | undefined): string | null {
  if (etapa !== "perdido" && motivo) return "El motivo solo va cuando la venta se marca como perdida.";
  return null;
}

export type VentaAbierta = { codigo: string; nombre: string; etapaNombre: string };

/** Con el código del cliente: una sola venta abierta se usa; varias o ninguna, se pregunta. */
export function elegirVentaDelCliente<T extends VentaAbierta>(
  codigoCliente: string,
  abiertas: T[],
): { ok: true; venta: T } | { ok: false; error: string } {
  if (abiertas.length === 1) return { ok: true, venta: abiertas[0] };
  if (abiertas.length === 0) {
    return { ok: false, error: `${codigoCliente} no tiene ventas abiertas: no hay a qué agendarle la visita.` };
  }
  const lista = abiertas.map((v) => `${v.codigo} (${v.nombre}, ${v.etapaNombre})`).join("; ");
  return { ok: false, error: `${codigoCliente} tiene ${abiertas.length} ventas abiertas: ${lista}. ¿A cuál le agendo la visita?` };
}

/** Si llegan la venta y el cliente, tienen que corresponder: si no, la visita caería en el cliente equivocado. */
export function ventaDeEseCliente(codigoVenta: string, clienteDeLaVenta: string, codigoCliente?: string): string | null {
  if (codigoCliente && codigoCliente !== clienteDeLaVenta) {
    return `La venta ${codigoVenta} es del cliente ${clienteDeLaVenta}, no de ${codigoCliente}. Revisa cuál es.`;
  }
  return null;
}

/** Si la escritura falló por la conexión, puede que la base sí la haya guardado: no repetir a ciegas. */
export const NO_SE_SI_QUEDO =
  "No sé si quedó hecho: hubo un problema al hablar con el CRM. Revisa la ficha del cliente antes de repetirlo.";
