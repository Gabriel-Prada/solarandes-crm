import { CONOCIMIENTO, type Fragmento } from "./conocimiento";

/**
 * La búsqueda de las preguntas frecuentes, POR PALABRAS (el método clásico de los buscadores, BM25):
 * cuenta qué palabras de la pregunta aparecen en cada fragmento, dándoles más peso a las palabras raras
 * ("inversor") que a las comunes ("sistema"). No necesita otra cuenta ni cuesta nada.
 * Ver docs/plan-fase-6.md, pieza 2: el examen mide si alcanza con preguntas dichas de otra forma.
 */

const VACIAS = new Set(
  (
    "a al algo algun alguna ante con contra cual cuales de del desde donde el ella ellos en entre era es esa ese eso esta este esto estoy " +
    "fue ha hay la las le les lo los mas me mi mis muy no nos o para pero por que quien se si sin sobre su sus te ti tu tus un una uno unos " +
    "y ya yo usted ustedes hola buenas quisiera quiero queria saber puedo pueden podria tienen tiene tengo hacer hace como cuanto cuanta cuando funciona funcionan sirve dame"
  ).split(" "),
);

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ");
}

/**
 * Raíz sencilla: las primeras 5 letras. Así "garantías" encuentra "garantía", "demoran" encuentra
 * "demora" e "instalar" encuentra "instalación", sin un diccionario del español.
 */
function raiz(palabra: string): string {
  return palabra.length > 5 ? palabra.slice(0, 5) : palabra;
}

export function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p))
    .map(raiz);
}

type Indice = { fragmento: Fragmento; terminos: Map<string, number>; largo: number };

function indexar(fragmentos: Fragmento[]): { docs: Indice[]; df: Map<string, number>; promedio: number } {
  const docs = fragmentos.map((fragmento) => {
    // El título y los sinónimos cuentan doble: dicen de qué trata el fragmento
    const lista = [
      ...palabras(fragmento.titulo),
      ...palabras(fragmento.titulo),
      ...fragmento.sinonimos.flatMap((s) => [...palabras(s), ...palabras(s)]),
      ...palabras(fragmento.texto),
    ];
    const terminos = new Map<string, number>();
    for (const p of lista) terminos.set(p, (terminos.get(p) ?? 0) + 1);
    return { fragmento, terminos, largo: lista.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terminos.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const promedio = docs.reduce((s, d) => s + d.largo, 0) / Math.max(docs.length, 1);
  return { docs, df, promedio };
}

const INDICE = indexar(CONOCIMIENTO);

export type Encontrado = { id: string; titulo: string; texto: string; puntaje: number };

/** Los fragmentos que mejor responden la consulta (máximo `cuantos`), solo si de verdad se parecen. */
export function buscarConocimiento(consulta: string, cuantos = 3, indice = INDICE): Encontrado[] {
  const k1 = 1.2;
  const b = 0.75;
  const n = indice.docs.length;
  const terminos = [...new Set(palabras(consulta.slice(0, 500)))];
  if (terminos.length === 0) return [];
  return indice.docs
    .map((d) => {
      let puntaje = 0;
      for (const t of terminos) {
        const f = d.terminos.get(t);
        if (!f) continue;
        const df = indice.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        puntaje += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.largo) / indice.promedio));
      }
      return { id: d.fragmento.id, titulo: d.fragmento.titulo, texto: d.fragmento.texto, puntaje };
    })
    .filter((e) => e.puntaje >= 2)
    .sort((a, b2) => b2.puntaje - a.puntaje)
    // Los que quedan muy lejos del mejor solo distraen
    .filter((e, _, todos) => e.puntaje >= todos[0].puntaje * 0.5)
    .slice(0, Math.min(Math.max(cuantos, 1), 5))
    .map((e) => ({ ...e, puntaje: Math.round(e.puntaje * 100) / 100 }));
}
