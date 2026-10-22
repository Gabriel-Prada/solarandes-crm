import { describe, expect, it } from "vitest";

import { normalizarBusqueda, patronContiene } from "./busqueda";

describe("normalizarBusqueda", () => {
  it("quita tildes y mayúsculas", () => {
    expect(normalizarBusqueda("PANADERÍA Gómez")).toBe("panaderia gomez");
  });

  it("junta los espacios repetidos", () => {
    expect(normalizarBusqueda("  hotel    niño ")).toBe("hotel nino");
  });

  it("deja solo los dígitos cuando se busca un teléfono", () => {
    expect(normalizarBusqueda("310 157 3916")).toBe("3101573916");
    expect(normalizarBusqueda("(310) 157-3916")).toBe("3101573916");
    expect(normalizarBusqueda("+57 310 157 3916")).toBe("573101573916");
  });

  it("no trata como teléfono un texto con letras y números", () => {
    expect(normalizarBusqueda("C0522")).toBe("c0522");
  });

  it("corta textos muy largos", () => {
    expect(normalizarBusqueda("a".repeat(100))).toHaveLength(60);
  });
});

describe("patronContiene", () => {
  it("envuelve el texto para buscarlo en cualquier parte", () => {
    expect(patronContiene("hotel")).toBe("%hotel%");
  });

  it("escapa los comodines para que % y _ se busquen como texto", () => {
    expect(patronContiene("50%_off")).toBe("%50\\%\\_off%");
  });
});
