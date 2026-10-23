import { describe, expect, it } from "vitest";

import { analizar, type Asesor, type ContactoDelCrm } from "./analizar";
import { leerCsv } from "./csv";

describe("leerCsv", () => {
  it("acepta coma o punto y coma (Excel en español usa ;)", () => {
    expect(leerCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(leerCsv("a;b\r\n1;2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("respeta las comillas y la marca invisible del inicio", () => {
    expect(leerCsv('﻿nombre;notas\nAna;"dice ""hola""; llamar"')).toEqual([
      ["nombre", "notas"],
      ["Ana", 'dice "hola"; llamar'],
    ]);
  });
});

const ASESORES: Asesor[] = [
  { id: "id-andres", codigo: "U02", nombre: "Andrés Rojas", email: "andres.rojas@solarandes.test", ciudad: "Bogotá" },
  { id: "id-camilo", codigo: "U04", nombre: "Camilo Torres", email: "camilo.torres@solarandes.test", ciudad: "Cali" },
];

const CRM: ContactoDelCrm[] = [
  { fila: 0, codigo: "C0001", nombre: "Paola Torres", empresa: null, telefono: "+573204989513", correo: null, ciudad: "Bogotá" },
];

const ENCABEZADO = "nombre;celular;ciudad;consumo;asesor;notas";

function analizarFilas(...lineas: string[]) {
  return analizar([ENCABEZADO, ...lineas].join("\n"), CRM, ASESORES, "anuncios");
}

describe("analizar", () => {
  it("una fila completa queda lista para crear, con el canal elegido y el asesor de su ciudad", () => {
    const { filas } = analizarFilas("ana ruiz;300 123 4567;Cali;350 kWh;;");
    expect(filas[0].estado).toBe("crear");
    expect(filas[0].fila).toBe(2);
    expect(filas[0].contacto).toMatchObject({
      nombre: "Ana Ruiz", telefono: "+573001234567", ciudad: "Cali", consumo: 350, tipo: "hogar", canal: "anuncios",
      asesorId: "id-camilo",
    }); // prettier-ignore
  });

  it("dice qué falta y qué no se entendió", () => {
    const { filas } = analizarFilas("Ana Ruiz;318933597;Pasto;;;");
    expect(filas[0].estado).toBe("error");
    expect(filas[0].detalle).toContain('el celular ilegible: "318933597"');
    expect(filas[0].detalle).toContain('la ciudad ilegible: "Pasto"');
    expect(filas[0].detalle).toContain("falta el consumo en kWh");
    expect(filas[0].detalle).not.toContain("asesor"); // sale de la ciudad, que es lo que hay que corregir
  });

  it("une las filas repetidas y completa con una lo que le falta a la otra", () => {
    const { filas } = analizar(
      ["empresa;celular;ciudad;consumo;tipo", "Hotel López;300 111 1111;Bogotá;;negocio", "HOTEL LOPEZ;3001111111;;2000;"].join("\n"),
      CRM, ASESORES, "web",
    ); // prettier-ignore
    expect(filas.map((f) => f.estado)).toEqual(["crear", "repetida"]);
    expect(filas[0].contacto).toMatchObject({ empresa: "Hotel López", consumo: 2000, asesorId: "id-andres" });
  });

  it("una familia que comparte celular va a revisión, no se une", () => {
    const { filas } = analizarFilas("Ana Ruiz;3001111111;Cali;300;;", "Pedro Ruiz;3001111111;Cali;300;;");
    expect(filas.map((f) => f.estado)).toEqual(["revisar", "revisar"]);
  });

  it("un cliente que ya está en el CRM no se importa otra vez", () => {
    const { filas } = analizarFilas("PAOLA TORRES;3204989513;Bogotá;604;;");
    expect(filas[0].estado).toBe("existe");
    expect(filas[0].detalle).toContain("C0001");
  });

  it("reconoce al asesor por su nombre y no adivina uno que no existe", () => {
    const { filas } = analizarFilas("Ana Ruiz;3001234567;Cali;300;Andrés;", "Luis Mora;3007654321;Cali;300;Pedro;");
    expect(filas[0].contacto.asesorId).toBe("id-andres");
    expect(filas[1].estado).toBe("error");
    expect(filas[1].detalle).toContain('el asesor ilegible: "Pedro"');
  });

  it("salta las filas vacías y avisa si faltan las columnas básicas", () => {
    expect(analizarFilas("", "Ana Ruiz;3001234567;Cali;300;;").filas).toHaveLength(1);
    expect(analizar("nombre;ciudad\nAna;Cali", CRM, ASESORES, "web").error).toContain("nombre y celular");
  });
});

describe("lo que encontró la revisión de código", () => {
  it("una comilla en medio del texto no se come las filas siguientes", () => {
    expect(leerCsv('nombre;notas\nAna;TV de 50"\nLuis;x\nPedro;y')).toHaveLength(4);
  });

  it("rechaza un consumo con un cero de más", () => {
    const { filas } = analizarFilas("Ana Ruiz;3001234567;Cali;350000;;");
    expect(filas[0].estado).toBe("error");
    expect(filas[0].detalle).toContain("demasiado alto");
  });

  it("no acepta un hogar con empresa ni un negocio sin empresa", () => {
    const { filas } = analizar(
      ["nombre;empresa;celular;ciudad;consumo;tipo", "Ana Ruiz;Panadería Ruiz;3001234567;Cali;300;hogar", "Luis Mora;;3007654321;Cali;300;negocio"].join("\n"),
      CRM, ASESORES, "web",
    ); // prettier-ignore
    expect(filas.map((f) => f.estado)).toEqual(["error", "error"]);
  });

  it("los valores por defecto no hacen chocar a una fila con su repetida", () => {
    const { filas } = analizar(
      ["nombre;empresa;celular;ciudad;consumo;tipo;canal", "Milena Correa;Hotel López;3001234567;Bogotá;2000;negocio;referido", "Milena Correa;;3001234567;;;;"].join("\n"),
      CRM, ASESORES, "anuncios",
    ); // prettier-ignore
    expect(filas.map((f) => f.estado)).toEqual(["crear", "repetida"]);
    expect(filas[0].contacto).toMatchObject({ tipo: "negocio", canal: "referido" });
  });

  it("si una fila repetida está en duda, se retiene a toda la persona y se usa el nombre más completo", () => {
    const { filas } = analizar(
      ["nombre;celular;ciudad;consumo", "Luis Mora;3003333333;Cali;300", "Luis Alberto Mora;3003333333;Cali;300", "Luis Alberto Mora;3004444444;Cali;300"].join("\n"),
      CRM, ASESORES, "web",
    ); // prettier-ignore
    expect(filas.map((f) => f.estado)).toEqual(["revisar", "repetida", "revisar"]);
    expect(filas[0].contacto.nombre).toBe("Luis Alberto Mora");
    expect(filas[2].detalle).toContain("fila 2"); // apunta a la primera fila del grupo, no a la repetida
  });

  it("un celular que ya es de otra persona del CRM va a revisión", () => {
    const { filas } = analizar("nombre;celular;correo;ciudad;consumo\nAna Ruiz;3204989513;ana@example.com;Cali;300", CRM, ASESORES, "web");
    expect(filas[0].estado).toBe("revisar");
    expect(filas[0].detalle).toContain("ya es de C0001");
  });

  it("un canal con un nombre interno de JavaScript no se acepta", () => {
    const { filas } = analizar("nombre;celular;ciudad;consumo;canal\nAna Ruiz;3001234567;Cali;300;constructor", CRM, ASESORES, "web");
    expect(filas[0].estado).toBe("error");
    expect(filas[0].detalle).toContain('el canal ilegible: "constructor"');
  });
});
