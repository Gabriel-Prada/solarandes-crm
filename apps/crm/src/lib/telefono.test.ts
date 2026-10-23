import { describe, expect, it } from "vitest";

import { normalizarTelefono } from "./telefono";

describe("normalizarTelefono", () => {
  it("acepta los formatos más comunes", () => {
    for (const texto of ["3001234567", "300 123 4567", "(300) 123-4567", "+57 300 123 4567", "57 3001234567"]) {
      expect(normalizarTelefono(texto), texto).toBe("+573001234567");
    }
  });

  it("rechaza teléfonos incompletos o que no son celulares", () => {
    expect(normalizarTelefono("300123456")).toBeNull(); // le falta un dígito
    expect(normalizarTelefono("6012345678")).toBeNull(); // fijo de Bogotá
    expect(normalizarTelefono("")).toBeNull();
    expect(normalizarTelefono("llamar en la tarde")).toBeNull();
  });
});
