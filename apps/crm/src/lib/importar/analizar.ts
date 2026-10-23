/**
 * Analiza un CSV de contactos antes de importarlo: qué pasaría con cada fila.
 *
 * Es el mismo recorrido de la migración del Excel heredado (scripts/migracion):
 * 1. limpiar cada fila, 2. unir las repetidas del archivo, 3. revisar que lo obligatorio esté,
 * 4. comparar con el CRM. No guarda nada; la acción del servidor lo vuelve a correr al
 * confirmar, sin confiar en lo que vio el navegador.
 */

import type { CanalOrigen, Ciudad, TipoContacto } from "@/lib/tipos";

import { normalizarTelefono } from "../telefono";
import { leerCsv } from "./csv";
import { agrupar, comparar, contradicciones, type FilaComparable } from "./duplicados";
import {
  nombrePropio,
  normalizarCiudad,
  normalizarConsumo,
  normalizarCorreo,
  normalizarTipo,
  separarNombre,
  simplificar,
} from "./limpieza";

// Cada fila hace varias consultas al guardar: con más filas, la importación podría pasar el
// tiempo máximo de una función en Vercel
export const MAXIMO_FILAS = 500;
// Las acciones del servidor reciben como máximo 1 MB; se deja margen para el resto del formulario
export const TAMANO_MAXIMO = 900_000;
// El mismo tope del formulario de nuevo contacto y de la cotización en la base de datos
export const MAXIMO_CONSUMO = 100_000;

type Columna = "nombre" | "empresa" | "telefono" | "correo" | "ciudad" | "tipo" | "consumo" | "asesor" | "canal" | "notas";

// Cada título de columna aceptado, ya simplificado, y la columna a la que corresponde.
// Map y no un objeto: así "constructor" o "toString" no se confunden con un título
const TITULOS = new Map<string, Columna>([
  ["nombre", "nombre"], ["nombre completo", "nombre"], ["cliente", "nombre"], ["contacto", "nombre"],
  ["empresa", "empresa"], ["negocio", "empresa"], ["razon social", "empresa"],
  ["telefono", "telefono"], ["celular", "telefono"], ["cel", "telefono"], ["whatsapp", "telefono"],
  ["correo", "correo"], ["email", "correo"], ["e-mail", "correo"],
  ["ciudad", "ciudad"],
  ["tipo", "tipo"], ["tipo cliente", "tipo"], ["tipo de cliente", "tipo"],
  ["consumo", "consumo"], ["consumo (kwh)", "consumo"], ["consumo mes", "consumo"], ["consumo kwh", "consumo"],
  ["asesor", "asesor"],
  ["canal", "canal"], ["origen", "canal"], ["canal de origen", "canal"],
  ["notas", "notas"], ["observaciones", "notas"],
]); // prettier-ignore

const CANALES = new Map<string, CanalOrigen>([
  ["anuncios", "anuncios"], ["anuncio", "anuncios"], ["publicidad", "anuncios"],
  ["whatsapp", "whatsapp"], ["wsp", "whatsapp"],
  ["web", "web"], ["pagina web", "web"],
  ["referido", "referido"], ["referida", "referido"],
]); // prettier-ignore

export type Asesor = { id: string; codigo: string; nombre: string; email: string; ciudad: Ciudad | null };
export type ContactoDelCrm = FilaComparable & { codigo: string };

export type Estado = "crear" | "existe" | "repetida" | "revisar" | "error";

export type DatosContacto = {
  tipo: TipoContacto | null;
  nombre: string | null;
  empresa: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: Ciudad | null;
  consumo: number | null;
  asesorId: string | null;
  canal: CanalOrigen | null;
  notas: string[];
};

export type FilaAnalizada = {
  fila: number; // número de línea en el archivo (el encabezado es la 1)
  original: string; // nombre o empresa tal como venía, para mostrarlo
  estado: Estado;
  detalle: string;
  contacto: DatosContacto;
  ilegibles: Record<string, string>; // lo que venía escrito y no se entendió: etiqueta → texto
  unidaA: number | null; // si es una fila repetida, la fila a la que se unió
};

export type Analisis = { error: string | null; filas: FilaAnalizada[] };

// Lo que el CRM exige para crear un contacto, con la etiqueta que ve la gerente
const OBLIGATORIOS: [keyof DatosContacto, string][] = [
  ["telefono", "el celular"],
  ["ciudad", "la ciudad"],
  ["tipo", "el tipo (hogar o negocio)"],
  ["consumo", "el consumo en kWh"],
  ["canal", "el canal"],
  ["asesorId", "el asesor"],
];

