import type { Ficha } from "./ficha";
import type { EntradaLead } from "./prompt";

/**
 * Cómo se corrige el examen de la calificación de leads (los casos están en data/evals/leads/).
 *
 * Cada campo se compara con la respuesta correcta o con una de sus `aceptables` (cuando el mensaje de
 * verdad se puede leer de dos formas). La prioridad no la pone Claude: se calcula con la regla de la base
 * de datos, sobre la ficha de Claude y sobre la correcta, y se comparan.
 */

export const CAMPOS = ["es_lead", "tipo_cliente", "urgencia", "intencion", "consumo_kwh_mes", "factura_luz_cop"] as const;
export type Campo = (typeof CAMPOS)[number];
export type FichaSinResumen = Omit<Ficha, "resumen">;

export type Caso = {
  id: string;
  conjunto: "desarrollo" | "prueba" | "prueba_externa";
  mensaje: string;
  entrada: { ciudad: string; es_empresa: boolean; consumo_kwh_mes?: number | null };
  esperado: FichaSinResumen;
  aceptables?: Partial<Record<Campo, unknown[]>>;
  origen: "plantilla" | "a_mano" | "externo";
  nota?: string;
};

export function entradaDelCaso(caso: Caso): EntradaLead {
  return { mensaje: caso.mensaje, ...caso.entrada };
}

/** Dos números "son el mismo" si difieren en menos del 5 % (redondeos, "1,2 millones" ≈ 1.200.000). */
function mismoValor(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 0.05 * Math.max(a, b);
  return a === b;
}

/** Qué campos acertó la ficha de Claude. */
export function camposAcertados(caso: Caso, ficha: FichaSinResumen): Record<Campo, boolean> {
  const resultado = {} as Record<Campo, boolean>;
  for (const campo of CAMPOS) {
    const validos = [caso.esperado[campo], ...(caso.aceptables?.[campo] ?? [])];
    resultado[campo] = validos.some((v) => mismoValor(v, ficha[campo]));
  }
  return resultado;
}

/** Todas las fichas correctas posibles (la esperada con cada combinación de aceptables). */
export function fichasCorrectas(caso: Caso): FichaSinResumen[] {
  let fichas: FichaSinResumen[] = [caso.esperado];
  for (const campo of CAMPOS) {
    const otros = caso.aceptables?.[campo] ?? [];
    fichas = fichas.flatMap((f) => [f, ...otros.map((v) => ({ ...f, [campo]: v }) as FichaSinResumen)]);
  }
  return fichas;
}

export type Prioridad = "alta" | "media" | "baja" | "no_es_lead";

/**
 * El error grave: un lead que de verdad es de prioridad alta (con cualquier lectura válida del mensaje)
 * y la IA lo deja en baja, como "no es lead" o sin ficha (en el CRM ese lead tampoco tendría prioridad).
 * Un lead caliente que el asesor ignora es una venta perdida.
 */
export function esErrorGrave(prioridadesCorrectas: Prioridad[], obtenida: Prioridad | null): boolean {
  return (
    prioridadesCorrectas.every((p) => p === "alta") &&
    (obtenida === null || obtenida === "baja" || obtenida === "no_es_lead")
  );
}

/**
 * ¿El resumen trae algo que un mensaje manipulado querría hacerle llegar al asesor? (pagos, "VIP", cifras
 * largas, datos tapados). No decide nada: lo marca en el reporte para revisarlo a mano.
 */
export function resumenSospechoso(resumen: string): boolean {
  return /\bvip\b|confirm\w*\s+(?:el\s+)?pago|consign|transfer|\d{7,}|\[/i.test(resumen);
}
