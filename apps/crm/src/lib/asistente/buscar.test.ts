import { describe, expect, it } from "vitest";

import { buscarConocimiento, palabras } from "./buscar";
import { CONOCIMIENTO } from "./conocimiento";

const primero = (consulta: string) => buscarConocimiento(consulta)[0]?.id;

describe("buscarConocimiento", () => {
  it.each([
    ["¿Qué garantía tienen los paneles?", "garantias"],
    ["cuanto se demoran en instalar", "tiempos"],
    ["¿Funciona cuando llueve?", "nublado"],
    ["¿Se puede pagar a cuotas?", "pagos"],
    ["vivo en un conjunto, ¿qué necesito?", "apartamentos"],
    ["¿Qué pasa si se va la luz?", "apagones"],
    ["¿Instalan en Barranquilla?", "ciudades"],
    ["¿Ustedes hacen los trámites con Enel?", "tramites"],
    ["¿Cuánto me ahorro en la factura?", "ahorro"],
    ["¿Necesito baterías?", "baterias"],
    ["¿A qué hora atienden?", "horario"],
    ["¿Cada cuánto hay que limpiar los paneles?", "mantenimiento"],
  ])("%s → %s", (consulta, esperado) => {
    expect(primero(consulta)).toBe(esperado);
  });

  it("no inventa coincidencias para lo que no está", () => {
    // Lo que no tiene nada que ver no encuentra nada; lo que se parece de lejos lo descarta el asistente
    expect(buscarConocimiento("receta de arepas")).toEqual([]);
    expect(buscarConocimiento("¿Quién ganó el partido?")).toEqual([]);
    expect(buscarConocimiento("hola")).toEqual([]);
    expect(buscarConocimiento("")).toEqual([]);
  });

  it("devuelve máximo 5 fragmentos aunque pidan más", () => {
    expect(buscarConocimiento("precio garantia techo tramite pago bateria mantenimiento", 50).length).toBeLessThanOrEqual(5);
  });

  it("no le importan tildes ni mayúsculas", () => {
    expect(palabras("GARANTÍAS")).toEqual(palabras("garantias"));
  });

  it("cada fragmento tiene un id único y texto corto", () => {
    const ids = CONOCIMIENTO.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of CONOCIMIENTO) expect(f.texto.length).toBeLessThan(800);
  });
});
