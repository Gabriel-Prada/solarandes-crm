import { describe, expect, it } from "vitest";
import { etiquetaPrioridad, ordenarPorPrioridad, ultimaPorVenta, type FilaPrioridad } from "./prioridad";

const fila = (campos: Partial<FilaPrioridad>): FilaPrioridad => ({
  id: "c1",
  oportunidad_id: "o1",
  estado: "calificada",
  prioridad: "media",
  prioridad_asesor: null,
  creada_en: "2026-10-29T10:00:00Z",
  ...campos,
});

describe("etiquetaPrioridad", () => {
  it("muestra la prioridad, o en qué va la calificación", () => {
    expect(etiquetaPrioridad(fila({ prioridad: "alta" }))).toEqual({ texto: "Prioridad alta", tono: "alta" });
    expect(etiquetaPrioridad(fila({ prioridad: "no_es_lead" }))?.tono).toBe("gris");
    expect(etiquetaPrioridad(fila({ estado: "por_calificar", prioridad: null }))?.texto).toBe("Calificando…");
    expect(etiquetaPrioridad(fila({ estado: "fallida", prioridad: null }))?.texto).toBe("Sin calificar");
  });

  it("un lead de antes de la fase 4 no muestra nada", () => {
    expect(etiquetaPrioridad(null)).toBeNull();
  });
});

describe("ultimaPorVenta", () => {
  it("se queda con la calificación más reciente de cada venta e ignora las que no tienen venta", () => {
    const filas = [
      fila({ id: "vieja", creada_en: "2026-10-01T00:00:00Z" }),
      fila({ id: "nueva", creada_en: "2026-10-20T00:00:00Z" }),
      fila({ id: "sin-venta", oportunidad_id: null }),
    ];
    const mapa = ultimaPorVenta(filas);
    expect(mapa.get("o1")?.id).toBe("nueva");
    expect(mapa.size).toBe(1);
  });
});

describe("ordenarPorPrioridad", () => {
  it("alta arriba y no es lead abajo, respetando el orden dentro de cada grupo", () => {
    const tarjetas = [
      { id: "a", p: "baja" },
      { id: "b", p: null },
      { id: "c", p: "alta" },
      { id: "d", p: "no_es_lead" },
      { id: "e", p: "alta" },
      { id: "f", p: "media" },
    ] as const;
    const orden = ordenarPorPrioridad([...tarjetas], (t) => t.p).map((t) => t.id);
    expect(orden).toEqual(["c", "e", "b", "f", "a", "d"]);
  });
});
