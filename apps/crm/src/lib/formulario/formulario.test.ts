import { describe, expect, it } from "vitest";

import { CAMPO_TRAMPA, leerEnvio } from "./envio";
import { grupoDeLaIp, huellaDeIp, ipDeLaPeticion } from "./huella";

const SECRETO = "una-llave-secreta-de-prueba-bastante-larga";

describe("ipDeLaPeticion", () => {
  it("usa la IP que pone Vercel; en local, 'local'", () => {
    expect(ipDeLaPeticion(new Headers({ "x-real-ip": "190.25.1.2" }))).toBe("190.25.1.2");
    expect(ipDeLaPeticion(new Headers({ "x-forwarded-for": "190.25.1.2, 10.0.0.1" }))).toBe("190.25.1.2");
    expect(ipDeLaPeticion(new Headers())).toBe("local");
  });
});

describe("grupoDeLaIp", () => {
  it("con IPv4 deja la dirección tal cual", () => {
    expect(grupoDeLaIp("190.25.1.2")).toBe("190.25.1.2");
    expect(grupoDeLaIp("::ffff:190.25.1.2")).toBe("190.25.1.2");
  });

  it("con IPv6 agrupa por el bloque /64: un robot no puede saltarse el límite cambiando de dirección", () => {
    const a = grupoDeLaIp("2800:e2:5d80:1a2b:1111:2222:3333:4444");
    const b = grupoDeLaIp("2800:e2:5d80:1a2b:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2800:00e2:5d80:1a2b::/64");
    expect(b).toBe(a);
    expect(grupoDeLaIp("2800:e2::1")).toBe("2800:00e2:0000:0000::/64"); // con "::" abreviado
    expect(grupoDeLaIp("2800:e2:5d80:9999::1")).not.toBe(a); // otro bloque
  });
});

describe("huellaDeIp", () => {
  it("es siempre la misma para la misma conexión, distinta entre conexiones, y nunca contiene la IP", () => {
    const h = huellaDeIp("190.25.1.2", SECRETO);
    expect(h).toBe(huellaDeIp("190.25.1.2", SECRETO));
    expect(h).not.toBe(huellaDeIp("190.25.1.3", SECRETO));
    expect(h).not.toContain("190");
    expect(h).toHaveLength(64);
  });

  it("con otra llave, otra huella: sin la llave no se puede saber de qué IP salió", () => {
    expect(huellaDeIp("190.25.1.2", SECRETO)).not.toBe(huellaDeIp("190.25.1.2", `${SECRETO}-otra`));
  });

  it("sin llave (o una corta) no se calcula", () => {
    expect(() => huellaDeIp("190.25.1.2", undefined)).toThrow(/HUELLA_SECRETA/);
    expect(() => huellaDeIp("190.25.1.2", "corta")).toThrow(/HUELLA_SECRETA/);
  });
});

describe("leerEnvio", () => {
  const formulario = (campos: Record<string, string>) => (campo: string) => campos[campo] ?? "";
  const base = {
    id_envio: "3f1c2b9a-4d5e-4f60-8a7b-1c2d3e4f5a6b",
    nombre: " Paola Torres ",
    celular: "300 123 4567",
    ciudad: "Medellín",
    autorizacion: "si",
  };

  it("lee los campos, el número del envío y la autorización", () => {
    const e = leerEnvio(formulario(base));
    expect(e.trampa).toBe(false);
    expect(e.idEnvio).toBe("3f1c2b9a-4d5e-4f60-8a7b-1c2d3e4f5a6b");
    expect(e.autorizo).toBe(true);
    expect(e.campos).toMatchObject({ nombre: "Paola Torres", celular: "300 123 4567", ciudad: "Medellín", correo: "" });
  });

  it("un campo trampa lleno es un robot", () => {
    expect(leerEnvio(formulario({ ...base, [CAMPO_TRAMPA]: "https://spam.example" })).trampa).toBe(true);
  });

  it("un número de envío que no es un UUID no sirve (por ejemplo, la clave de otro envío)", () => {
    expect(leerEnvio(formulario({ ...base, id_envio: "web-1234567890" })).idEnvio).toBeNull();
    expect(leerEnvio(formulario({ ...base, id_envio: "" })).idEnvio).toBeNull();
  });

  it("sin la casilla marcada no hay autorización (se revisa en el servidor, no solo en la página)", () => {
    expect(leerEnvio(formulario({ ...base, autorizacion: "" })).autorizo).toBe(false);
    expect(leerEnvio(formulario({ ...base, autorizacion: "true" })).autorizo).toBe(false);
  });
});
