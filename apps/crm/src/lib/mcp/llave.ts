import "server-only";

import type { AuthInfo } from "@modelcontextprotocol/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { revisarClaims } from "./claims";

const ROL_PERMITIDO = "gerente"; // decisión D de Gabriel (2026-10-29): solo la gerente se conecta

/** Por qué una llave auténtica igual no puede usar el MCP (la puerta responde 403 o 503). */
export type Rechazo = "rol" | "app" | "error";

/** Cliente de Supabase "en nombre" de la persona dueña de la llave: la base aplica sus permisos (RLS). */
export function clienteConLlave(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Revisa la llave que Claude manda en cada pedido al MCP (docs/plan-fase-5.md, sección 4).
 * 1. La firma (que de verdad la haya emitido Supabase) y el contenido (revisarClaims). Si falla,
 *    devuelve undefined y withMcpAuth responde 401 sin tocar la base.
 * 2. Que sea la gerente y que su app esté aprobada. Se revisa aquí, en la puerta, y no en cada
 *    herramienta: así ninguna herramienta (ni la lista de herramientas) puede olvidarse de hacerlo.
 *    El rol se mira en cada pedido: si deja de ser gerente o queda inactiva, se corta en el siguiente.
 */
export async function verificarLlave(_request: Request, token?: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llavePublica = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !llavePublica) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  // getClaims comprueba la firma con las llaves públicas de Supabase (ES256) y que no esté vencida
  const verificador = createClient(url, llavePublica, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await verificador.auth.getClaims(token);
  if (error || !data?.claims) return undefined;

  const revision = revisarClaims(data.claims, { emisor: `${url}/auth/v1`, ahora: Date.now() / 1000 });
  if (!revision.ok) return undefined;

  const supabase = clienteConLlave(token);
  const [rol, aprobada] = await Promise.all([supabase.rpc("mi_rol"), supabase.rpc("mi_app_esta_aprobada")]);
  let rechazo: Rechazo | undefined;
  if (rol.error || aprobada.error) {
    console.error("MCP: no se pudieron revisar los permisos", rol.error?.code ?? aprobada.error?.code);
    rechazo = "error";
  } else if (rol.data !== ROL_PERMITIDO) {
    rechazo = "rol";
  } else if (aprobada.data !== true) {
    rechazo = "app";
  }

  return {
    token,
    clientId: revision.clientId,
    scopes: revision.scopes,
    expiresAt: revision.expiraEn,
    extra: { usuarioId: revision.usuarioId, rechazo },
  };
}
