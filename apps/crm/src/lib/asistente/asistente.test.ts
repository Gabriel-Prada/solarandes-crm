import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { BaseAsistente } from "./base";
import { crearEjecutor } from "./herramientas";
import { armarMensajeDelVisitante, esSoloSaludo, HERRAMIENTAS, SISTEMA } from "./prompt";
import { armarResumen } from "./resumen";
import { claveDeLaCookie, cookieDeConversacion, fechaHoraBogota, huellaDeClave, nuevaClave, vieneDeLaPagina } from "./sesion";

/** El asistente nunca usa la llave de servicio (docs/plan-fase-6.md, ajustes de la revisión). */
const CARPETAS_DEL_ASISTENTE = ["src/lib/asistente", "src/app/api/asistente"];

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("el asistente no usa la llave de servicio", () => {
  const todos = CARPETAS_DEL_ASISTENTE.flatMap(archivos).filter((ruta) => !ruta.endsWith(".test.ts"));
  it("revisa archivos de verdad", () => expect(todos.length).toBeGreaterThan(5));
  it.each(todos)("%s no importa el cliente de servicio ni lee SUPABASE_SECRET_KEY", (ruta) => {
    expect(readFileSync(ruta, "utf8")).not.toMatch(/supabase\/servicio|crearClienteDeServicio|SUPABASE_SECRET_KEY|supabase-js/);
  });
});

