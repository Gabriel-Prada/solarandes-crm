/**
 * Convierte lo que escribió la persona al formato que exige la base de datos: +57 y 10 dígitos
 * que empiezan por 3 (celular colombiano). Devuelve null si no es un celular válido.
 */
export function normalizarTelefono(texto: string): string | null {
  let digitos = texto.replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("57")) {
    digitos = digitos.slice(2);
  }
  return /^3\d{9}$/.test(digitos) ? `+57${digitos}` : null;
}
