import { describe, expect, it } from "vitest";

import { revisarClaims } from "./claims";

const EMISOR = "https://proyecto.supabase.co/auth/v1";
const AHORA = 1_800_000_000;

const llaveDeApp = {
  iss: EMISOR,
  exp: AHORA + 3600,
  aud: "authenticated",
  role: "authenticated",
  sub: "11111111-1111-1111-1111-111111111111",
  client_id: "22222222-2222-2222-2222-222222222222",
  scope: "openid email",
  is_anonymous: false,
};

const revisar = (cambios: Record<string, unknown>) =>
  revisarClaims({ ...llaveDeApp, ...cambios }, { emisor: EMISOR, ahora: AHORA });

describe("revisarClaims", () => {
  it("acepta la llave de una app conectada", () => {
    expect(revisar({})).toEqual({
      ok: true,
      usuarioId: llaveDeApp.sub,
      clientId: llaveDeApp.client_id,
      scopes: ["openid", "email"],
      expiraEn: llaveDeApp.exp,
    });
  });

  it("rechaza una llave normal del CRM, sin la marca de app conectada", () => {
    expect(revisar({ client_id: undefined })).toEqual({ ok: false, motivo: "sin_app" });
    expect(revisar({ client_id: "" })).toEqual({ ok: false, motivo: "sin_app" });
  });

  it("rechaza la llave de otro proyecto de Supabase", () => {
    expect(revisar({ iss: "https://otro.supabase.co/auth/v1" })).toEqual({ ok: false, motivo: "emisor" });
  });

  it("rechaza una llave vencida o sin vencimiento", () => {
    expect(revisar({ exp: AHORA })).toEqual({ ok: false, motivo: "vencida" });
    expect(revisar({ exp: undefined })).toEqual({ ok: false, motivo: "vencida" });
  });

  it("rechaza visitantes anónimos y la llave de servicio", () => {
    expect(revisar({ is_anonymous: true })).toEqual({ ok: false, motivo: "anonimo" });
    expect(revisar({ role: "anon" })).toEqual({ ok: false, motivo: "rol" });
    expect(revisar({ role: "service_role" })).toEqual({ ok: false, motivo: "rol" });
    expect(revisar({ aud: "otra" })).toEqual({ ok: false, motivo: "rol" });
  });

  it("rechaza una llave sin usuario", () => {
    expect(revisar({ sub: "" })).toEqual({ ok: false, motivo: "usuario" });
  });
});
