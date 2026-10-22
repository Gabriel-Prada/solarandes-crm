import { describe, expect, it } from "vitest";

import { diasDesde, nivelSeguimiento, ultimaActividad } from "./seguimiento";

const AHORA = new Date("2026-10-22T12:00:00-05:00").getTime();

describe("nivelSeguimiento (docs/requisitos.md, sección 6)", () => {
  it("está al día con menos de 3 días sin actividad", () => {
    expect(nivelSeguimiento(0)).toBe("al_dia");
    expect(nivelSeguimiento(2)).toBe("al_dia");
  });

  it("queda sin seguimiento justo a los 3 días", () => {
    expect(nivelSeguimiento(3)).toBe("sin_seguimiento");
    expect(nivelSeguimiento(6)).toBe("sin_seguimiento");
  });

  it("avisa a la gerente justo a los 7 días", () => {
    expect(nivelSeguimiento(7)).toBe("aviso_gerente");
    expect(nivelSeguimiento(30)).toBe("aviso_gerente");
  });
});

describe("ultimaActividad", () => {
  const creada = "2026-10-01T09:00:00-05:00";

  it("usa la actividad realizada más reciente, sin importar el orden", () => {
    const actividades = [
      { fecha: "2026-10-10T09:00:00-05:00", completada: true },
      { fecha: "2026-10-20T09:00:00-05:00", completada: true },
      { fecha: "2026-10-15T09:00:00-05:00", completada: true },
    ];
    expect(ultimaActividad(actividades, creada)).toBe("2026-10-20T09:00:00-05:00");
  });

  it("no cuenta las tareas pendientes (todavía no han pasado)", () => {
    const actividades = [
      { fecha: "2026-10-05T09:00:00-05:00", completada: true },
      { fecha: "2026-10-25T09:00:00-05:00", completada: false },
    ];
    expect(ultimaActividad(actividades, creada)).toBe("2026-10-05T09:00:00-05:00");
  });

  it("si no hay actividades, usa la fecha de respaldo", () => {
    expect(ultimaActividad([], creada)).toBe(creada);
  });
});

describe("diasDesde", () => {
  it("cuenta días completos", () => {
    expect(diasDesde("2026-10-19T12:00:00-05:00", AHORA)).toBe(3);
    expect(diasDesde("2026-10-19T13:00:00-05:00", AHORA)).toBe(2);
  });

  it("nunca da negativo para fechas futuras", () => {
    expect(diasDesde("2026-10-30T12:00:00-05:00", AHORA)).toBe(0);
  });
});
