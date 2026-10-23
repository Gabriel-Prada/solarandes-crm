import { describe, expect, it } from "vitest";

import { aplicarDescuento, cotizar, PRECIO_KWP_GRANDE, PRECIO_KWP_PEQUENO } from "./cotizacion";

// Los mismos casos de tests/test_reglas.py (la versión en Python de la fórmula)
describe("cotizar", () => {
  it("cumple el ejemplo de los requisitos: hogar en Bogotá con 300 kWh/mes", () => {
    const c = cotizar(300, "Bogotá");
    expect(c.potenciaNecesariaKwp).toBe(3.13);
    expect(c.numPaneles).toBe(6);
    expect(c.potenciaInstaladaKwp).toBe(3.3);
    expect(c.valorTotal).toBe(14_850_000);
  });

  it("con más sol hacen falta menos paneles", () => {
    expect(cotizar(500, "Cali").numPaneles).toBeLessThan(cotizar(500, "Bogotá").numPaneles);
  });

  it("los sistemas grandes tienen menor precio por kWp", () => {
    expect(cotizar(300, "Bogotá").precioKwp).toBe(PRECIO_KWP_PEQUENO);
    expect(cotizar(3000, "Bogotá").precioKwp).toBe(PRECIO_KWP_GRANDE);
  });

  it("justo en el límite de 10 kWp se cobra el precio pequeño", () => {
    expect(cotizar(950, "Bogotá").numPaneles).toBe(18); // 9,9 kWp
    expect(cotizar(950, "Bogotá").precioKwp).toBe(PRECIO_KWP_PEQUENO);
    expect(cotizar(1000, "Bogotá").numPaneles).toBe(19); // 10,45 kWp
    expect(cotizar(1000, "Bogotá").precioKwp).toBe(PRECIO_KWP_GRANDE);
  });

  it("rechaza consumos que no tienen sentido", () => {
    expect(() => cotizar(0, "Bogotá")).toThrow();
    expect(() => cotizar(-10, "Bogotá")).toThrow();
    expect(() => cotizar(Number.NaN, "Bogotá")).toThrow();
  });

  it("aplica el descuento y redondea a miles de pesos", () => {
    // Es la cotización ajustada de Lucila Lozano en los datos: 12.375.000 con 5 % = 11.756.000
    const c = cotizar(227, "Bogotá", 5);
    expect(c.valorSinDescuento).toBe(12_375_000);
    expect(c.valorTotal).toBe(11_756_000);
  });

  // Los mismos casos de test_aplicar_descuento en tests/test_reglas.py
  it.each([
    [4_950_000, 5, 4_703_000], // 4.702.500: la mitad sube
    [12_375_000, 5, 11_756_000],
    [56_430_000, 8, 51_916_000],
    [14_850_000, 0, 14_850_000],
    [14_850_000, 2.5, 14_479_000],
    [14_850_000, 30, 10_395_000],
  ])("aplica a %i un descuento de %d %% → %i, igual que en Python", (valor, descuento, esperado) => {
    expect(aplicarDescuento(valor, descuento)).toBe(esperado);
  });

  it("no acepta descuentos negativos ni mayores a 30 %", () => {
    expect(() => cotizar(300, "Bogotá", -1)).toThrow();
    expect(() => cotizar(300, "Bogotá", 31)).toThrow();
  });
});
