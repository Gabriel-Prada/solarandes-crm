import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

/**
 * La "dirección estándar" donde Claude pregunta a quién pedirle la llave del MCP (RFC 9728).
 * Responde lo mismo en /.well-known/oauth-protected-resource y en .../api/mcp: el recurso protegido
 * es siempre /api/mcp y quien entrega las llaves es el inicio de sesión de Supabase.
 */
export function GET(request: Request) {
  const emisor = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
  const responder = protectedResourceHandler({
    authServerUrls: [emisor],
    resourceUrl: `${getPublicOrigin(request)}/api/mcp`,
  });
  return responder(request);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
