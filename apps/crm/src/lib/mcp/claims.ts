/**
 * El contenido de una llave de Supabase, ya con la firma comprobada. La firma dice "esto lo emitió
 * Supabase"; esta revisión dice "y es el tipo de llave que el MCP acepta".
 */
export type RevisionClaims =
  | { ok: true; usuarioId: string; clientId: string; scopes: string[]; expiraEn: number }
  | { ok: false; motivo: string };

export function revisarClaims(
  claims: Record<string, unknown>,
  { emisor, ahora }: { emisor: string; ahora: number },
): RevisionClaims {
  // Que la haya emitido el Supabase de este proyecto, no otro
  if (claims.iss !== emisor) return { ok: false, motivo: "emisor" };
  if (typeof claims.exp !== "number" || claims.exp <= ahora) return { ok: false, motivo: "vencida" };
  // Una persona con sesión, no un visitante anónimo ni la llave de servicio
  if (claims.aud !== "authenticated" || claims.role !== "authenticated") return { ok: false, motivo: "rol" };
  if (claims.is_anonymous === true) return { ok: false, motivo: "anonimo" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, motivo: "usuario" };
  // Solo llaves de una app conectada (OAuth): así siempre les aplica el candado de la base (fila 2)
  if (typeof claims.client_id !== "string" || !claims.client_id) return { ok: false, motivo: "sin_app" };

  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  return { ok: true, usuarioId: claims.sub, clientId: claims.client_id, scopes, expiraEn: claims.exp };
}
