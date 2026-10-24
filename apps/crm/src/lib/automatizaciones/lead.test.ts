import { describe, expect, it } from "vitest";

import type { ContactoDelCrm } from "../importar/analizar";
import { decidir, leerClave, llaveValida, prepararLead, tratarErrorDeBase, type LeadPreparado } from "./lead";

const LLAVE = "una-llave-de-prueba-bastante-larga-123456";

const entrada = (campos: Record<string, unknown> = {}) => ({
  clave: "envio-web-0001",
  canal: "web",
  nombre: "PAOLA  torres",
  celular: "300 123 4567",
  ciudad: "medellin",
  correo: "Paola@Example.com",
  consumo: "300",
  mensaje: "  Quiero paneles para mi casa  ",
  ...campos,
});

function preparado(campos: Record<string, unknown> = {}): LeadPreparado {
  const r = prepararLead(entrada(campos));
  if ("error" in r) throw new Error(r.error);
  return r.lead;
}

describe("llaveValida", () => {
  it("acepta solo la llave correcta, con el formato Bearer", () => {
    expect(llaveValida(`Bearer ${LLAVE}`, LLAVE)).toBe(true);
    expect(llaveValida(`Bearer ${LLAVE}x`, LLAVE)).toBe(false);
    expect(llaveValida(LLAVE, LLAVE)).toBe(false); // sin "Bearer "
    expect(llaveValida(null, LLAVE)).toBe(false);
  });

  it("si el CRM no tiene llave configurada (o es corta), no deja pasar a nadie", () => {
    expect(llaveValida("Bearer ", undefined)).toBe(false);
    expect(llaveValida("Bearer ", "")).toBe(false);
    expect(llaveValida("Bearer corta", "corta")).toBe(false);
  });
});

describe("prepararLead", () => {
  it("deja los datos en el formato del CRM, con las reglas de la fase 2", () => {
    expect(preparado()).toEqual({
      clave: "envio-web-0001",
      canal: "web",
      persona: "Paola Torres",
      contacto: {
        tipo: "hogar",
        nombre: "Paola Torres",
        empresa: "",
        telefono: "+573001234567",
        email: "paola@example.com",
        ciudad: "Medellín",
        consumo_kwh_mes: 300,
      },
      mensaje: "Quiero paneles para mi casa",
    });
  });

  it("con empresa es negocio, y el nombre es el de la persona", () => {
    const lead = preparado({ nombre: "rosa gómez", empresa: "PANADERÍA LA ESPIGA" });
    // Los conectores ("la", "de") van en minúscula: la regla de nombrePropio de la fase 2
    expect(lead.contacto).toMatchObject({ tipo: "negocio", nombre: "Rosa Gómez", empresa: "Panadería la Espiga" });
  });

  it("un nombre que parece negocio se reconoce como empresa", () => {
    const lead = preparado({ nombre: "Hotel López - Milena Correa" });
    expect(lead.contacto).toMatchObject({ tipo: "negocio", nombre: "Milena Correa", empresa: "Hotel López" });
  });

  it("un nombre con guion que no se puede partir se deja entero (no se pierde el lead)", () => {
    expect(preparado({ nombre: "pedro gómez - hijo" }).contacto.nombre).toBe("Pedro Gómez - Hijo");
  });

  it("el consumo es opcional: si no se entiende, queda vacío", () => {
    expect(preparado({ consumo: "no sé" }).contacto.consumo_kwh_mes).toBeNull();
    expect(preparado({ consumo: undefined }).contacto.consumo_kwh_mes).toBeNull();
    expect(preparado({ consumo: 450 }).contacto.consumo_kwh_mes).toBe(450);
  });

  it("un consumo absurdo se descarta en vez de tumbar el lead", () => {
    // 3.000 millones no cabe en la base de datos: antes daba error y el lead se perdía
    expect(preparado({ consumo: "3000000000" }).contacto.consumo_kwh_mes).toBeNull();
    expect(preparado({ consumo: "100000" }).contacto.consumo_kwh_mes).toBe(100000); // el tope sí vale
    expect(preparado({ consumo: "100001" }).contacto.consumo_kwh_mes).toBeNull();
  });

  it("acepta telefono y email como nombres alternativos (los usará WhatsApp)", () => {
    const lead = preparado({ celular: undefined, telefono: "+57 310 555 1234", correo: undefined, email: "" });
    expect(lead.contacto.telefono).toBe("+573105551234");
    expect(lead.contacto.email).toBe("");
  });

  it("recorta un mensaje muy largo", () => {
    expect(preparado({ mensaje: "a".repeat(5000) }).mensaje).toHaveLength(2000);
  });

  it("rechaza lo que el CRM no puede guardar, diciendo qué falta", () => {
    const error = (campos: Record<string, unknown>) => {
      const r = prepararLead(entrada(campos));
      return "error" in r ? r.error : null;
    };
    expect(error({ clave: "corta" })).toMatch(/clave/);
    expect(error({ canal: "telefono" })).toMatch(/canal/);
    expect(error({ nombre: "  " })).toMatch(/nombre/);
    expect(error({ celular: "601 234 5678" })).toMatch(/celular/); // fijo, no celular
    expect(error({ ciudad: "Barranquilla" })).toMatch(/ciudad/);
    expect(error({ correo: "paola@" })).toMatch(/correo/);
    expect(error({ nombre: "x".repeat(121) })).toMatch(/largo/);
    expect(prepararLead("no es un objeto")).toEqual({ error: "El cuerpo debe ser un objeto JSON." });
    expect(prepararLead(null)).toEqual({ error: "El cuerpo debe ser un objeto JSON." });
  });
});

