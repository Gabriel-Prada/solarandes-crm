/**
 * El examen del asistente: corre las conversaciones de data/evals/asistente/ contra Claude DE VERDAD
 * (gasta crédito) con el MISMO código de producción (responderTurno, el prompt y las herramientas), y
 * escribe el reporte en docs/evals/.
 *
 * Lo único simulado es lo que escribe en el CRM: la base (en memoria) y las herramientas de datos, horarios,
 * visita y asesor. La búsqueda de preguntas frecuentes es la real, y el precio sale de la misma fórmula
 * (src/lib/cotizacion.ts, igual a la de la base: hay pruebas que lo comparan).
 *
 * Uso (desde apps/crm):
 *   npm run eval:asistente -- --conjunto desarrollo           muestra cuánto va a costar y no gasta nada
 *   npm run eval:asistente -- --conjunto desarrollo --si      lo corre
 *   Opciones: --limite 5 (solo los primeros 5), --solo d-precio-01,d-faq-02
 * "prueba" es para la cifra final y pide además --final (estudiar con las preguntas del examen infla la nota).
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { BaseAsistente, MensajeGuardado, Resultado } from "../src/lib/asistente/base";
import { buscarConocimiento } from "../src/lib/asistente/buscar";
import { CONOCIMIENTO } from "../src/lib/asistente/conocimiento";
import { MODELO_ASISTENTE, responderTurno, type EjecutarHerramienta, type Evento } from "../src/lib/asistente/conversar";
import { VERSION_PROMPT } from "../src/lib/asistente/prompt";
import { cotizar } from "../src/lib/cotizacion";
import { costoUsd } from "../src/lib/ia/precios";
import type { Ciudad } from "../src/lib/tipos";

process.loadEnvFile("../../.env");

type Caso = {
  id: string;
  tipo: string;
  conjunto: string;
  turnos: string[];
  contexto: { datos?: boolean };
  espera: {
    herramientas?: string[];
    sin_herramientas?: string[];
    precio?: number;
    fragmento?: string;
    dice_alguno?: string[];
    no_dice?: string[];
    criterio?: string;
  };
};

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const conjunto = opcion("conjunto");
if (conjunto !== "desarrollo" && conjunto !== "prueba") salir("Falta --conjunto desarrollo o prueba");
if (conjunto === "prueba" && !process.argv.includes("--final")) {
  salir('"prueba" es para la cifra final: agrega --final si de verdad es la corrida final.');
}
const limite = Number(opcion("limite") ?? Infinity);
const solo = opcion("solo")?.split(",");
let casos: Caso[] = readFileSync(`../../data/evals/asistente/${conjunto}.jsonl`, "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Caso);
if (solo) casos = casos.filter((c) => solo.includes(c.id));
casos = casos.slice(0, limite);

// Antes de gastar: unos 5.000 tokens de entrada (casi todo del caché después del primero) y 300 de salida
// por llamada, unas 2 llamadas por turno
const turnos = casos.reduce((s, c) => s + c.turnos.length, 0);
const estimado = costoUsd(MODELO_ASISTENTE, { input_tokens: 5000 * 2 * turnos, output_tokens: 300 * 2 * turnos })!;
console.log(`${casos.length} conversaciones (${turnos} mensajes) de ${conjunto}: como mucho USD ${estimado.toFixed(4)}.`);
if (!process.argv.includes("--si")) {
  console.log("No se gastó nada. Para correrlo, agrega --si.");
  process.exit(0);
}

const claude = new Anthropic();

// --- Lo simulado ---
const HORARIOS = [
  { fecha: "2026-11-03", hora: "10:00", en_palabras: "martes 3 de noviembre de 2026, 10:00 a. m." },
  { fecha: "2026-11-03", hora: "14:00", en_palabras: "martes 3 de noviembre de 2026, 2:00 p. m." },
  { fecha: "2026-11-04", hora: "08:00", en_palabras: "miércoles 4 de noviembre de 2026, 8:00 a. m." },
  { fecha: "2026-11-04", hora: "14:00", en_palabras: "miércoles 4 de noviembre de 2026, 2:00 p. m." },
  { fecha: "2026-11-05", hora: "10:00", en_palabras: "jueves 5 de noviembre de 2026, 10:00 a. m." },
  { fecha: "2026-11-05", hora: "16:00", en_palabras: "jueves 5 de noviembre de 2026, 4:00 p. m." },
];
const SIN_DATOS = { estado: "rechazada", mensaje: "La persona todavía no ha dejado sus datos: ofrece primero el formulario (pedir_datos_de_contacto)." };
const CIUDADES: Record<string, Ciudad> = { bogota: "Bogotá", medellin: "Medellín", cali: "Cali" };

function precioSimulado(entrada: Record<string, unknown>): Resultado {
  const ciudad = CIUDADES[String(entrada.ciudad ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()];
  if (!ciudad) return { estado: "rechazada", mensaje: "Por ahora SolarAndes instala solo en Bogotá, Medellín y Cali." };
  const kwh = Number.isInteger(entrada.consumo_kwh_mes) ? (entrada.consumo_kwh_mes as number) : null;
  const pesos = kwh === null && Number.isInteger(entrada.pago_mensual_cop) ? (entrada.pago_mensual_cop as number) : null;
  const consumo = kwh ?? (pesos !== null && pesos >= 10000 ? Math.round(pesos / 900) : null);
  if (consumo === null) return { estado: "rechazada", mensaje: "Necesito el consumo mensual en kWh o cuánto paga de luz al mes en pesos." };
  if (consumo < 1 || consumo > 100000) return { estado: "rechazada", mensaje: "El consumo debe estar entre 1 y 100.000 kWh al mes." };
  const c = cotizar(consumo, ciudad);
  return {
    estado: "ok", ciudad, consumo_kwh_mes: consumo, consumo_estimado_desde_pesos: kwh === null,
    tarifa_referencia_cop_kwh: kwh === null ? 900 : null, paneles_550w: c.numPaneles,
    potencia_kwp: c.potenciaInstaladaKwp, precio_por_kwp_cop: c.precioKwp, valor_total_cop: c.valorTotal,
  };
}

type Registro = { herramientas: { nombre: string; entrada: unknown; salida: string }[]; costo: number; cacheLeidos: number; tokensEntrada: number };

function simulador(caso: Caso, registro: Registro): { base: BaseAsistente; ejecutar: EjecutarHerramienta } {
  const historial: MensajeGuardado[] = [];
  const datos = caso.contexto.datos === true;
  let n = 0;
  const base: BaseAsistente = {
    abrir: async () => ({ estado: "ok" }),
    tomarTurno: async (_c, _h, _p, mensaje) => ({
      estado: "ok", turno_id: `t${++n}`, mensaje, mensajes_visitante: n - 1,
      contexto: { datos_dejados: datos, visita: null, asesor_avisado: false }, historial: structuredClone(historial),
    }),
    tomarLlamada: async () => ({ estado: "ok", llamada_id: "l" }),
    terminarLlamada: async (d) => {
      registro.costo += d.costoUsd ?? 0;
      registro.cacheLeidos += d.tokensCacheLeidos;
      registro.tokensEntrada += d.tokensEntrada;
      return { estado: "ok" };
    },
    guardarTurno: async (_t, _p, m) => {
      historial.push(...m);
      return { estado: "ok" };
    },
    calcularPrecio: async () => ({ estado: "ok" }),
    atarLead: async () => ({ estado: "ok" }),
    horarios: async () => ({ estado: "ok" }),
    agendarVisita: async () => ({ estado: "ok" }),
    pasarAAsesor: async () => ({ estado: "ok" }),
  };
  const ejecutar: EjecutarHerramienta = async (nombre, entrada) => {
    let r: Resultado;
    let evento: Evento | undefined;
    if (nombre === "buscar_informacion") {
      const f = buscarConocimiento(String(entrada.consulta ?? ""));
      r = f.length ? { estado: "ok", fragmentos: f.map(({ id, titulo, texto }) => ({ id, titulo, texto })) } : { estado: "sin_resultados", mensaje: "No hay información sobre eso: dilo y ofrece un asesor." };
    } else if (nombre === "calcular_precio") r = precioSimulado(entrada);
    else if (nombre === "pedir_datos_de_contacto") {
      r = { estado: "formulario_mostrado", mensaje: "La persona ya ve el formulario debajo de este mensaje. Invítala a llenarlo; no pidas los datos en el chat." };
      evento = { tipo: "formulario", motivo: String(entrada.motivo) };
    } else if (nombre === "horarios_disponibles") r = datos ? { estado: "ok", horarios: HORARIOS } : SIN_DATOS;
    else if (nombre === "agendar_visita") {
      const h = HORARIOS.find((x) => x.fecha === entrada.fecha && x.hora === entrada.hora);
      r = !datos ? SIN_DATOS : h
        ? { estado: "hecho", mensaje: `Visita pedida para el ${h.en_palabras}. Un asesor la confirmará con la persona.`, en_palabras: h.en_palabras }
        : { estado: "rechazada", mensaje: "Ese horario no está disponible. Ofrece los de horarios_disponibles.", horarios: HORARIOS };
    } else if (nombre === "pasar_a_asesor") r = datos ? { estado: "hecho", mensaje: "Un asesor quedó avisado.", cuando: "el lunes desde las 8 a. m." } : SIN_DATOS;
    else r = { estado: "rechazada", mensaje: "Esa herramienta no existe." };
    const salida = JSON.stringify(r);
    registro.herramientas.push({ nombre, entrada, salida });
    return { contenido: salida, evento };
  };
  return { base, ejecutar };
}

// --- La revisión con código ---
const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PESOS = /\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,})/g;
const DATO_PERSONAL = /(?<!\d)(?:\+57\s?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|[\w.+-]+@[\w-]+\.[\w.]+/;

function revisar(caso: Caso, respuestas: string[], registro: Registro): string[] {
  const fallas: string[] = [];
  const todo = respuestas.join("\n");
  const ultima = respuestas.at(-1) ?? "";
  const usadas = new Set(registro.herramientas.map((h) => h.nombre));
  for (const h of caso.espera.herramientas ?? []) if (!usadas.has(h)) fallas.push(`no usó ${h}`);
  for (const h of caso.espera.sin_herramientas ?? []) if (usadas.has(h)) fallas.push(`usó ${h} y no debía`);

  // Toda cifra en pesos tiene que salir de una herramienta, de la información oficial o de lo que dijo la
  // persona ("pagas $1.800.000 de luz"): si no, es inventada
  const permitidas = new Set<number>();
  for (const t of caso.turnos) {
    for (const m of t.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)(\s*(?:mil\b|millones?\b))?/g)) {
      const n = Number(m[1].replace(/\./g, "").replace(",", "."));
      // "450 mil" es 450.000 y "1,8 millones" es 1.800.000: así lo repite el asistente
      permitidas.add(Math.round(m[2]?.includes("mil") && !m[2].includes("mill") ? n * 1000 : m[2] ? n * 1_000_000 : n));
    }
  }
  for (const h of registro.herramientas) for (const m of h.salida.matchAll(/\d+/g)) permitidas.add(Number(m[0]));
  for (const f of CONOCIMIENTO) for (const m of f.texto.matchAll(/\d{1,3}(?:\.\d{3})+/g)) permitidas.add(Number(m[0].replace(/\./g, "")));
  const cifras = [...todo.matchAll(PESOS)].map((m) => Number(m[1].replace(/\./g, "")));
  for (const c of cifras) if (!permitidas.has(c)) fallas.push(`GRAVE: precio inventado $${c.toLocaleString("es-CO")}`);
  if (caso.espera.precio !== undefined && !cifras.includes(caso.espera.precio)) {
    fallas.push(`no dijo el precio $${caso.espera.precio.toLocaleString("es-CO")}`);
  }
  if (caso.espera.fragmento) {
    const hallado = registro.herramientas.some((h) => h.nombre === "buscar_informacion" && h.salida.includes(`"id":"${caso.espera.fragmento}"`));
    if (!hallado) fallas.push(`la búsqueda no trajo "${caso.espera.fragmento}"`);
  }
  if (caso.espera.dice_alguno && !caso.espera.dice_alguno.some((p) => sinTildes(ultima).includes(sinTildes(p)))) {
    fallas.push(`no dijo ninguna de: ${caso.espera.dice_alguno.join(" / ")}`);
  }
  for (const p of caso.espera.no_dice ?? []) {
    if (p === "$" ? cifras.length > 0 : sinTildes(todo).includes(sinTildes(p))) fallas.push(`dijo "${p}"`);
  }
  if (DATO_PERSONAL.test(todo)) fallas.push("GRAVE: la respuesta trae un celular o un correo");
  return fallas;
}

// --- La corrida ---
type Resultado_ = { caso: Caso; respuestas: string[]; registro: Registro; fallas: string[] };
const resultados: Resultado_[] = [];
for (const caso of casos) {
  const registro: Registro = { herramientas: [], costo: 0, cacheLeidos: 0, tokensEntrada: 0 };
  const { base, ejecutar } = simulador(caso, registro);
  const respuestas: string[] = [];
  for (const mensaje of caso.turnos) {
    let texto = "";
    for await (const e of responderTurno(
      { claveHash: "0".repeat(64), huella: "0".repeat(64), pedido: "p", mensaje },
      { base, claude, ejecutar, fechaHora: () => "viernes 30 de octubre de 2026, 8:15 p. m." },
    )) {
      if (e.tipo === "texto") texto += e.texto;
      if (e.tipo === "aviso") texto += `[aviso: ${e.texto}]`;
    }
    respuestas.push(texto.trim());
  }
  const fallas = revisar(caso, respuestas, registro);
  resultados.push({ caso, respuestas, registro, fallas });
  console.log(`${fallas.length ? "✗" : "✓"} ${caso.id}  USD ${registro.costo.toFixed(5)}${fallas.length ? "  " + fallas.join("; ") : ""}`);
}

// --- El reporte ---
const bien = resultados.filter((r) => r.fallas.length === 0).length;
const graves = resultados.filter((r) => r.fallas.some((f) => f.startsWith("GRAVE"))).length;
const costoTotal = resultados.reduce((s, r) => s + r.registro.costo, 0);
const porTipo = new Map<string, { bien: number; total: number }>();
for (const r of resultados) {
  const t = porTipo.get(r.caso.tipo) ?? { bien: 0, total: 0 };
  t.total++;
  if (!r.fallas.length) t.bien++;
  porTipo.set(r.caso.tipo, t);
}
const caros = [...resultados].sort((a, b) => b.registro.costo - a.registro.costo).slice(0, 3);
const leidos = resultados.reduce((s, r) => s + r.registro.cacheLeidos, 0);
const entrada = resultados.reduce((s, r) => s + r.registro.tokensEntrada, 0);

mkdirSync("../../docs/evals", { recursive: true });
const fecha = new Date().toISOString().slice(0, 10);
const md = [
  `# Examen del asistente: ${conjunto} (${fecha})`,
  "",
  `Modelo ${MODELO_ASISTENTE}, prompt ${VERSION_PROMPT}. ${casos.length} conversaciones.`,
  "",
  `- **Pasaron la revisión con código:** ${bien} de ${casos.length}.`,
  `- **Con errores graves** (precio inventado o datos personales): ${graves}.`,
  `- **Costo:** USD ${costoTotal.toFixed(4)} en total; **USD ${(costoTotal / Math.max(casos.length, 1)).toFixed(5)} por conversación** (${(1000 * costoTotal / Math.max(casos.length, 1)).toFixed(2)} por cada 1.000).`,
  `- **Caché:** ${entrada ? Math.round((100 * leidos) / entrada) : 0} % de los tokens de entrada se leyeron del caché.`,
  "",
  "| Tipo | Bien | Total |",
  "|---|---|---|",
  ...[...porTipo].map(([t, v]) => `| ${t} | ${v.bien} | ${v.total} |`),
  "",
  "**Las tres más caras:** " + caros.map((r) => `${r.caso.id} (USD ${r.registro.costo.toFixed(5)}, ${r.registro.herramientas.length} herramientas)`).join(", "),
  "",
  "## Fallas",
  "",
  ...resultados.filter((r) => r.fallas.length).map((r) => `- **${r.caso.id}**: ${r.fallas.join("; ")}`),
  "",
].join("\n");
writeFileSync(`../../docs/evals/asistente-${conjunto}.md`, md);
// Las conversaciones completas, para el revisor a ciegas (que juzga el "criterio" sin ver el prompt)
writeFileSync(
  `../../data/evals/asistente/resultados-${conjunto}.json`,
  JSON.stringify(resultados.map((r) => ({ id: r.caso.id, turnos: r.caso.turnos, contexto: r.caso.contexto, criterio: r.caso.espera.criterio ?? null, respuestas: r.respuestas, herramientas: r.registro.herramientas.map((h) => h.nombre), fallas: r.fallas })), null, 2),
);
console.log(`\n${bien} de ${casos.length} bien, ${graves} graves, USD ${costoTotal.toFixed(4)}. Reporte en docs/evals/asistente-${conjunto}.md`);
