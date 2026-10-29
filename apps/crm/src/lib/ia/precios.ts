/**
 * Precios de la API de Claude, en dólares por millón de tokens (un token es un pedazo de palabra de
 * unas 3 o 4 letras). Se guardan aquí para calcular el costo de cada llamada al momento de hacerla:
 * si Anthropic cambia los precios, las llamadas viejas conservan lo que costaron entonces.
 */
const PRECIOS: Record<string, { entrada: number; salida: number }> = {
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10 },
  "claude-opus-5-5": { entrada: 4, salida: 20 },
};

export type Uso = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** ¿Sabemos cuánto cobra este modelo? */
export function tienePrecio(modelo: string): boolean {
  return modelo in PRECIOS;
}

/**
 * Lo que costó una llamada. Escribir en el caché cuesta 1,25 veces la entrada; leerlo, una décima parte.
 * Sin precio para el modelo devuelve null (costo desconocido): nunca lanza, porque la llamada ya se pagó y
 * hay que anotarla igual.
 */
export function costoUsd(modelo: string, uso: Uso): number | null {
  const precio = PRECIOS[modelo];
  if (!precio) return null;
  const millon = 1_000_000;
  const costo =
    (uso.input_tokens * precio.entrada +
      (uso.cache_creation_input_tokens ?? 0) * precio.entrada * 1.25 +
      (uso.cache_read_input_tokens ?? 0) * precio.entrada * 0.1 +
      uso.output_tokens * precio.salida) /
    millon;
  return Math.round(costo * 1_000_000) / 1_000_000; // seis decimales, como la columna de la base
}

/** Tokens de entrada contando también los del caché (para el registro). */
export function tokensEntrada(uso: Uso): number {
  return uso.input_tokens + (uso.cache_creation_input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0);
}
