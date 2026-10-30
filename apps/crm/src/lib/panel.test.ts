import { describe, expect, it } from "vitest";

import { entraronAlEmbudo, porcentaje, variacion } from "./panel";

describe("los números del panel", () => {
  it("redondea el porcentaje y no divide por cero", () => {
    expect(porcentaje(34, 216)).toBe(16);
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(5, 0)).toBe(0);
  });

  it("calcula la variación contra el periodo anterior", () => {
    expect(variacion(143_130_000, 312_413_000)).toBe(-54);
    expect(variacion(150, 100)).toBe(50);
    expect(variacion(100, 0)).toBeNull();
  });

  it("cuenta las que entraron al embudo por la etapa nuevo", () => {
    expect(entraronAlEmbudo({ embudo: [{ etapa: "nuevo", ventas: 1011 }, { etapa: "contactado", ventas: 828 }] })).toBe(
      1011,
    );
    expect(entraronAlEmbudo({ embudo: [] })).toBe(0);
  });
});
