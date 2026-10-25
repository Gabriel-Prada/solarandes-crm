import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Solo enseña a las pruebas el atajo "@/" (la carpeta src), el mismo que usa Next.js
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
