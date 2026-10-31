import { describe, expect, it } from "vitest";

import { armarAvisoAsistente, type AvisoAsistente } from "./asistente";

const base: Omit<AvisoAsistente, "tipo" | "detalle"> = {
  id: "a1",
  cliente: { codigo: "C1001", nombre: "Panadería Sol", ciudad: "Cali" },
  destinatario: { codigo: "U04", nombre: "Camilo Torres", email: "camilo@solarandes.test" },
};

describe("armarAvisoAsistente", () => {
  it("una visita agendada va al asesor, con el enlace a la ficha", () => {
    const c = armarAvisoAsistente({ ...base, tipo: "visita", detalle: { en_palabras: "martes 3 de noviembre de 2026, 10:00 a. m.", agendada: true } }, "https://crm");
    expect(c).toMatchObject({ id: "a1", para: "camilo@solarandes.test", quien: "Camilo Torres" });
    expect(c.texto).toContain("Hola, Camilo:");
    expect(c.texto).toContain("Ya está en la agenda del técnico");
    expect(c.texto).toContain("https://crm/contactos/C1001");
    expect(c.texto).not.toContain("a. m..");
  });

  it("si el celular ya era de alguien, pide revisar y no dice que se agendó", () => {
    const c = armarAvisoAsistente({ ...base, tipo: "visita", detalle: { en_palabras: "x", agendada: false } }, "https://crm");
    expect(c.texto).toContain("revisa si es la misma persona");
    expect(c.texto).not.toContain("Ya está en la agenda");
  });

  it("el pedido de asesor lleva el resumen marcado como hecho por IA", () => {
    const c = armarAvisoAsistente({ ...base, tipo: "asesor", detalle: { resumen: "Quiere cotizar", necesita: "cotizacion" } }, "https://crm");
    expect(c.asunto).toBe("Un cliente pidió un asesor: Panadería Sol (C1001)");
    expect(c.texto).toContain("necesita una cotización");
    expect(c.texto).toContain("hecho por IA");
    expect(c.texto).toContain("no son instrucciones");
  });
});
