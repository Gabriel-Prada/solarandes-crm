import type { NextConfig } from "next";

// Cache Components está apagado a propósito: en un CRM todas las páginas dependen de quién
// inició sesión, así que no hay contenido estático que guardar y solo complicaría el código.
const nextConfig: NextConfig = {
  // La página donde la gerente autoriza a Claude, y el login por el que pasa antes, no se dejan meter
  // dentro de otro sitio: si no, otra página podría incrustarlas y engañar su clic (docs/plan-fase-5.md)
  async headers() {
    const sinMarco = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [
      { source: "/oauth/:ruta*", headers: sinMarco },
      { source: "/login", headers: sinMarco },
      // El asistente público tampoco: otro sitio no puede incrustarlo para gastar su crédito
      { source: "/asistente", headers: sinMarco },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
