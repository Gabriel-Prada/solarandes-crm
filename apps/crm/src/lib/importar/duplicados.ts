/**
 * Decide qué filas son la misma persona. Es la misma lógica de scripts/migracion/duplicados.py,
 * traducida a TypeScript, y resuelve los mismos casos de tests/casos_compartidos/limpieza.json.
 *
 * Cada pareja queda "seguro" (se unen solas), "revision" (decide una persona) o null. Una
 * contradicción (dos teléfonos, correos, empresas o ciudades distintos) impide unir en automático.
 */

import { simplificar } from "./limpieza";

export type FilaComparable = {
  fila: number; // en el archivo, para poder ubicarla
  nombre: string | null;
  empresa: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: string | null;
};

export type Coincidencia = { nivel: "seguro" | "revision"; razon: string };
export type ParejaEnRevision = { a: number; b: number; razon: string }; // posiciones en la lista

function palabrasDelNombre(f: FilaComparable): Set<string> {
  return new Set(f.nombre ? simplificar(f.nombre).split(" ") : []);
}

/** "Panadería Torres S.A.S." y "PANADERIA TORRES" son la misma empresa. */
function claveEmpresa(f: FilaComparable): string | null {
  return f.empresa ? simplificar(f.empresa).replace(/ s\.a\.s\.$/, "") : null;
}

/** Dos valores se contradicen si los dos existen y son distintos. Si falta uno, no se sabe. */
function chocan(x: string | null, y: string | null): boolean {
  return x !== null && y !== null && x !== y;
}

export function contradicciones(a: FilaComparable, b: FilaComparable): string[] {
  const pares: [string, string | null, string | null][] = [
    ["teléfono", a.telefono, b.telefono],
    ["correo", a.correo, b.correo],
    ["empresa", claveEmpresa(a), claveEmpresa(b)],
    ["ciudad", a.ciudad, b.ciudad],
  ];
  return pares.filter(([, x, y]) => chocan(x, y)).map(([campo]) => campo);
}

function contiene(grande: Set<string>, chico: Set<string>): boolean {
  return [...chico].every((palabra) => grande.has(palabra));
}

/** [iguales, parecidos, chocan]. Si a una de las dos le falta el nombre: no se sabe. */
export function compararNombres(a: FilaComparable, b: FilaComparable): [boolean, boolean, boolean] {
  const nombreA = palabrasDelNombre(a);
  const nombreB = palabrasDelNombre(b);
  if (nombreA.size === 0 || nombreB.size === 0) return [false, false, false];
  const comunes = [...nombreA].filter((p) => nombreB.has(p)).length;
  const iguales = nombreA.size >= 2 && nombreA.size === nombreB.size && contiene(nombreA, nombreB);
  const parecidos = (contiene(nombreB, nombreA) || contiene(nombreA, nombreB)) && comunes >= 2;
  return [iguales, parecidos, !parecidos];
}

export function comparar(a: FilaComparable, b: FilaComparable): Coincidencia | null {
  const [nombresIguales, nombresParecidos, nombresChocan] = compararNombres(a, b);
  const mismaEmpresa = claveEmpresa(a) !== null && claveEmpresa(a) === claveEmpresa(b);
  const mismaCiudad = a.ciudad !== null && a.ciudad === b.ciudad;
  const datoCompartido = [
    ["teléfono", a.telefono, b.telefono],
    ["correo", a.correo, b.correo],
  ]
    .filter(([, x, y]) => x !== null && x === y)
    .map(([campo]) => campo);

  const choques = contradicciones(a, b);
  if (choques.length > 0) {
    return nombresIguales ? { nivel: "revision", razon: `mismo nombre, pero distinto ${choques.join(", ")}` } : null;
  }
  if (datoCompartido.length > 0) {
    if (nombresChocan) {
      // puede ser una familia que comparte celular o correo
      return { nivel: "revision", razon: `mismo ${datoCompartido.join(" y ")}, pero nombres distintos` };
    }
    return { nivel: "seguro", razon: `mismo ${datoCompartido.join(" y ")}` };
  }
  // Sin teléfono ni correo en común, un nombre igual es poca prueba: hace falta la misma ciudad
  if (nombresIguales || (mismaEmpresa && !nombresChocan)) {
    const que = nombresIguales ? "mismo nombre" : "misma empresa";
    if (mismaCiudad) return { nivel: "seguro", razon: `${que} y misma ciudad` };
    return { nivel: "revision", razon: `${que}, sin teléfono, correo ni ciudad que lo confirme` };
  }
  if (nombresParecidos) return { nivel: "revision", razon: "nombre parecido, sin teléfono ni correo que lo confirme" };
  return null;
}