function columnasDelEncabezado(encabezado: string[]): Map<number, Columna> {
  const columnas = new Map<number, Columna>();
  encabezado.forEach((titulo, i) => {
    const columna = TITULOS.get(simplificar(titulo));
    if (columna && ![...columnas.values()].includes(columna)) columnas.set(i, columna);
  });
  return columnas;
}

/** El asesor por su código (U02), su correo, su nombre completo o su primer nombre. */
function buscarAsesor(texto: string, asesores: Asesor[]): Asesor | null {
  const simple = simplificar(texto);
  const encontrados = asesores.filter((a) =>
    [a.codigo, a.email, a.nombre, a.nombre.split(" ")[0]].some((forma) => simplificar(forma) === simple),
  );
  return encontrados.length === 1 ? encontrados[0] : null; // si dos coinciden, no se adivina
}

/** De varias formas del mismo nombre, la más completa y luego la que tiene tildes (como mejor_escrito en Python). */
function mejorEscrito(textos: (string | null)[]): string | null {
  const puntaje = (t: string) => [t.split(" ").length, [...t].filter((ch) => ch.charCodeAt(0) > 127).length];
  let mejor: string | null = null;
  for (const t of textos) {
    if (!t) continue;
    const [palabras, tildes] = puntaje(t);
    if (mejor === null || palabras > puntaje(mejor)[0] || (palabras === puntaje(mejor)[0] && tildes > puntaje(mejor)[1])) {
      mejor = t;
    }
  }
  return mejor;
}

/**
 * Paso 1: deja cada valor en el formato del CRM. Lo que no se entiende queda en null y se anota.
 * Los valores por defecto (tipo, canal, asesor) todavía no se ponen: se ponen después de unir las
 * filas repetidas, para que una fila sin tipo no "contradiga" a su repetida que sí lo trae.
 */
function limpiarFila(escritos: Partial<Record<Columna, string>>, fila: number, asesores: Asesor[]): FilaAnalizada {
  const escrito = (columna: Columna) => escritos[columna]?.trim() || null;
  const ilegibles: Record<string, string> = {};
  const entender = <T>(columna: Columna, etiqueta: string, valor: T | null): T | null => {
    if (valor === null && escrito(columna)) ilegibles[etiqueta] = escrito(columna)!;
    return valor;
  };

  let [nombre, empresa, dudoso] = separarNombre(escrito("nombre"));
  if (escrito("empresa")) {
    // Si el archivo trae la empresa en su propia columna, el nombre es solo de la persona
    empresa = nombrePropio(escrito("empresa")!);
    nombre = escrito("nombre") ? nombrePropio(escrito("nombre")!) : null;
    dudoso = false;
  }
  if (dudoso) ilegibles["el nombre"] = escrito("nombre")!;

  return {
    fila,
    original: escrito("nombre") ?? escrito("empresa") ?? "",
    estado: "crear",
    detalle: "",
    ilegibles,
    unidaA: null,
    contacto: {
      nombre,
      empresa,
      tipo: entender("tipo", "el tipo (hogar o negocio)", normalizarTipo(escrito("tipo"))),
      telefono: entender("telefono", "el celular", normalizarTelefono(escrito("telefono"))),
      correo: entender("correo", "el correo", normalizarCorreo(escrito("correo"))),
      ciudad: entender("ciudad", "la ciudad", normalizarCiudad(escrito("ciudad"))),
      consumo: entender("consumo", "el consumo en kWh", normalizarConsumo(escrito("consumo"))),
      canal: escrito("canal") ? entender("canal", "el canal", CANALES.get(simplificar(escrito("canal")!)) ?? null) : null,
      asesorId: escrito("asesor")
        ? entender("asesor", "el asesor", buscarAsesor(escrito("asesor")!, asesores)?.id ?? null)
        : null,
      notas: escrito("notas") ? [escrito("notas")!] : [],
    },
  };
}

function comoComparable(f: FilaAnalizada): FilaComparable {
  const { nombre, empresa, telefono, correo, ciudad } = f.contacto;
  return { fila: f.fila, nombre, empresa, telefono, correo, ciudad };
}

/**
 * Paso 2: une en la primera fila del grupo los datos de las demás (solo llena lo que le falta;
 * el nombre, la forma más completa). Si dicen cosas distintas en tipo, consumo, asesor o canal,
 * no se elige: la fila va a revisión.
 */
