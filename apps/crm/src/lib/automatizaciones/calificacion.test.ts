import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  armarAvisoPrioritario,
  calificarSiguiente,
  calificarVuelta,
  esErrorDeConfiguracion,
  type AvisoPrioritario,
} from "./calificacion";

const FICHA = {
  es_lead: true,
  tipo_cliente: "hogar",
  urgencia: "alta",
  intencion: "quiere_sistema",
  consumo_kwh_mes: 400,
  factura_luz_cop: null,
  resumen: "Hogar en Cali, quiere instalar ya",
};

/** Una base de mentira: responde a cada función con lo que se le diga y guarda lo que le pidieron. */
function baseFalsa(respuestas: Record<string, unknown>) {
  const rpc = vi.fn(async (funcion: string) => ({ data: respuestas[funcion], error: null }));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

function claudeFalso() {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify(FICHA) }],
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 900, output_tokens: 150 },
  }));
  return { claude: { messages: { create } } as unknown as Anthropic, create };
}

describe("calificarSiguiente", () => {
  it("sin leads esperando no llama a Claude", async () => {
    const { supabase } = baseFalsa({ tomar_calificacion: { estado: "nada", atrasadas: 0 } });
    const { claude, create } = claudeFalso();
    expect(await calificarSiguiente(supabase, claude)).toEqual({ estado: "nada", atrasadas: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("sin cupo no llama a Claude y pasa la cuenta de atrasados (para la alarma)", async () => {
    const { supabase } = baseFalsa({ tomar_calificacion: { estado: "sin_cupo", atrasadas: 3 } });
    const { claude, create } = claudeFalso();
    expect(await calificarSiguiente(supabase, claude)).toEqual({ estado: "sin_cupo", atrasadas: 3 });
    expect(create).not.toHaveBeenCalled();
  });

  it("toma, califica y guarda con el mismo pedido como dueño", async () => {
    const { supabase, rpc } = baseFalsa({
      tomar_calificacion: {
        estado: "tomada",
        calificacion_id: "c1",
        llamada_id: "l1",
        entrada: { mensaje: "Quiero paneles ya", ciudad: "Cali" },
        atrasadas: 0,
      },
      guardar_calificacion: { guardada: true, estado: "calificada", prioridad: "alta" },
    });
    const r = await calificarSiguiente(supabase, claudeFalso().claude);
    expect(r).toEqual({ estado: "calificado", resultado: "ok", prioridad: "alta", guardada: true, error: null, atrasadas: 0 });

    const tomar = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const guardar = rpc.mock.calls[1] as unknown as [string, Record<string, unknown>];
    expect(guardar[0]).toBe("guardar_calificacion");
    expect(guardar[1].p_pedido).toBe(tomar[1].p_pedido); // el dueño de la reserva es el pedido
    expect(guardar[1]).toMatchObject({ p_calificacion: "c1", p_llamada: "l1", p_resultado: "ok", p_ficha: FICHA });
    expect(guardar[1].p_costo_usd).toBeGreaterThan(0);
  });

  it("si la base no acepta la ficha, la llamada (ya pagada) se anota igual, sin ficha", async () => {
    const tomada = { estado: "tomada", calificacion_id: "c1", llamada_id: "l1", entrada: { mensaje: "Hola, quiero paneles" }, atrasadas: 0 };
    let intentos = 0;
    const rpc = vi.fn(async (funcion: string) => {
      if (funcion === "tomar_calificacion") return { data: tomada, error: null };
      intentos += 1;
      return intentos === 1
        ? { data: null, error: { message: "el texto no se pudo guardar" } }
        : { data: { guardada: true, estado: "por_calificar", prioridad: null }, error: null };
    });
    const r = await calificarSiguiente({ rpc } as unknown as SupabaseClient, claudeFalso().claude);
    expect(r).toMatchObject({ estado: "calificado", guardada: true });
    const segundo = rpc.mock.calls[2] as unknown as [string, Record<string, unknown>];
    expect(segundo[1]).toMatchObject({ p_resultado: "invalida", p_ficha: null, p_error: "no_se_pudo_guardar" });
    expect(segundo[1].p_costo_usd).toBeGreaterThan(0);
  });

  it("cada pedido es un dueño distinto", async () => {
    const { supabase, rpc } = baseFalsa({ tomar_calificacion: { estado: "nada", atrasadas: 0 } });
    const { claude } = claudeFalso();
    await calificarSiguiente(supabase, claude);
    await calificarSiguiente(supabase, claude);
    const pedidos = rpc.mock.calls.map((c) => (c as unknown as [string, { p_pedido: string }])[1].p_pedido);
    expect(new Set(pedidos).size).toBe(2);
  });
});

describe("calificarVuelta", () => {
  const tomada = { estado: "tomada", calificacion_id: "c1", llamada_id: "l1", entrada: { mensaje: "Quiero paneles" }, atrasadas: 0 };
  const guardado = { data: { guardada: true, estado: "calificada", prioridad: "media" }, error: null };

  /** Una base que tiene `n` leads esperando. */
  function baseConLeads(n: number, otra: Partial<Record<string, unknown>> = {}) {
    let quedan = n;
    const rpc = vi.fn(async (funcion: string) => {
      if (funcion === "tomar_calificacion") {
        if (otra.tomar) return { data: otra.tomar, error: null };
        if (quedan-- > 0) return { data: tomada, error: null };
        return { data: { estado: "nada", atrasadas: 0 }, error: null };
      }
      return guardado;
    });
    return { supabase: { rpc } as unknown as SupabaseClient, rpc };
  }

  it("califica de a uno hasta que no haya más", async () => {
    const { supabase } = baseConLeads(2);
    expect(await calificarVuelta(supabase, claudeFalso().claude)).toMatchObject({ calificados: 2, fin: "nada" });
  });

  it("no pasa de 5 por vuelta", async () => {
    const { supabase } = baseConLeads(9);
    expect(await calificarVuelta(supabase, claudeFalso().claude)).toMatchObject({ calificados: 5, fin: "limite" });
  });

  it("se detiene con el primer fallo de Claude, sin gastar más intentos", async () => {
    const { supabase, rpc } = baseConLeads(4);
    const claude = { messages: { create: vi.fn(async () => Promise.reject(new Error("caído"))) } } as unknown as Anthropic;
    const r = await calificarVuelta(supabase, claude);
    expect(r).toMatchObject({ calificados: 0, fin: "fallo_claude", error: "desconocido", error_de_configuracion: false });
    expect(rpc.mock.calls.filter((c) => c[0] === "tomar_calificacion")).toHaveLength(1);
  });

  it("sin cupo para enseguida", async () => {
    const { supabase } = baseConLeads(0, { tomar: { estado: "sin_cupo", atrasadas: 4 } });
    expect(await calificarVuelta(supabase, claudeFalso().claude)).toMatchObject({ calificados: 0, fin: "sin_cupo", atrasadas: 4 });
  });

  it("no empieza otro lead si ya se acabó el tiempo", async () => {
    const { supabase, rpc } = baseConLeads(5);
    let reloj = 0;
    // Cada vez que se mira el reloj pasan 20 s: el segundo lead empieza a los 20 s; el tercero, a los 40 s, ya no
    const r = await calificarVuelta(supabase, claudeFalso().claude, { ahora: () => (reloj += 20_000), presupuestoMs: 30_000 });
    expect(r).toMatchObject({ calificados: 2, fin: "limite" });
    expect(rpc.mock.calls.filter((c) => c[0] === "tomar_calificacion")).toHaveLength(2);
  });

  it("un rechazo de configuración (sin saldo, llave inválida) se reporta como tal", async () => {
    const { supabase } = baseConLeads(3);
    const error = Anthropic.APIError.generate(401, undefined, "llave inválida", new Headers());
    const claude = { messages: { create: vi.fn(async () => Promise.reject(error)) } } as unknown as Anthropic;
    expect(await calificarVuelta(supabase, claude)).toMatchObject({
      calificados: 0,
      fin: "fallo_claude",
      error: "http_401",
      error_de_configuracion: true,
    });
  });

  it("si otro pedido ya era el dueño de la reserva, la vuelta se detiene", async () => {
    const rpc = vi.fn(async (funcion: string) =>
      funcion === "tomar_calificacion"
        ? { data: tomada, error: null }
        : { data: { guardada: false }, error: null },
    );
    const r = await calificarVuelta({ rpc } as unknown as SupabaseClient, claudeFalso().claude);
    expect(r).toMatchObject({ calificados: 0, fin: "fallo_claude", error: null, error_de_configuracion: false });
  });
});

describe("esErrorDeConfiguracion", () => {
  it("un 4xx que no es 429 no se arregla esperando", () => {
    expect(esErrorDeConfiguracion("http_400")).toBe(true); // por ejemplo, sin saldo
    expect(esErrorDeConfiguracion("http_401")).toBe(true); // llave inválida
    expect(esErrorDeConfiguracion("http_404")).toBe(true); // modelo que no existe
    expect(esErrorDeConfiguracion("http_429")).toBe(false);
    expect(esErrorDeConfiguracion("http_529")).toBe(false);
    expect(esErrorDeConfiguracion("tiempo_agotado")).toBe(false);
    expect(esErrorDeConfiguracion(null)).toBe(false);
  });
});

describe("armarAvisoPrioritario", () => {
  const aviso: AvisoPrioritario = {
    calificacion_id: "c1",
    contacto: { codigo: "C1001", nombre: "Panadería La Espiga", ciudad: "Cali" },
    venta: "O1001",
    resumen: "Panadería con factura alta, quiere instalar este mes",
    consumo_estimado: 2000,
    destinatario: { codigo: "U04", nombre: "Camilo Torres", email: "camilo.torres@solarandes.test" },
  };

  it("va al asesor, dice que el resumen es de una IA y enlaza al contacto", () => {
    const correo = armarAvisoPrioritario(aviso, "https://crm.example.com");
    expect(correo.para).toBe("camilo.torres@solarandes.test");
    expect(correo.asunto).toBe("Lead prioritario: Panadería La Espiga (C1001)");
    expect(correo.texto).toContain("Hola, Camilo:");
    expect(correo.texto).toContain("Resumen hecho por IA");
    expect(correo.texto).toContain("https://crm.example.com/contactos/C1001");
  });

  it("sin resumen ni consumo no deja líneas vacías de más", () => {
    const correo = armarAvisoPrioritario({ ...aviso, resumen: null, consumo_estimado: null }, "https://x");
    expect(correo.texto).not.toContain("Resumen");
    expect(correo.texto).not.toContain("Consumo");
  });
});
