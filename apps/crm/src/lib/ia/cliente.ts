import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * El cliente de la API de Claude. La llave (ANTHROPIC_API_KEY) solo vive en el servidor del CRM: nunca en
 * el navegador ("server-only") ni en n8n. Los reintentos y el tiempo límite los fija cada llamada.
 */
export function clienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el servidor");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}
