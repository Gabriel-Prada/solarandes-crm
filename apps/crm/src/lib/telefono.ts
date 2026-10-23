/**
 * Convierte lo que escribió la persona al formato que exige la base de datos: +57 y 10 dígitos
 * que empiezan por 3 (celular colombiano). Devuelve null si no es un celular válido.
 */
export function normalizarTelefono(texto: string | null): string | null {
  if (texto === null) return null;
  // Un número que Excel guardó como decimal (3056695760.0) pierde el ".0"
  let digitos = texto.trim().replace(/^(\d+)\.0$/, "$1").replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("57")) {
    digitos = digitos.slice(2);
  }
  return /^3\d{9}$/.test(digitos) ? `+57${digitos}` : null;
}