/** Si dos filas no se pueden unir en automático, la razón; si no hay impedimento, null. */
function porQueNoUnir(a: FilaComparable, b: FilaComparable): string | null {
  const choques = contradicciones(a, b);
  if (choques.length > 0) return `distinto ${choques.join(", ")}`;
  if (compararNombres(a, b)[2]) return "nombres distintos";
  const coincidencia = comparar(a, b);
  return coincidencia?.nivel === "revision" ? coincidencia.razon : null;
}

function describir(f: FilaComparable): string {
  return `${f.nombre ?? f.empresa ?? "sin nombre"} (fila ${f.fila})`;
}

/**
 * Agrupa las filas de cada persona, en dos tiempos (así el orden de las filas no cambia nada):
 * 1. Con las parejas seguras se arman grupos, como una red de amigos.
 * 2. Cada grupo se revisa completo: si dos de sus filas no se pueden unir, el grupo no se une y
 *    las parejas en conflicto van a revisión. Una fila sin nombre no sirve de puente.
 *
 * Devuelve los grupos como posiciones en la lista y las parejas en revisión.
 */
export function agrupar(filas: FilaComparable[]): { grupos: number[][]; revision: ParejaEnRevision[] } {
  const vecinos: number[][] = filas.map(() => []);
  const revision: ParejaEnRevision[] = [];
  const enRevision = new Set<string>();
  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      const coincidencia = comparar(filas[i], filas[j]);
      if (coincidencia === null) continue;
      if (coincidencia.nivel === "seguro") {
        vecinos[i].push(j);
        vecinos[j].push(i);
      } else {
        revision.push({ a: i, b: j, razon: coincidencia.razon });
        enRevision.add(`${i}-${j}`);
      }
    }
  }

  const grupos: number[][] = [];
  const visitados = new Set<number>();
  for (let inicio = 0; inicio < filas.length; inicio++) {
    if (visitados.has(inicio)) continue;
    // Recorre la red desde esta fila para encontrar todo su grupo
    const grupo: number[] = [];
    const pendientes = [inicio];
    visitados.add(inicio);
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      grupo.push(actual);
      for (const vecino of vecinos[actual]) {
        if (!visitados.has(vecino)) {
          visitados.add(vecino);
          pendientes.push(vecino);
        }
      }
    }
    grupo.sort((x, y) => x - y);

    const conflictos: ParejaEnRevision[] = [];
    for (let x = 0; x < grupo.length; x++) {
      for (let y = x + 1; y < grupo.length; y++) {
        const razon = porQueNoUnir(filas[grupo[x]], filas[grupo[y]]);
        if (razon) conflictos.push({ a: grupo[x], b: grupo[y], razon });
      }
    }
    if (conflictos.length === 0) {
      grupos.push(grupo);
      continue;
    }
    grupos.push(...grupo.map((posicion) => [posicion]));
    const cadena = grupo.map((posicion) => describir(filas[posicion])).join(" → ");
    for (const conflicto of conflictos) {
      if (!enRevision.has(`${conflicto.a}-${conflicto.b}`)) {
        revision.push({ ...conflicto, razon: `las une una cadena de filas parecidas (${cadena}), pero tienen ${conflicto.razon}` });
      }
    }
  }
  return { grupos, revision };
}
