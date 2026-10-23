import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizarTelefono } from "../telefono";
import { buscarEnCrm } from "./analizar";
import { agrupar, comparar, type FilaComparable } from "./duplicados";
import { normalizarCiudad, normalizarConsumo, normalizarCorreo, normalizarTipo, separarNombre } from "./limpieza";

// Los mismos casos que resuelve la versión en Python (tests/test_migracion.py)
const CASOS = JSON.parse(
  readFileSync(new URL("../../../../../tests/casos_compartidos/limpieza.json", import.meta.url), "utf-8"),
);

function fila(n: number, campos: Partial<FilaComparable>): FilaComparable {
  return { fila: n, nombre: null, empresa: null, telefono: null, correo: null, ciudad: null, ...campos };
}

describe("casos compartidos con Python", () => {
  const reglas: [string, (valor: string | null) => unknown][] = [
    ["telefono", normalizarTelefono],
    ["correo", normalizarCorreo],
    ["ciudad", normalizarCiudad],
    ["tipo", normalizarTipo],
    ["consumo", normalizarConsumo],
    ["separar_nombre", separarNombre],
  ];
  for (const [regla, funcion] of reglas) {
    it(`resuelve igual cada caso de ${regla}`, () => {
      for (const [entrada, esperado] of CASOS[regla]) {
        expect(funcion(entrada), String(entrada)).toEqual(esperado);
      }
    });
  }

  it("compara cada pareja igual", () => {
    for (const caso of CASOS.comparar) {
      expect(comparar(fila(1, caso.a), fila(2, caso.b))?.nivel ?? null, caso.caso).toBe(caso.nivel);
    }
  });

  it("concilia con el CRM igual", () => {
    for (const caso of CASOS.conciliar) {
      const crm = caso.crm.map((c: Partial<FilaComparable> & { codigo: string }) => ({ ...fila(0, c), codigo: c.codigo }));
      const resultado = buscarEnCrm(fila(1, caso.persona), crm);
      const obtenido = resultado === null ? "nueva" : "codigo" in resultado ? `existe:${resultado.codigo}` : "revision";
      expect(obtenido, caso.caso).toBe(caso.resultado);
    }
  });

  it("agrupa igual", () => {
    for (const caso of CASOS.agrupar) {
      const { grupos } = agrupar(caso.filas.map((campos: Partial<FilaComparable>, n: number) => fila(n, campos)));
      const ordenados = grupos.map((g) => [...g].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
      expect(ordenados, caso.caso).toEqual(caso.grupos);
    }
  });
});
