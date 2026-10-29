import { describe, expect, it } from "vitest";

import { regresoPermitido, rutaDeRegreso } from "./regreso";

describe("regresoPermitido", () => {
  const sinInspector = { permitirInspector: false };
  const conInspector = { permitirInspector: true };

  it("acepta las direcciones de regreso de Claude", () => {
    expect(regresoPermitido("https://claude.ai/api/mcp/auth_callback", sinInspector)).toBe(true);
    expect(regresoPermitido("https://claude.com/api/mcp/auth_callback", sinInspector)).toBe(true);
  });

  it("rechaza direcciones parecidas: la comparación es exacta", () => {
    expect(regresoPermitido("https://claude.ai.evil.com/api/mcp/auth_callback", conInspector)).toBe(false);
    expect(regresoPermitido("https://claude.ai/api/mcp/auth_callback/../otra", conInspector)).toBe(false);
    expect(regresoPermitido("http://claude.ai/api/mcp/auth_callback", conInspector)).toBe(false);
    expect(regresoPermitido("https://evil.com/callback", conInspector)).toBe(false);
  });

  it("acepta MCP Inspector solo con el interruptor encendido y en su puerto exacto", () => {
    expect(regresoPermitido("http://localhost:6274/oauth/callback", sinInspector)).toBe(false);
    expect(regresoPermitido("http://localhost:6274/oauth/callback", conInspector)).toBe(true);
    expect(regresoPermitido("http://localhost:6274/oauth/callback/debug", conInspector)).toBe(true);
    expect(regresoPermitido("http://localhost:9999/oauth/callback", conInspector)).toBe(false);
  });
});

describe("rutaDeRegreso", () => {
  it("acepta la página de autorización con su identificador", () => {
    expect(rutaDeRegreso("/oauth/consent?authorization_id=abc-123")).toBe("/oauth/consent?authorization_id=abc-123");
    expect(rutaDeRegreso("/oauth/consent")).toBe("/oauth/consent");
  });

  it("rechaza cualquier otra dirección", () => {
    expect(rutaDeRegreso("/")).toBeNull();
    expect(rutaDeRegreso("/contactos")).toBeNull();
    expect(rutaDeRegreso("https://evil.com/oauth/consent")).toBeNull();
    expect(rutaDeRegreso("//evil.com/oauth/consent")).toBeNull();
    expect(rutaDeRegreso("/oauth/consentimiento")).toBeNull();
    expect(rutaDeRegreso("/oauth/consent?x=\\evil")).toBeNull();
    expect(rutaDeRegreso(undefined)).toBeNull();
    expect(rutaDeRegreso(["/oauth/consent"])).toBeNull();
  });
});
