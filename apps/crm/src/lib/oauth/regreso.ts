/**
 * Las dos listas blancas de la página de autorización (docs/plan-fase-5.md, sección 4 y sus ajustes).
 */

/**
 * A dónde puede volver la llave después de que la gerente aprueba. Comparación exacta, nunca "empieza
 * por": cualquiera puede registrar una app (registro automático) y ponerle el nombre que quiera.
 */
const REGRESOS_DE_CLAUDE = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

// MCP Inspector en el propio PC. Solo con el interruptor MCP_PERMITIR_INSPECTOR=si, que se apaga al
// terminar de probar: si no, cualquier programa del PC podría pedir permiso haciéndose pasar por él.
const REGRESOS_DE_INSPECTOR = ["http://localhost:6274/oauth/callback", "http://localhost:6274/oauth/callback/debug"];

export function regresoPermitido(direccion: string, { permitirInspector }: { permitirInspector: boolean }): boolean {
  if (REGRESOS_DE_CLAUDE.includes(direccion)) return true;
  return permitirInspector && REGRESOS_DE_INSPECTOR.includes(direccion);
}

/**
 * A dónde puede volver /login después de entrar. Solo a la página de autorización: si aceptara
 * cualquier dirección, serviría para mandar a la gente a sitios ajenos con la cara del CRM.
 */
export function rutaDeRegreso(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  // Una ruta propia empieza con una sola "/" (con "//" o "\" el navegador la toma como otro sitio)
  if (!/^\/oauth\/consent(\?[^\\]*)?$/.test(valor)) return null;
  return valor;
}