function unirRepetidas(grupo: FilaAnalizada[]): void {
  const [primera, ...resto] = grupo;
  const c = primera.contacto;
  c.nombre = mejorEscrito(grupo.map((f) => f.contacto.nombre));
  c.empresa = mejorEscrito(grupo.map((f) => f.contacto.empresa));
  const distintos = new Set<string>();
  for (const otra of resto) {
    const o = otra.contacto;
    const comparables = [["tipo", "tipo"], ["consumo", "consumo"], ["asesorId", "asesor"], ["canal", "canal"]] as const;
    for (const [campo, nombre] of comparables) {
      if (c[campo] !== null && o[campo] !== null && c[campo] !== o[campo]) distintos.add(nombre);
    }
    c.telefono ??= o.telefono;
    c.correo ??= o.correo;
    c.ciudad ??= o.ciudad;
    c.tipo ??= o.tipo;
    c.consumo ??= o.consumo;
    c.asesorId ??= o.asesorId;
    c.canal ??= o.canal;
    c.notas = [...new Set([...c.notas, ...o.notas])];
    primera.ilegibles = { ...otra.ilegibles, ...primera.ilegibles };
    otra.estado = "repetida";
    otra.unidaA = primera.fila;
    otra.detalle = `es la misma persona de la fila ${primera.fila}; sus datos se unen a esa fila`;
  }
  if (distintos.size > 0) {
    primera.estado = "revisar";
    primera.detalle = `las filas ${grupo.map((f) => f.fila).join(", ")} son la misma persona, pero dicen distinto ${[...distintos].join(", ")}`;
  }
}

/** Paso 3: valores por defecto y lo que el CRM exige. Si falta, se dice si no venía o si no se entendió. */
function validar(fila: FilaAnalizada, asesores: Asesor[], canalPorDefecto: CanalOrigen): void {
  const c = fila.contacto;
  const ilegible = (etiqueta: string) => etiqueta in fila.ilegibles;
  // Por defecto, y solo si no venía escrito algo que no se entendió:
  // el canal que eligió la gerente; con empresa es negocio y sin empresa, hogar; el asesor de la ciudad
  if (c.canal === null && !ilegible("el canal")) c.canal = canalPorDefecto;
  if (c.tipo === null && !ilegible("el tipo (hogar o negocio)")) c.tipo = c.empresa ? "negocio" : "hogar";
  if (c.asesorId === null && !ilegible("el asesor") && c.ciudad) {
    c.asesorId = asesores.find((a) => a.ciudad === c.ciudad)?.id ?? null;
  }

  const problemas: string[] = [];
  if (!c.nombre && !c.empresa) {
    problemas.push(
      ilegible("el nombre") ? `no se sabe qué es persona y qué es empresa en "${fila.ilegibles["el nombre"]}"` : "falta el nombre",
    );
  }
  for (const [campo, etiqueta] of OBLIGATORIOS) {
    if (c[campo] !== null) continue;
    // Sin asesor escrito ni ciudad, el problema es la ciudad (ya se dijo): el asesor sale de ella
    if (campo === "asesorId" && !ilegible(etiqueta) && c.ciudad === null) continue;
    problemas.push(ilegible(etiqueta) ? `${etiqueta} ilegible: "${fila.ilegibles[etiqueta]}"` : `falta ${etiqueta}`);
  }
  if (c.correo === null && ilegible("el correo")) {
    problemas.push(`el correo ilegible: "${fila.ilegibles["el correo"]}"`); // es opcional, pero si viene, que sirva
  }
  if (c.consumo !== null && c.consumo > MAXIMO_CONSUMO) {
    problemas.push(`el consumo de ${c.consumo} kWh es demasiado alto (máximo ${MAXIMO_CONSUMO}); revisa si sobra un cero`);
  }
  if (c.tipo === "hogar" && c.empresa) problemas.push(`dice hogar, pero trae la empresa "${c.empresa}"`);
  if (c.tipo === "negocio" && !c.empresa) problemas.push("es un negocio, pero falta el nombre de la empresa");
  if (problemas.length > 0) {
    fila.estado = "error";
    fila.detalle = problemas.join("; ");
  }
}

/**
 * Paso 4: ¿ya está en el CRM? Las mismas reglas de scripts/migracion/conciliar.py (casos
 * compartidos en tests/casos_compartidos/limpieza.json):
 * - una sola coincidencia segura y ninguna duda: ya existe;
 * - ninguna coincidencia: es nueva, salvo que su celular ya sea de otro contacto;
 * - lo demás: duda.
 */
