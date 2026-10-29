/**
 * El examen de la calificación de leads: corre los casos de data/evals/leads/ contra Claude DE VERDAD
 * (gasta crédito) y escribe el reporte en docs/evals/.
 *
 * Uso (desde apps/crm):
 *   npm run eval:leads -- --conjunto desarrollo            muestra cuánto va a costar y no gasta nada
 *   npm run eval:leads -- --conjunto desarrollo --si       lo corre
 *   Opciones: --modelo claude-opus-5-5 (para la corrida de referencia), --limite 5 (solo los primeros 5)
 *
 * Los conjuntos "prueba" y "prueba_externa" son para la cifra final y piden además --final: no se usan
 * para ajustar el prompt (estudiar con las preguntas del examen infla la nota).
 * La prioridad la calcula la base de datos (prioridad_regla, migración 020), la misma regla del CRM.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { calificarLead, ESFUERZO_CALIFICACION, MODELO_CALIFICACION, type ResultadoLlamada } from "../src/lib/ia/calificar-lead/calificar";
import {
  CAMPOS,
  camposAcertados,
  entradaDelCaso,
  esErrorGrave,
  fichasCorrectas,
  resumenSospechoso,
  type Caso,
  type FichaSinResumen,
  type Prioridad,
} from "../src/lib/ia/calificar-lead/examen";
import { VERSION_PROMPT } from "../src/lib/ia/calificar-lead/prompt";
import { costoUsd } from "../src/lib/ia/precios";

process.loadEnvFile("../../.env");

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const conjunto = opcion("conjunto");
if (conjunto !== "desarrollo" && conjunto !== "prueba" && conjunto !== "prueba_externa") {
  salir("Falta --conjunto desarrollo, prueba o prueba_externa");
}
if (conjunto !== "desarrollo" && !process.argv.includes("--final")) {
  salir(`"${conjunto}" es para la cifra final: agrega --final si de verdad es la corrida final.`);
}
const modelo = opcion("modelo") ?? MODELO_CALIFICACION;
const textoLimite = opcion("limite");
const limite = textoLimite === undefined ? Infinity : Number(textoLimite);
if (!(limite >= 1)) salir("--limite debe ser un número mayor que 0");

const casos: Caso[] = readFileSync(`../../data/evals/leads/${conjunto}.jsonl`, "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Caso)
  .slice(0, limite);

// Antes de gastar: cuánto va a costar, más o menos (unos 1.300 tokens de entrada y 500 de salida por caso)
const estimado = costoUsd(modelo, { input_tokens: 1300 * casos.length, output_tokens: 500 * casos.length });
if (estimado === null) salir(`No hay precio para ${modelo} en src/lib/ia/precios.ts: agrégalo antes de gastar.`);
console.log(`${casos.length} casos de ${conjunto} con ${modelo}: alrededor de USD ${estimado.toFixed(4)}.`);
if (!process.argv.includes("--si")) {
  console.log("No se gastó nada. Para correrlo, agrega --si.");
  process.exit(0);
}

const claude = new Anthropic();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

async function prioridad(ficha: FichaSinResumen, caso: Caso): Promise<Prioridad> {
  const { data, error } = await supabase.rpc("prioridad_regla", { p_ficha: ficha, p_entrada: caso.entrada });
  if (error) throw new Error(`No se pudo calcular la prioridad: ${error.message}`);
  return data as Prioridad;
}

type Fila = {
  caso: Caso;
  llamada: ResultadoLlamada;
  aciertos: Record<string, boolean> | null;
  correctas: Prioridad[];
  obtenida: Prioridad | null;
};

async function corregir(caso: Caso): Promise<Fila> {
  const llamada = await calificarLead(claude, entradaDelCaso(caso), { modelo });
  const correctas = [...new Set(await Promise.all(fichasCorrectas(caso).map((f) => prioridad(f, caso))))];
  const obtenida = llamada.ficha ? await prioridad(llamada.ficha, caso) : null;
  const aciertos = llamada.ficha ? camposAcertados(caso, llamada.ficha) : null;
  process.stdout.write(obtenida && correctas.includes(obtenida) ? "." : "x");
  return { caso, llamada, aciertos, correctas, obtenida };
}

// De a 4 a la vez: rápido, sin ahogar la API
const filas: Fila[] = [];
for (let i = 0; i < casos.length; i += 4) {
  filas.push(...(await Promise.all(casos.slice(i, i + 4).map(corregir))));
}
console.log();

// --- El reporte ---
const n = filas.length;
const prioridadBien = filas.filter((f) => f.obtenida && f.correctas.includes(f.obtenida)).length;
const altas = filas.filter((f) => f.correctas.every((p) => p === "alta")).length;
const graves = filas.filter((f) => esErrorGrave(f.correctas, f.obtenida));
const erroresApi = filas.filter((f) => f.llamada.resultado === "error");
const sinFichaPorRespuesta = filas.filter((f) => f.llamada.resultado === "rechazo" || f.llamada.resultado === "invalida");
const costo = filas.reduce((s, f) => s + (f.llamada.costoUsd ?? 0), 0);
const tiempos = filas.map((f) => f.llamada.duracionMs);
const sospechosos = filas.filter((f) => f.llamada.ficha && resumenSospechoso(f.llamada.ficha.resumen));
const porCampo = CAMPOS.map((c) => `| ${c} | ${filas.filter((f) => f.aciertos?.[c]).length} de ${n} |`);
const fallos = filas.filter(
  (f) => !f.obtenida || !f.correctas.includes(f.obtenida) || (f.aciertos && Object.values(f.aciertos).includes(false)),
);
const celda = (texto: string, largo = 120) => texto.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, largo);

const fecha = new Date();
const sello = fecha.toISOString().slice(0, 16).replace(/[-:T]/g, "");
const reporte = `# Examen de la calificación de leads: ${conjunto}, ${modelo}

*${fecha.toLocaleString("es-CO", { timeZone: "America/Bogota" })} · prompt ${VERSION_PROMPT} · esfuerzo ${ESFUERZO_CALIFICACION} · ${n} casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **${prioridadBien} de ${n}** |
| Errores graves (un lead de prioridad alta quedó en baja, como "no es lead" o sin ficha) | **${graves.length}** de ${altas} leads de prioridad alta |
| Sin ficha porque Claude se negó o respondió mal | ${sinFichaPorRespuesta.length} |
| Sin ficha porque la API falló (no es culpa del modelo; repetir esos casos) | ${erroresApi.length} |
| Resúmenes para revisar a mano (pagos, "VIP", cifras largas) | ${sospechosos.length} |
| Costo del examen | USD ${costo.toFixed(4)} |
| Costo por lead | USD ${(costo / n).toFixed(6)} (1.000 leads ≈ USD ${((costo / n) * 1000).toFixed(2)}) |
| Tiempo de respuesta | promedio ${Math.round(tiempos.reduce((a, b) => a + b, 0) / n)} ms, máximo ${Math.max(...tiempos)} ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
${porCampo.join("\n")}

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|
${fallos
  .map((f) => {
    const malos = f.aciertos
      ? CAMPOS.filter((c) => !f.aciertos![c]).map((c) => `${c}: ${JSON.stringify(f.caso.esperado[c])} → ${JSON.stringify(f.llamada.ficha![c])}`)
      : [`sin ficha (${f.llamada.resultado}: ${f.llamada.error})`];
    return `| ${f.caso.id} | ${celda(f.caso.mensaje)} | ${f.correctas.join(" o ")} → ${f.obtenida ?? "—"} | ${malos.join("; ") || "—"} |`;
  })
  .join("\n")}

## Resúmenes

Lo que leería el asesor en el CRM y en el aviso (ya limpio de teléfonos, correos y enlaces). ⚠️ = para revisar a mano.

| Caso | Resumen |
|---|---|
${filas
  .filter((f) => f.llamada.ficha)
  .map((f) => `| ${f.caso.id}${resumenSospechoso(f.llamada.ficha!.resumen) ? " ⚠️" : ""} | ${celda(f.llamada.ficha!.resumen, 160)} |`)
  .join("\n")}
`;

mkdirSync("../../docs/evals", { recursive: true });
const ruta = `../../docs/evals/leads-${conjunto}-${modelo}-${sello}.md`;
writeFileSync(ruta, reporte, "utf-8");
console.log(
  `Prioridad correcta: ${prioridadBien} de ${n}. Errores graves: ${graves.length} de ${altas}. Errores de la API: ${erroresApi.length}. Costo: USD ${costo.toFixed(4)}.`,
);
console.log(`Reporte: ${ruta.replace("../../", "")}`);
