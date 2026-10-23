/**
 * Lee un CSV y devuelve sus filas como listas de textos.
 *
 * Acepta coma o punto y coma como separador (Excel en español guarda los CSV con ";"), textos
 * entre comillas con separadores o saltos de línea adentro (comillas dobles "" = una comilla),
 * y la marca invisible (BOM) que Excel pone al inicio del archivo.
 */
export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  const separador = adivinarSeparador(limpio);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        celda += c;
      }
    } else if (c === '"' && celda === "") {
      // Las comillas solo abren un texto al inicio de la celda: en "TV de 50"" la comilla es parte del texto
      entreComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += c;
    }
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/** El separador es el que más aparece en la primera línea, fuera de comillas. */
function adivinarSeparador(texto: string): string {
  const primeraLinea = texto.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const cuenta = (s: string) => primeraLinea.split(s).length - 1;
  return cuenta(";") > cuenta(",") ? ";" : ",";
}
