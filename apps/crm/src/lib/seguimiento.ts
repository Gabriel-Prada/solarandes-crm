// Reglas de seguimiento de docs/requisitos.md, sección 6:
// un lead sin actividad en 3 días está "sin seguimiento"; a los 7 días se avisa a la gerente.

export const DIAS_SIN_SEGUIMIENTO = 3;
export const DIAS_AVISO_GERENTE = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export type NivelSeguimiento = "al_dia" | "sin_seguimiento" | "aviso_gerente";

/** Fecha de la última actividad ya realizada; si no hay ninguna, la fecha de respaldo (p. ej. cuando se creó). */
export function ultimaActividad(actividades: { fecha: string; completada: boolean }[], respaldo: string): string {
  return actividades
    .filter((a) => a.completada)
    .reduce((ultima, a) => (new Date(a.fecha) > new Date(ultima) ? a.fecha : ultima), respaldo);
}

export function diasDesde(fecha: string, ahora: number): number {
  return Math.max(0, Math.floor((ahora - new Date(fecha).getTime()) / DIA_MS));
}

export function nivelSeguimiento(diasSinActividad: number): NivelSeguimiento {
  if (diasSinActividad >= DIAS_AVISO_GERENTE) return "aviso_gerente";
  if (diasSinActividad >= DIAS_SIN_SEGUIMIENTO) return "sin_seguimiento";
  return "al_dia";
}
