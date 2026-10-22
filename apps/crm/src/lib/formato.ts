// Cómo se muestran números, fechas y teléfonos en pantalla (formato colombiano).

const ZONA = "America/Bogota";

export function formatoTelefono(telefono: string): string {
  // +573001234567 -> 300 123 4567
  const d = telefono.replace(/^\+57/, "");
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export function formatoFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: ZONA }).format(
    new Date(iso),
  );
}

export function formatoFechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONA,
  }).format(new Date(iso));
}

export function formatoNumero(n: number): string {
  return new Intl.NumberFormat("es-CO").format(n);
}

export function formatoPesos(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

/** Versión corta para tarjetas: $14,9 M */
export function formatoPesosCorto(n: number): string {
  return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n / 1_000_000)} M`;
}
