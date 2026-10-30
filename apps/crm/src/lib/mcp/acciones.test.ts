import { describe, expect, it } from "vitest";

import {
  avisoDeHorario,
  elegirVentaDelCliente,
  enPalabras,
  esResultado,
  leerFechaHora,
  NO_SE_SI_QUEDO,
  revisarActividad,
  revisarMovimiento,
  ventaDeEseCliente,
} from "./acciones";

describe("leerFechaHora", () => {
  it("lee la hora de Bogotá y la deja con su -05:00", () => {
    expect(leerFechaHora("2026-11-05 09:00")).toEqual({ ok: true, iso: "2026-11-05T09:00:00-05:00" });
    expect(leerFechaHora(" 2026-11-05T14:30 ")).toEqual({ ok: true, iso: "2026-11-05T14:30:00-05:00" });
  });

  it("rechaza fechas y horas que no existen o mal escritas", () => {
    expect(leerFechaHora("2026-02-30 09:00").ok).toBe(false);
    expect(leerFechaHora("2026-11-05 25:00").ok).toBe(false);
    expect(leerFechaHora("05/11/2026 9:00").ok).toBe(false);
    expect(leerFechaHora("el jueves").ok).toBe(false);
  });
});

describe("enPalabras", () => {
  it("dice el día de la semana y la hora en Bogotá", () => {
    expect(enPalabras("2026-11-05T09:00:00-05:00")).toBe("jueves 5 de noviembre de 2026, 9:00 a. m.");
    expect(enPalabras("2026-11-05T14:30:00-05:00")).toBe("jueves 5 de noviembre de 2026, 2:30 p. m.");
    expect(enPalabras("2026-11-06T17:00:00Z")).toBe("viernes 6 de noviembre de 2026, 12:00 p. m.");
  });

  it("cerca de la medianoche no se corre de día", () => {
    // 2026-11-06 a las 03:00 UTC son las 10 p. m. del jueves 5 en Bogotá
    expect(enPalabras("2026-11-06T03:00:00Z")).toBe("jueves 5 de noviembre de 2026, 10:00 p. m.");
  });
});

describe("avisoDeHorario", () => {
  it("avisa los domingos y fuera de horario, pero no en horario normal", () => {
    expect(avisoDeHorario("2026-11-05T09:00:00-05:00")).toBeUndefined();
    expect(avisoDeHorario("2026-11-08T10:00:00-05:00")).toBe("Ojo: es domingo.");
    expect(avisoDeHorario("2026-11-05T06:30:00-05:00")).toContain("fuera del horario");
    expect(avisoDeHorario("2026-11-05T19:00:00-05:00")).toContain("fuera del horario");
  });
});

describe("esResultado", () => {
  it("reconoce lo que devuelven las funciones de la base", () => {
    expect(esResultado({ estado: "hecho", mensaje: "Venta movida." })).toBe(true);
    expect(esResultado(null)).toBe(false);
    expect(esResultado("hecho")).toBe(false);
  });

  it("no da por hecho un estado desconocido ni uno sin mensaje", () => {
    expect(esResultado({ estado: "quizas", mensaje: "x" })).toBe(false);
    expect(esResultado({ estado: "hecho" })).toBe(false);
  });
});

describe("leerFechaHora con segundos", () => {
  it("acepta los segundos que a veces manda Claude", () => {
    expect(leerFechaHora("2026-11-05 09:00:00")).toEqual({ ok: true, iso: "2026-11-05T09:00:00-05:00" });
  });
});

describe("que nada se ignore en silencio", () => {
  it("la fecha solo va en tareas, y una tarea la necesita", () => {
    expect(revisarActividad("llamada", "2026-11-05 09:00")).toContain("solo va en las tareas");
    expect(revisarActividad("tarea", undefined)).toContain("Una tarea lleva fecha");
    expect(revisarActividad("tarea", "2026-11-05 09:00")).toBeNull();
    expect(revisarActividad("nota", undefined)).toBeNull();
  });

  it("el motivo solo va con perdido", () => {
    expect(revisarMovimiento("negociacion", "precio")).toContain("solo va cuando");
    expect(revisarMovimiento("perdido", "precio")).toBeNull();
    expect(revisarMovimiento("cotizado", undefined)).toBeNull();
  });
});

describe("elegirVentaDelCliente", () => {
  const venta = (codigo: string) => ({ codigo, nombre: `Sistema ${codigo}`, etapaNombre: "Contactado" });

  it("con una sola venta abierta, usa esa", () => {
    expect(elegirVentaDelCliente("C0771", [venta("O0773")])).toEqual({ ok: true, venta: venta("O0773") });
  });

  it("sin ventas abiertas, lo dice y no inventa una", () => {
    expect(elegirVentaDelCliente("C0771", [])).toEqual({
      ok: false,
      error: "C0771 no tiene ventas abiertas: no hay a qué agendarle la visita.",
    });
  });

  it("con varias, pregunta cuál", () => {
    const eleccion = elegirVentaDelCliente("C0771", [venta("O0773"), venta("O0990")]);
    expect(eleccion).toMatchObject({ ok: false });
    expect(!eleccion.ok && eleccion.error).toContain("tiene 2 ventas abiertas: O0773 (Sistema O0773, Contactado); O0990");
  });
});

describe("ventaDeEseCliente", () => {
  it("rechaza una venta que es de otro cliente", () => {
    expect(ventaDeEseCliente("O0154", "C0154", "C0153")).toBe(
      "La venta O0154 es del cliente C0154, no de C0153. Revisa cuál es.",
    );
    expect(ventaDeEseCliente("O0153", "C0153", "C0153")).toBeNull();
    expect(ventaDeEseCliente("O0153", "C0153", undefined)).toBeNull();
  });
});

describe("si la escritura falla", () => {
  it("no dice que no pudo leer: pide revisar antes de repetir", () => {
    expect(NO_SE_SI_QUEDO).toContain("No sé si quedó hecho");
  });
});
