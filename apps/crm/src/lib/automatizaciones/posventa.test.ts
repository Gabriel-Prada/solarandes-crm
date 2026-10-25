import { describe, expect, it } from "vitest";

import { armarRecordatorio, type AvisoDeLaBase } from "./posventa";

const aviso: AvisoDeLaBase = {
  id: "a-1",
  meses: 6,
  para: "paola@ejemplo.test",
  cliente: "Paola Torres",
  empresa: null,
  responsable: "Andrés Rojas",
};

describe("armarRecordatorio", () => {
  it("saluda por el nombre, dice qué toca y quién llamará, sin precios", () => {
    const correo = armarRecordatorio(aviso);
    expect(correo).toMatchObject({ id: "a-1", para: "paola@ejemplo.test", quien: "Paola Torres" });
    expect(correo.texto).toContain("Hola, Paola:");
    expect(correo.texto).toContain("Ya pasaron 6 meses desde la instalación de tu sistema solar.");
    expect(correo.texto).toContain("Andrés Rojas te contactará");
    expect(correo.texto).not.toMatch(/\$|precio|gratis/i);
  });

  it("los años se dicen en años", () => {
    expect(armarRecordatorio({ ...aviso, meses: 12 }).texto).toContain("Ya pasaron un año");
    expect(armarRecordatorio({ ...aviso, meses: 24 }).texto).toContain("Ya pasaron 2 años");
    expect(armarRecordatorio({ ...aviso, meses: 18 }).texto).toContain("Ya pasaron 18 meses");
  });

  it("un negocio sin nombre de persona no se saluda por el nombre del negocio", () => {
    const correo = armarRecordatorio({ ...aviso, cliente: "Ferretería El Tornillo", empresa: "Ferretería El Tornillo" });
    expect(correo.texto).toMatch(/^Hola:/);
    expect(correo.texto).toContain("el sistema solar de Ferretería El Tornillo");
  });
});
