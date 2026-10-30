/**
 * Los números del panel de la gerente que no calcula la base. Los usan la página del panel y el MCP
 * (fase 5), así el redondeo es el mismo: si Claude y el panel dijeran cosas distintas, la gerente
 * dejaría de confiar en los dos.
 */
import type { CanalOrigen, Etapa, MotivoPerdida } from "@/lib/tipos";

// Lo que devuelve la función panel_gerente() de la base de datos (migraciones 003, 004 y 016)
export type Panel = {
  kpis: {
    ganadas_30: number;
    valor_30: number;
    valor_30_previo: number;
    ganadas_90: number;
    cerradas_90: number;
    abiertas: number;
    pipeline: number;
    pipeline_ponderado: number;
    sin_seguimiento: number;
  };
  por_mes: { mes: string; ventas: number; valor: number }[];
  embudo: { etapa: Etapa; ventas: number }[];
  perdidas_por_etapa: { etapa: Etapa; ventas: number }[];
  motivos: { motivo: MotivoPerdida; ventas: number }[];
  canales: { canal: CanalOrigen; leads: number; ganadas: number; cerradas: number; valor: number }[];
  asesores: {
    nombre: string;
    ciudad: string;
    abiertas: number;
    ganadas: number;
    cerradas: number;
    valor: number;
    sin_seguimiento: number;
  }[];
};

/** Porcentaje entero; 0 si no hay base para calcularlo. */
export const porcentaje = (parte: number, total: number) => (total ? Math.round((parte / total) * 100) : 0);

/** Cuánto cambió (en %) contra el periodo anterior; null si el anterior fue 0. */
export const variacion = (actual: number, previo: number) =>
  previo ? Math.round(((actual - previo) / previo) * 100) : null;

/** Cuántas ventas entraron al embudo (las de la etapa "nuevo", que la base ya cuenta acumuladas). */
export const entraronAlEmbudo = (panel: Pick<Panel, "embudo">) =>
  panel.embudo.find((e) => e.etapa === "nuevo")?.ventas ?? 0;
