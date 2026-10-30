import { describe, expect, it } from "vitest";

import { horaDeBogota, hoyEnBogota, rangoEnBogota } from "./fechas";

describe("hoy en Bogotá", () => {
  it("cerca de la medianoche, Bogotá todavía está en el día anterior a UTC", () => {
    // 2026-10-30 a las 03:00 UTC son las 10 p. m. del 29 en Bogotá
    expect(hoyEnBogota(new Date("2026-10-30T03:00:00Z"))).toBe("2026-10-29");
    expect(hoyEnBogota(new Date("2026-10-30T05:00:00Z"))).toBe("2026-10-30");
  });

  it("muestra la hora guardada en hora de Bogotá", () => {
    expect(horaDeBogota("2026-10-30T14:00:00+00:00")).toBe("2026-10-30 09:00");
  });
});

describe("rangoEnBogota", () => {
  const ahora = new Date("2026-10-30T03:00:00Z"); // 29 de octubre en Bogotá

  it("por omisión va de hoy a 7 días, con el último día incluido", () => {
    expect(rangoEnBogota(undefined, undefined, ahora)).toEqual({
      ok: true,
      desde: "2026-10-29",
      hasta: "2026-11-05",
      inicio: "2026-10-29T00:00:00-05:00",
      finExclusivo: "2026-11-06T00:00:00-05:00",
    });
  });

  it("acepta un solo día", () => {
    const rango = rangoEnBogota("2026-11-05", "2026-11-05", ahora);
    expect(rango).toMatchObject({ ok: true, inicio: "2026-11-05T00:00:00-05:00", finExclusivo: "2026-11-06T00:00:00-05:00" });
  });

  it("rechaza fechas mal escritas, inexistentes o al revés", () => {
    expect(rangoEnBogota("30/10/2026", undefined, ahora).ok).toBe(false);
    expect(rangoEnBogota("2026-02-30", undefined, ahora).ok).toBe(false);
    expect(rangoEnBogota("2026-11-10", "2026-11-01", ahora)).toEqual({
      ok: false,
      error: "La fecha final es anterior a la inicial.",
    });
  });

  it("si solo viene una fecha final pasada, explica que sin inicial se empieza hoy", () => {
    const rango = rangoEnBogota(undefined, "2026-10-20", ahora);
    expect(rango).toMatchObject({ ok: false });
    expect(!rango.ok && rango.error).toContain("se empieza hoy (2026-10-29)");
  });

  it("no deja pedir más de 31 días", () => {
    expect(rangoEnBogota("2026-10-01", "2026-10-31", ahora).ok).toBe(true);
    expect(rangoEnBogota("2026-10-01", "2026-11-01", ahora)).toMatchObject({ ok: false });
  });
});
