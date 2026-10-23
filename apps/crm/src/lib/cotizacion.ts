// Fórmula de cotización de SolarAndes (docs/requisitos.md, sección 4).
// Es la misma de scripts/datos/reglas.py: las pruebas de ambos usan los mismos ejemplos,
// así que si una cambia y la otra no, alguna prueba falla.

import type { Ciudad } from "@/lib/tipos";

// Horas sol pico promedio al día en cada ciudad
export const HSP: Record<Ciudad, number> = { Bogotá: 4.0, Medellín: 4.5, Cali: 4.8 };

const EFICIENCIA = 0.8; // pérdidas por calor, cables e inversor
export const POTENCIA_PANEL_W = 550;
const LIMITE_SISTEMA_PEQUENO_W = 10_000;
export const PRECIO_KWP_PEQUENO = 4_500_000; // COP por kWp, hasta 10 kWp
export const PRECIO_KWP_GRANDE = 3_800_000; // COP por kWp, más de 10 kWp

export type Cotizacion = {
  potenciaNecesariaKwp: number;
  numPaneles: number;
  potenciaInstaladaKwp: number;
  precioKwp: number;
  valorSinDescuento: number;
  descuentoPct: number;
  valorTotal: number;
};

export function cotizar(consumoKwhMes: number, ciudad: Ciudad, descuentoPct = 0): Cotizacion {
  if (!(consumoKwhMes > 0)) throw new Error("El consumo debe ser mayor que cero");
  if (!(ciudad in HSP)) throw new Error(`Ciudad no atendida: ${ciudad}`);
  if (!(descuentoPct >= 0 && descuentoPct <= 30)) throw new Error("El descuento debe estar entre 0 % y 30 %");

  const necesariaKwp = consumoKwhMes / (HSP[ciudad] * 30 * EFICIENCIA);
  // Se redondea a 6 decimales antes de subir: evita que un error de punto flotante sume un panel de más
  const numPaneles = Math.ceil(Number(((necesariaKwp * 1000) / POTENCIA_PANEL_W).toFixed(6)));
  const instaladaW = numPaneles * POTENCIA_PANEL_W;
  const precioKwp = instaladaW <= LIMITE_SISTEMA_PEQUENO_W ? PRECIO_KWP_PEQUENO : PRECIO_KWP_GRANDE;
  const valorSinDescuento = (instaladaW * precioKwp) / 1000; // siempre entero: 550 W × precio es múltiplo de 1000

  return {
    potenciaNecesariaKwp: Math.round(necesariaKwp * 100 + Number.EPSILON) / 100,
    numPaneles,
    potenciaInstaladaKwp: instaladaW / 1000,
    precioKwp,
    valorSinDescuento,
    descuentoPct,
    valorTotal: aplicarDescuento(valorSinDescuento, descuentoPct),
  };
}

/**
 * Precio con descuento, redondeado a miles de pesos; la mitad sube (4.702.500 → 4.703.000).
 * Solo con enteros (miles de pesos y décimas de porcentaje): así coincide exactamente con
 * aplicar_descuento() de reglas.py y con la función crear_cotizacion() de la base de datos.
 */
export function aplicarDescuento(valorSinDescuento: number, descuentoPct: number): number {
  const decimas = Math.round(descuentoPct * 10); // el descuento se guarda con un decimal
  const miles = valorSinDescuento / 1000; // siempre entero (ver valorSinDescuento)
  return Math.floor((miles * (1000 - decimas) + 500) / 1000) * 1000;
}
