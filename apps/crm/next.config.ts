import type { NextConfig } from "next";

// Cache Components está apagado a propósito: en un CRM todas las páginas dependen de quién
// inició sesión, así que no hay contenido estático que guardar y solo complicaría el código.
const nextConfig: NextConfig = {
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
