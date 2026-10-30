import { createMcpHandler } from "mcp-handler";
import { describe, expect, it, vi } from "vitest";

// "server-only" impide importar este código en el navegador; en las pruebas no hace falta
vi.mock("server-only", () => ({}));

const { registrarHerramientas } = await import("./servidor");

/**
 * El servidor MCP completo, sin la puerta de la llave (esa se prueba en llave/claims): qué herramientas,
 * resources y prompts anuncia, y que los prompts se armen. Nada de esto toca la base.
 */
const servidor = createMcpHandler(registrarHerramientas, { serverInfo: { name: "solarandes-crm", version: "prueba" } });

async function pedir(method: string, params: Record<string, unknown> = {}) {
  const respuesta = await servidor(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const texto = await respuesta.text();
  const json = texto.startsWith("event:") || texto.startsWith("data:") ? texto.split("data: ")[1] : texto;
  return JSON.parse(json).result;
}

describe("el servidor MCP de SolarAndes", () => {
  it("anuncia las 11 herramientas, y solo las tres acciones escriben", async () => {
    const { tools } = await pedir("tools/list");
    const nombres = tools.map((t: { name: string }) => t.name).sort();
    expect(nombres).toEqual(
      [
        "agendar_visita",
        "buscar_cliente",
        "calcular_precio",
        "mover_venta",
        "panel_del_negocio",
        "quien_soy",
        "registrar_actividad",
        "ventas_sin_seguimiento",
        "ver_agenda_tecnica",
        "ver_ficha",
        "ver_ventas",
      ].sort(),
    );
    const escriben = tools.filter((t: { annotations?: { readOnlyHint?: boolean } }) => !t.annotations?.readOnlyHint);
    expect(escriben.map((t: { name: string }) => t.name).sort()).toEqual(["agendar_visita", "mover_venta", "registrar_actividad"]);
  });

  it("no hay ninguna herramienta para borrar", async () => {
    const { tools } = await pedir("tools/list");
    expect(tools.some((t: { name: string }) => /borrar|eliminar|delete/i.test(t.name))).toBe(false);
  });

  it("anuncia los resources, y la ficha es una plantilla sin lista", async () => {
    const { resources } = await pedir("resources/list");
    expect(resources.map((r: { uri: string }) => r.uri).sort()).toEqual(["solarandes://catalogo", "solarandes://precios"]);
    const { resourceTemplates } = await pedir("resources/templates/list");
    expect(resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toEqual(["solarandes://clientes/{codigo}"]);
  });

  it("anuncia los dos prompts y los arma con la fecha de hoy", async () => {
    const { prompts } = await pedir("prompts/list");
    expect(prompts.map((p: { name: string }) => p.name).sort()).toEqual(["leads_en_riesgo", "resumen_del_dia"]);
    const resumen = await pedir("prompts/get", { name: "resumen_del_dia" });
    expect(resumen.messages[0].content.text).toMatch(/Hoy es .* \(\d{4}-\d{2}-\d{2}\)/);
    const riesgo = await pedir("prompts/get", { name: "leads_en_riesgo", arguments: { asesor: "Valentina" } });
    expect(riesgo.messages[0].content.text).toContain('asesor "Valentina"');
  });
});
