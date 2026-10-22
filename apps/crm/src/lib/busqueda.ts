/**
 * Prepara lo que escribió la persona para compararlo con la columna `busqueda` de contactos,
 * que la base de datos guarda en minúsculas y sin tildes (migración 002).
 */
export function normalizarBusqueda(texto: string): string {
  const limpio = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .toLowerCase()
    .trim()
    .slice(0, 60);

  // "300 123 4567" o "(300) 123-4567": se buscan solo los dígitos, como están guardados
  if (/^[\d\s()+-]+$/.test(limpio)) {
    return limpio.replace(/\D/g, "");
  }
  return limpio.replace(/\s+/g, " ");
}

/** Escapa los comodines de ILIKE (% y _) para que se busquen como texto normal. */
export function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
