import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * La llave de servicio se salta todos los permisos (RLS). El MCP actúa siempre con la llave de quien
 * se conectó, así que nada de lo suyo puede importarla (docs/plan-fase-5.md, sección 4, fila 12).
 */
const CARPETAS_DEL_MCP = ["src/lib/mcp", "src/app/api/mcp", "src/app/.well-known", "src/app/oauth"];

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("el MCP no usa la llave de servicio", () => {
  const todos = CARPETAS_DEL_MCP.flatMap(archivos).filter((ruta) => !ruta.endsWith(".test.ts"));

  it("revisa archivos de verdad", () => {
    expect(todos.length).toBeGreaterThan(5);
  });

  it.each(todos)("%s no importa el cliente de servicio ni lee SUPABASE_SECRET_KEY", (ruta) => {
    const codigo = readFileSync(ruta, "utf8");
    expect(codigo).not.toMatch(/supabase\/servicio|crearClienteDeServicio|SUPABASE_SECRET_KEY/);
  });
});
