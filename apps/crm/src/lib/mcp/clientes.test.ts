import { describe, expect, it } from "vitest";

import { listaDeClientes, type FilaCliente } from "./clientes";

const fila = (cambios: Partial<FilaCliente> = {}): FilaCliente => ({
  codigo: "C0153",
  tipo: "negocio",
  nombre: "Paola Torres",
  empresa: "Panadería Gómez",
  ciudad: "Cali",
  asesor: { nombre: "Camilo Torres" },
  ...cambios,
});

describe("listaDeClientes", () => {
  it("devuelve solo lo necesario para encontrar al cliente, sin correo ni teléfono", () => {
    const conDatosDeMas = { ...fila(), telefono: "+573001234567", email: "x@example.com" } as FilaCliente;
    const lista = listaDeClientes([conDatosDeMas], 1);
    expect(lista).toEqual({
      total: 1,
      mostrando: 1,
      clientes: [
        {
          codigo: "C0153",
          nombre: "Paola Torres",
          empresa: "Panadería Gómez",
          tipo: "negocio",
          ciudad: "Cali",
          asesor: "Camilo Torres",
        },
      ],
    });
    expect(JSON.stringify(lista)).not.toMatch(/573001234567|example\.com/);
  });

  it("avisa cuando hay más coincidencias de las que muestra", () => {
    const lista = listaDeClientes([fila(), fila({ codigo: "C0154" })], 37);
    expect(lista.aviso).toBe("Hay 37 coincidencias; afina la búsqueda para ver las demás.");
    expect(lista.mostrando).toBe(2);
  });

  it("no inventa empresa ni asesor cuando no hay", () => {
    const [cliente] = listaDeClientes([fila({ empresa: "", asesor: null })], 1).clientes;
    expect(cliente.empresa).toBeUndefined();
    expect(cliente.asesor).toBeUndefined();
  });
});