export function buscarEnCrm(f: FilaComparable, crm: ContactoDelCrm[]): { codigo: string } | { duda: string } | null {
  const seguros: [ContactoDelCrm, string][] = [];
  const dudosos: [ContactoDelCrm, string][] = [];
  for (const contacto of crm) {
    const coincidencia = comparar(f, contacto);
    if (coincidencia) (coincidencia.nivel === "seguro" ? seguros : dudosos).push([contacto, coincidencia.razon]);
  }
  const describir = (c: ContactoDelCrm) => `${c.codigo} ${c.nombre ?? c.empresa}`;
  if (seguros.length === 0 && dudosos.length === 0) {
    // El celular es único en el CRM: si ya es de otra persona, no se puede crear ni decidir solo
    const duenoDelCelular = f.telefono ? crm.find((c) => c.telefono === f.telefono) : undefined;
    return duenoDelCelular ? { duda: `el celular ya es de ${describir(duenoDelCelular)}, que parece otra persona` } : null;
  }
  if (seguros.length === 1 && dudosos.length === 0) return { codigo: seguros[0][0].codigo };
  // Un homónimo (mismo nombre, datos que se contradicen, ni teléfono ni correo en común) no es duda
  const compartenDato = (c: FilaComparable) =>
    (f.telefono !== null && f.telefono === c.telefono) || (f.correo !== null && f.correo === c.correo);
  const homonimos = dudosos.filter(([c]) => contradicciones(f, c).length > 0 && !compartenDato(c));
  if (seguros.length === 1 && compartenDato(seguros[0][0]) && homonimos.length === dudosos.length) {
    return { codigo: seguros[0][0].codigo };
  }
  const candidatos = [...seguros, ...dudosos].map(([c, razon]) => `${describir(c)} (${razon})`);
  return { duda: `se parece a más de un contacto del CRM o hay dudas: ${candidatos.join("; ")}` };
}

export function analizar(texto: string, crm: ContactoDelCrm[], asesores: Asesor[], canalPorDefecto: CanalOrigen): Analisis {
  const [encabezado, ...datos] = leerCsv(texto);
  if (!encabezado) return { error: "El archivo está vacío.", filas: [] };
  const columnas = columnasDelEncabezado(encabezado);
  const reconocidas = new Set(columnas.values());
  if (!reconocidas.has("telefono") || !(reconocidas.has("nombre") || reconocidas.has("empresa"))) {
    return {
      error:
        "No encontré las columnas de nombre y celular. Revisa que la primera fila tenga los títulos " +
        "(por ejemplo: nombre, celular, ciudad, consumo).",
      filas: [],
    };
  }

  const filas: FilaAnalizada[] = [];
  datos.forEach((celdas, i) => {
    if (celdas.every((c) => c.trim() === "")) return; // fila vacía
    const escritos: Partial<Record<Columna, string>> = {};
    columnas.forEach((columna, posicion) => (escritos[columna] = celdas[posicion] ?? ""));
    filas.push(limpiarFila(escritos, i + 2, asesores));
  });
  if (filas.length === 0) return { error: "El archivo no tiene filas con datos.", filas: [] };
  if (filas.length > MAXIMO_FILAS) {
    return { error: `El archivo tiene ${filas.length} filas; el máximo es ${MAXIMO_FILAS}. Pártelo en varios.`, filas: [] };
  }

  // Paso 2: repetidos dentro del archivo, con las reglas de los duplicados del Excel heredado
  const { grupos, revision } = agrupar(filas.map(comoComparable));
  for (const grupo of grupos) {
    if (grupo.length > 1) unirRepetidas(grupo.map((posicion) => filas[posicion]));
  }
  // Una duda alcanza a toda la persona: si la fila en duda es una repetida, la que se retiene es
  // la fila a la que se unió (igual que "pendiente_de_revision" en Python)
  const porNumero = new Map(filas.map((f) => [f.fila, f]));
  const cabeza = (f: FilaAnalizada) => (f.unidaA !== null ? porNumero.get(f.unidaA)! : f);
  for (const pareja of revision) {
    for (const [esta, otra] of [
      [pareja.a, pareja.b],
      [pareja.b, pareja.a],
    ]) {
      const fila = cabeza(filas[esta]);
      if (fila.estado === "crear") {
        fila.estado = "revisar";
        fila.detalle = `puede ser la misma persona de la fila ${cabeza(filas[otra]).fila}: ${pareja.razon}`;
      }
    }
  }

  // Paso 3: valores por defecto y lo obligatorio, ya con los datos unidos
  for (const fila of filas) {
    if (fila.estado !== "repetida") validar(fila, asesores, canalPorDefecto);
  }

  // Paso 4: lo que queda por crear se compara con el CRM
  for (const fila of filas) {
    if (fila.estado !== "crear") continue;
    const encontrado = buscarEnCrm(comoComparable(fila), crm);
    if (encontrado && "codigo" in encontrado) {
      fila.estado = "existe";
      fila.detalle = `ya está en el CRM como ${encontrado.codigo}; no se importa`;
    } else if (encontrado) {
      fila.estado = "revisar";
      fila.detalle = encontrado.duda;
    }
  }
  return { error: null, filas };
}
