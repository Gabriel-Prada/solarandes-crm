/**
 * La prioridad de los leads en la pantalla (fase 4, pieza 1). La calcula la base de datos (vista
 * prioridades_leads: la del asesor si la puso; si no, la de la regla). Aquí solo se decide cómo se
 * muestra y en qué orden.
 */

export type Prioridad = "alta" | "media" | "baja" | "no_es_lead";
export const PRIORIDADES: Prioridad[] = ["alta", "media", "baja", "no_es_lead"];

export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = {
  alta: "Prioridad alta",
  media: "Prioridad media",
  baja: "Prioridad baja",
  no_es_lead: "No es lead",
};

export type EstadoCalificacion =
  | "por_calificar"
  | "en_curso"
  | "calificada"
  | "sin_mensaje"
  | "rechazada"
  | "fallida"
  | "vencida";

/** Una fila de la vista prioridades_leads (solo lo que usa la pantalla). */
export type FilaPrioridad = {
  id: string;
  oportunidad_id: string | null;
  estado: EstadoCalificacion;
  prioridad: Prioridad | null;
  prioridad_asesor: Prioridad | null;
  creada_en: string;
};

export type Etiqueta = { texto: string; tono: "alta" | "media" | "baja" | "gris" };

/** Lo que se lee en la tarjeta. Sin calificación (leads de antes de la fase 4): null, no se muestra nada. */
export function etiquetaPrioridad(fila: Pick<FilaPrioridad, "estado" | "prioridad"> | null): Etiqueta | null {
  if (!fila) return null;
  if (fila.prioridad) {
    const tono = fila.prioridad === "no_es_lead" ? "gris" : fila.prioridad;
    return { texto: NOMBRE_PRIORIDAD[fila.prioridad], tono };
  }
  if (fila.estado === "por_calificar" || fila.estado === "en_curso") return { texto: "Calificando…", tono: "gris" };
  return { texto: "Sin calificar", tono: "gris" }; // rechazada, fallida o vencida: la IA no pudo
}

/** En el tablero vale la calificación más reciente de cada venta. */
export function ultimaPorVenta(filas: FilaPrioridad[]): Map<string, FilaPrioridad> {
  const porVenta = new Map<string, FilaPrioridad>();
  for (const fila of filas) {
    if (!fila.oportunidad_id) continue; // un cliente que volvió a escribir: solo en su ficha
    const actual = porVenta.get(fila.oportunidad_id);
    if (!actual || fila.creada_en > actual.creada_en) porVenta.set(fila.oportunidad_id, fila);
  }
  return porVenta;
}

const PESO: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2, no_es_lead: 3 };

/**
 * Las de prioridad alta arriba; después las de media (y las que no tienen prioridad), baja y "no es lead".
 * Dentro de cada grupo se respeta el orden que traían (la más reciente primero).
 */
export function ordenarPorPrioridad<T>(tarjetas: T[], prioridadDe: (t: T) => Prioridad | null | undefined): T[] {
  const peso = (t: T) => PESO[prioridadDe(t) ?? "media"];
  return tarjetas
    .map((t, i) => ({ t, i }))
    .sort((a, b) => peso(a.t) - peso(b.t) || a.i - b.i)
    .map(({ t }) => t);
}