describe("decidir", () => {
  const crm: ContactoDelCrm[] = [
    { fila: 0, codigo: "C0001", nombre: "Paola Torres", empresa: null, telefono: "+573001234567", correo: null, ciudad: "Medellín" },
    { fila: 0, codigo: "C0002", nombre: "Ana Ruiz", empresa: null, telefono: "+573115550000", correo: null, ciudad: "Cali" },
    // En el CRM, un negocio guarda a la persona en "nombre" y el negocio en "empresa"
    { fila: 0, codigo: "C0003", nombre: "Enrique Pulido Osorio", empresa: "Taller Martínez", telefono: "+573124440000", correo: null, ciudad: "Bogotá" },
  ];

  it("una persona que no está en el CRM es nueva", () => {
    expect(decidir(preparado({ nombre: "Luis Mora", celular: "3209998877" }), crm)).toEqual({ existente: null, duda: null });
  });

  it("mismo nombre con otro celular: duda (puede ser otra persona o un celular nuevo)", () => {
    expect(decidir(preparado({ celular: "3209998877" }), crm).duda).toMatch(/C0001/);
  });

  it("mismo celular y mismo nombre: es el cliente que ya existe", () => {
    expect(decidir(preparado(), crm)).toEqual({ existente: "C0001", duda: null });
  });

  it("un negocio que vuelve a escribir solo con el nombre del negocio es el cliente que ya existe", () => {
    const lead = preparado({ nombre: "Taller Martínez", celular: "312 444 0000", ciudad: "Bogotá" });
    expect(lead.persona).toBeNull();
    expect(decidir(lead, crm)).toEqual({ existente: "C0003", duda: null });
  });

  it("la familia que comparte celular: duda, nunca unir", () => {
    const r = decidir(preparado({ nombre: "Pedro Ruiz", celular: "311 555 0000", ciudad: "Cali" }), crm);
    expect(r.existente).toBeNull();
    expect(r.duda).toBeTruthy();
  });
});

describe("leerClave", () => {
  it("acepta una clave de 8 a 200 caracteres, sin espacios a los lados", () => {
    expect(leerClave("  web-12345678  ")).toBe("web-12345678");
    expect(leerClave("corta")).toBeNull();
    expect(leerClave("x".repeat(201))).toBeNull();
    expect(leerClave(12345678)).toBeNull(); // un número no es una clave
    expect(leerClave(undefined)).toBeNull();
  });
});

describe("tratarErrorDeBase", () => {
  it("separa datos inválidos, choques para reintentar y fallas", () => {
    expect(tratarErrorDeBase("22023")).toBe(400); // por ejemplo, sin nombre ni empresa
    expect(tratarErrorDeBase("23514")).toBe(400); // una regla de la tabla
    expect(tratarErrorDeBase("22003")).toBe(400); // un número que no cabe
    expect(tratarErrorDeBase("23505")).toBe(503); // celular repetido por dos envíos a la vez
    expect(tratarErrorDeBase("08006")).toBe(500); // se cayó la conexión
    expect(tratarErrorDeBase(undefined)).toBe(500);
  });
});
