import { limpiarResumen } from "../privacidad";

/**
 * La ficha que llena Claude al leer el mensaje de un lead. Solo hechos: la prioridad la calcula la base
 * de datos con estos hechos (prioridad_regla, migración 020). Los valores son los mismos que acepta la
 * base (ficha_valida).
 */
export type Ficha = {
  es_lead: boolean;
  tipo_cliente: "hogar" | "negocio" | "no_se_sabe";
  urgencia: "alta" | "media" | "baja" | "no_se_sabe";
  intencion: "quiere_sistema" | "solo_informacion" | "otra";
  consumo_kwh_mes: number | null;
  factura_luz_cop: number | null;
  resumen: string;
};

const TIPOS = ["hogar", "negocio", "no_se_sabe"] as const;
const URGENCIAS = ["alta", "media", "baja", "no_se_sabe"] as const;
const INTENCIONES = ["quiere_sistema", "solo_informacion", "otra"] as const;

const numeroOVacio = { anyOf: [{ type: "integer" }, { type: "null" }] };

/** La forma exacta que la API le exige a la respuesta (salida estructurada). */
export const ESQUEMA_FICHA = {
  type: "object",
  additionalProperties: false,
  required: ["es_lead", "tipo_cliente", "urgencia", "intencion", "consumo_kwh_mes", "factura_luz_cop", "resumen"],
  properties: {
    es_lead: { type: "boolean" },
    tipo_cliente: { type: "string", enum: [...TIPOS] },
    urgencia: { type: "string", enum: [...URGENCIAS] },
    intencion: { type: "string", enum: [...INTENCIONES] },
    consumo_kwh_mes: numeroOVacio,
    factura_luz_cop: numeroOVacio,
    resumen: { type: "string" },
  },
};

function uno<T extends string>(valor: unknown, opciones: readonly T[]): T | undefined {
  return opciones.find((o) => o === valor);
}

/** Un número positivo y razonable, entero; cualquier otra cosa no dice nada (null). */
function numero(valor: unknown, maximo: number): number | null | undefined {
  if (valor === null) return null;
  if (typeof valor !== "number" || !Number.isFinite(valor)) return undefined;
  return valor > 0 && valor <= maximo ? Math.round(valor) : null;
}

/**
 * Revisa la respuesta (la API ya la garantiza; esto es el cinturón) y limpia el resumen. Devuelve null
 * si no tiene la forma de la ficha.
 */
export function leerFicha(valor: unknown): Ficha | null {
  if (typeof valor !== "object" || valor === null) return null;
  const v = valor as Record<string, unknown>;
  const tipo = uno(v.tipo_cliente, TIPOS);
  const urgencia = uno(v.urgencia, URGENCIAS);
  const intencion = uno(v.intencion, INTENCIONES);
  const consumo = numero(v.consumo_kwh_mes, 100_000);
  const factura = numero(v.factura_luz_cop, 100_000_000);
  if (typeof v.es_lead !== "boolean" || !tipo || !urgencia || !intencion || typeof v.resumen !== "string") return null;
  if (consumo === undefined || factura === undefined) return null;
  return {
    es_lead: v.es_lead,
    tipo_cliente: tipo,
    urgencia,
    intencion,
    consumo_kwh_mes: consumo,
    factura_luz_cop: factura,
    resumen: limpiarResumen(v.resumen),
  };
}
