import { beforeEach, describe, expect, it, vi } from "vitest";

// La base de datos y las cabeceras se simulan: aquí se prueban las reglas del formulario, no Supabase
const { rpc, registrarLead } = vi.hoisted(() => ({ rpc: vi.fn(), registrarLead: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "190.25.1.2" }) }));
vi.mock("@/lib/supabase/servicio", () => ({ crearClienteDeServicio: () => ({ rpc }) }));
vi.mock("@/lib/automatizaciones/registrar", () => ({ registrarLead }));

import { enviarCotizacion, type EstadoCotiza } from "./acciones";

const ID = "3f1c2b9a-4d5e-4f60-8a7b-1c2d3e4f5a6b";
const inicial: EstadoCotiza = { enviado: false, error: null };
const GRACIAS: EstadoCotiza = { enviado: true, error: null };

function formulario(campos: Record<string, string> = {}): FormData {
  const datos = new FormData();
  const todos = { id_envio: ID, nombre: "Paola Torres", celular: "300 123 4567", ciudad: "Cali", autorizacion: "si", ...campos };
  for (const [k, v] of Object.entries(todos)) datos.set(k, v);
  return datos;
}

beforeEach(() => {
  process.env.HUELLA_SECRETA = "una-llave-secreta-de-prueba-bastante-larga";
  rpc.mockReset().mockResolvedValue({ data: "ok", error: null });
  registrarLead.mockReset().mockResolvedValue({ ok: true, respuesta: { resultado: "creado" } });
});

describe("enviarCotizacion", () => {
  it("un robot que llena el campo trampa recibe 'gracias' y no se guarda nada", async () => {
    expect(await enviarCotizacion(inicial, formulario({ sitio_web: "spam" }))).toEqual(GRACIAS);
    expect(rpc).not.toHaveBeenCalled();
    expect(registrarLead).not.toHaveBeenCalled();
  });

  it("sin autorización de datos o sin número de envío válido no se guarda nada", async () => {
    expect((await enviarCotizacion(inicial, formulario({ autorizacion: "" }))).error).toMatch(/autorizar/);
    expect((await enviarCotizacion(inicial, formulario({ id_envio: "web-otra-clave" }))).error).toMatch(/Recarga/);
    expect(registrarLead).not.toHaveBeenCalled();
  });

  it("si se alcanzó un tope, 'intenta más tarde' sin registrar", async () => {
    rpc.mockResolvedValue({ data: "huella", error: null });
    const r = await enviarCotizacion(inicial, formulario());
    expect(r.enviado).toBe(false);
    expect(r.error).toMatch(/Intenta de nuevo en unos minutos/);
    expect(registrarLead).not.toHaveBeenCalled();
  });

  it("sin la llave de las huellas, 'intenta más tarde' (y no se registra)", async () => {
    delete process.env.HUELLA_SECRETA;
    expect((await enviarCotizacion(inicial, formulario())).error).toMatch(/Intenta de nuevo/);
    expect(registrarLead).not.toHaveBeenCalled();
  });

  it("un dato inválido muestra el motivo y devuelve lo escrito para no tener que llenarlo otra vez", async () => {
    const r = await enviarCotizacion(inicial, formulario({ celular: "601 234 5678" }));
    expect(r.error).toMatch(/celular no es válido/);
    expect(r.valores?.nombre).toBe("Paola Torres");
    expect(registrarLead).not.toHaveBeenCalled();
  });

  it("la respuesta es la misma sea el lead nuevo, existente, en revisión o repetido (no revela nada)", async () => {
    for (const resultado of ["creado", "existente", "revision", "ya_procesado"]) {
      registrarLead.mockResolvedValue({
        ok: true,
        respuesta: { resultado, codigo: "C0001", asesor: { nombre: "Andrés Rojas", email: "x@y.z" } },
      });
      expect(await enviarCotizacion(inicial, formulario()), resultado).toEqual(GRACIAS);
    }
  });

  it("guarda la clave del formulario y la prueba de la autorización con su versión", async () => {
    await enviarCotizacion(inicial, formulario());
    const [lead, datos] = registrarLead.mock.calls[0];
    expect(lead.clave).toBe(`form:${ID}`);
    expect(datos).toMatchObject({ clave: `form:${ID}`, canal: "web", autorizacion: { version: "2026-10-ia" } });
    expect(rpc).toHaveBeenCalledWith("permitir_envio_formulario", { p_huella: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("un error de la base de datos nunca llega crudo al visitante", async () => {
    registrarLead.mockResolvedValue({ ok: false, estado: 400, mensaje: 'duplicate key value violates "contactos_telefono"' });
    const r = await enviarCotizacion(inicial, formulario());
    expect(r.error).toBe("Revisa los datos e intenta de nuevo.");

    registrarLead.mockResolvedValue({ ok: false, estado: 500, mensaje: "No se pudieron leer los contactos del CRM." });
    expect((await enviarCotizacion(inicial, formulario())).error).toMatch(/Intenta de nuevo en unos minutos/);
  });
});