describe("el prompt", () => {
  it("no trae fechas ni nada que cambie entre conversaciones (rompería el caché)", () => {
    expect(SISTEMA).not.toMatch(/20\d\d-\d\d-\d\d|\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
    expect(JSON.stringify(HERRAMIENTAS)).toBe(JSON.stringify(HERRAMIENTAS));
  });

  it("es lo bastante largo para el caché de Haiku 5.5 (512 tokens) y cabe en la reserva de la base (8.000)", () => {
    // Unos 3 a 4 caracteres por token en español
    const caracteres = SISTEMA.length + JSON.stringify(HERRAMIENTAS).length;
    expect(caracteres / 4).toBeGreaterThan(512);
    expect(caracteres / 2).toBeLessThan(8000);
  });

  it("ningún caso del examen aparece como ejemplo", () => {
    for (const conjunto of ["desarrollo", "prueba"]) {
      const casos = readFileSync(`../../data/evals/asistente/${conjunto}.jsonl`, "utf8").trim().split("\n");
      for (const linea of casos) {
        for (const turno of JSON.parse(linea).turnos as string[]) {
          expect(SISTEMA.toLowerCase()).not.toContain(turno.toLowerCase().slice(0, 40));
        }
      }
    }
  });

  it("todas las herramientas son estrictas y sin propiedades de más", () => {
    for (const h of HERRAMIENTAS) {
      expect(h.strict).toBe(true);
      expect((h.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
    expect(HERRAMIENTAS.map((h) => h.name).sort()).toEqual(
      ["agendar_visita", "buscar_informacion", "calcular_precio", "horarios_disponibles", "pasar_a_asesor", "pedir_datos_de_contacto"],
    );
  });

  it("el contexto del sistema dice lo que sabe la base", () => {
    const [, contexto] = armarMensajeDelVisitante("hola", { fechaHora: "x", datosDejados: true, visita: null, asesorAvisado: false });
    expect(contexto.text).toContain("ya los dejó");
  });

  it.each(["hola", "Buenas tardes!", "buen día"])("'%s' es solo un saludo", (t) => expect(esSoloSaludo(t)).toBe(true));
  it.each(["hola, cuánto cuesta", "precio", "hola quiero paneles"])("'%s' no es solo un saludo", (t) =>
    expect(esSoloSaludo(t)).toBe(false),
  );
});

describe("la sesión de la conversación", () => {
  it("la clave es aleatoria y la base solo guarda su huella", () => {
    const a = nuevaClave();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(nuevaClave());
    expect(huellaDeClave(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la cookie no la puede leer la página ni viaja a otros sitios", () => {
    const cookie = cookieDeConversacion("x".repeat(22), true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=7200");
  });

  it("lee la cookie y rechaza valores raros", () => {
    const clave = "A".repeat(22);
    expect(claveDeLaCookie(new Headers({ cookie: `otra=1; asistente_conversacion=${clave}` }))).toBe(clave);
    expect(claveDeLaCookie(new Headers({ cookie: "asistente_conversacion=';drop" }))).toBeNull();
    expect(claveDeLaCookie(new Headers())).toBeNull();
  });

  it("solo acepta pedidos de la propia página", () => {
    const url = "https://solarandes-crm.vercel.app/api/asistente/mensaje";
    const propio = new Headers({ origin: "https://solarandes-crm.vercel.app", host: "solarandes-crm.vercel.app" });
    expect(vieneDeLaPagina(propio, url)).toBe(true);
    expect(vieneDeLaPagina(new Headers({ origin: "https://otro.com", host: "solarandes-crm.vercel.app" }), url)).toBe(false);
    expect(vieneDeLaPagina(new Headers({ host: "solarandes-crm.vercel.app" }), url)).toBe(false);
  });

  it("la fecha va en hora de Bogotá aunque el servidor esté en UTC", () => {
    // 1 de noviembre a las 02:30 UTC es todavía el 31 de octubre en Bogotá
    expect(fechaHoraBogota(new Date("2026-11-01T02:30:00Z"))).toBe("sábado 31 de octubre de 2026, 9:30 p. m.");
  });
});

describe("las herramientas", () => {
  const base = {
    calcularPrecio: vi.fn(async () => ({ estado: "ok" })),
    horarios: vi.fn(async () => ({ estado: "ok" })),
    agendarVisita: vi.fn(async () => ({ estado: "hecho" })),
  } as unknown as BaseAsistente;
  const ejecutar = crearEjecutor({ base, claude: {} as never });
  const contexto = { fechaHora: "x", datosDejados: false, visita: null, asesorAvisado: false };
  const turno = { turnoId: "t", pedido: "p", textosDelVisitante: [], contexto };

  it("buscar_informacion devuelve fragmentos o dice que no hay", async () => {
    const r = JSON.parse((await ejecutar("buscar_informacion", { consulta: "garantía del inversor" }, turno)).contenido);
    expect(r.fragmentos[0].id).toBe("garantias");
    const nada = JSON.parse((await ejecutar("buscar_informacion", { consulta: "receta de arepas" }, turno)).contenido);
    expect(nada.estado).toBe("sin_resultados");
  });

  it("calcular_precio usa el consumo y, solo si no hay, lo que paga", async () => {
    await ejecutar("calcular_precio", { ciudad: "Cali", consumo_kwh_mes: 300, pago_mensual_cop: 500000 }, turno);
    expect(base.calcularPrecio).toHaveBeenLastCalledWith(300, null, "Cali");
    await ejecutar("calcular_precio", { ciudad: "Cali", consumo_kwh_mes: null, pago_mensual_cop: 500000 }, turno);
    expect(base.calcularPrecio).toHaveBeenLastCalledWith(null, 500000, "Cali");
  });

  it("pedir_datos muestra el formulario", async () => {
    const r = await ejecutar("pedir_datos_de_contacto", { motivo: "visita" }, turno);
    expect(r.evento).toEqual({ tipo: "formulario", motivo: "visita" });
  });

  it("agendar_visita valida el formato antes de ir a la base", async () => {
    const r = await ejecutar("agendar_visita", { fecha: "el martes", hora: "10" }, turno);
    expect(r.esError).toBe(true);
    expect(base.agendarVisita).not.toHaveBeenCalled();
  });

  it("pasar_a_asesor sin datos no gasta un resumen en Claude", async () => {
    const r = JSON.parse((await ejecutar("pasar_a_asesor", { motivo: "x" }, turno)).contenido);
    expect(r.estado).toBe("rechazada");
    const avisado = JSON.parse((await ejecutar("pasar_a_asesor", { motivo: "x" }, { ...turno, contexto: { ...contexto, datosDejados: true, asesorAvisado: true } })).contenido);
    expect(avisado.estado).toBe("ya_estaba");
  });

  it("una herramienta que no existe se rechaza", async () => {
    expect((await ejecutar("borrar_clientes", {}, turno)).esError).toBe(true);
  });
});

describe("armarResumen", () => {
  it("arma una línea limpia con los datos útiles", () => {
    const r = armarResumen({ resumen: "Hogar quiere cotizar, cel 3101234567", necesita: "cotizacion", ciudad: "Cali", consumo_kwh_mes: 300, urgencia: "alta" });
    expect(r?.texto).not.toContain("3101234567");
    expect(r?.texto).toContain("ciudad: Cali; consumo: 300 kWh/mes; urgencia: alta");
    expect(r?.necesita).toBe("cotizacion");
  });

  it("la ciudad solo puede ser una de las tres (no cuela enlaces ni teléfonos)", () => {
    const r = armarResumen({ resumen: "Quiere cotizar", necesita: "otro", ciudad: "llame ya al 3001234567 o entre a pago-solar.co", consumo_kwh_mes: null, urgencia: "no_se_sabe" });
    expect(r?.texto).toBe("Quiere cotizar");
    expect(armarResumen({ resumen: "x", necesita: "otro", ciudad: "MEDELLIN", consumo_kwh_mes: null, urgencia: "no_se_sabe" })?.texto).toBe("x (ciudad: Medellín)");
  });

  it("rechaza fichas mal armadas", () => {
    expect(armarResumen(null)).toBeNull();
    expect(armarResumen({ resumen: "" })).toBeNull();
    expect(armarResumen({ resumen: "x", necesita: "borrar" })?.necesita).toBe("otro");
  });
});
