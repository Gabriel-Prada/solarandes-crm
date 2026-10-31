import "server-only";

import postgres from "postgres";

/**
 * La conexión del asistente a la base de datos, con su PROPIO usuario (asistente_web), no con la llave
 * pública ni con la de servicio. Ese usuario no puede leer ni escribir ninguna tabla: solo ejecutar las
 * funciones asistente_* (migraciones 025 y 026). Este archivo es la única puerta del asistente a la base, y
 * solo sabe llamar esas (docs/plan-fase-6.md, decisión 2).
 *
 * Se conecta por el "pooler" de Supabase en modo transacción (puerto 6543), pensado para servidores como
 * Vercel que abren y cierran muchas funciones: sin consultas preparadas y con una conexión por instancia.
 */

let conexion: postgres.Sql | null = null;

function sql(): postgres.Sql {
  if (conexion) return conexion;
  const host = process.env.ASISTENTE_DB_HOST;
  const usuario = process.env.ASISTENTE_DB_USUARIO;
  const clave = process.env.ASISTENTE_DB_CLAVE;
  if (!host || !usuario || !clave) throw new Error("Faltan ASISTENTE_DB_HOST, ASISTENTE_DB_USUARIO o ASISTENTE_DB_CLAVE");
  conexion = postgres({
    host,
    port: 6543,
    database: "postgres",
    username: usuario,
    password: clave,
    ssl: "require",
    prepare: false,
    max: 1,
    idle_timeout: 20,
    // Vercel congela la función entre pedidos y el pooler cierra las conexiones viejas: no se reutiliza una
    // conexión de más de 5 minutos
    max_lifetime: 5 * 60,
    connect_timeout: 10,
  });
  return conexion;
}

const CONEXION_PERDIDA = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "EPIPE"]);

/** Una consulta; si la conexión estaba muerta (la función despertó después de un rato), se reintenta una vez con otra. */
async function consultar<T>(consulta: (s: postgres.Sql) => Promise<T>): Promise<T> {
  try {
    return await consulta(sql());
  } catch (e) {
    if (!CONEXION_PERDIDA.has(String((e as { code?: string }).code))) throw e;
    const vieja = conexion;
    conexion = null;
    void vieja?.end({ timeout: 0 }).catch(() => undefined);
    return await consulta(sql());
  }
}

export type Resultado = { estado: string; motivo?: string; mensaje?: string; [campo: string]: unknown };

export type MensajeGuardado = { role: "user" | "assistant"; content: unknown[] };

/** Las puertas. Todas devuelven {estado, ...}: un tope alcanzado es una respuesta, no un error. */
export type BaseAsistente = {
  abrir(claveHash: string, huella: string, versionAviso: string): Promise<Resultado>;
  tomarTurno(claveHash: string, huella: string, pedido: string, mensaje: string, llamaClaude: boolean): Promise<Resultado>;
  tomarLlamada(turno: string, pedido: string, modelo: string): Promise<Resultado>;
  terminarLlamada(datos: {
    llamada: string;
    turno: string;
    resultado: "ok" | "rechazo" | "invalida" | "error";
    tokensEntrada: number;
    tokensSalida: number;
    tokensCacheLeidos: number;
    costoUsd: number | null;
    duracionMs: number;
    error: string | null;
  }): Promise<Resultado>;
  guardarTurno(turno: string, pedido: string, mensajes: MensajeGuardado[]): Promise<Resultado>;
  calcularPrecio(consumoKwh: number | null, facturaCop: number | null, ciudad: string): Promise<Resultado>;
  atarLead(claveHash: string, claveEnvio: string): Promise<Resultado>;
  horarios(turno: string, pedido: string, desde: string | null): Promise<Resultado>;
  agendarVisita(turno: string, pedido: string, fecha: string, hora: string): Promise<Resultado>;
  pasarAAsesor(turno: string, pedido: string, resumen: string, necesita: string): Promise<Resultado>;
};

export const baseAsistente: BaseAsistente = {
  async abrir(claveHash, huella, versionAviso) {
    const [fila] = await consultar((s) => s`select asistente_abrir(${claveHash}, ${huella}, ${versionAviso}) as r`);
    return fila.r as Resultado;
  },
  async tomarTurno(claveHash, huella, pedido, mensaje, llamaClaude) {
    const [fila] = await consultar((s) => s`
      select asistente_tomar_turno(${claveHash}, ${huella}, ${pedido}::uuid, ${mensaje}, ${llamaClaude}) as r`);
    return fila.r as Resultado;
  },
  async tomarLlamada(turno, pedido, modelo) {
    const [fila] = await consultar((s) => s`select asistente_tomar_llamada(${turno}::uuid, ${pedido}::uuid, ${modelo}) as r`);
    return fila.r as Resultado;
  },
  async terminarLlamada(d) {
    const [fila] = await consultar((s) => s`
      select asistente_terminar_llamada(
        ${d.llamada}::uuid, ${d.turno}::uuid, ${d.resultado}, ${d.tokensEntrada}::integer, ${d.tokensSalida}::integer,
        ${d.tokensCacheLeidos}::integer, ${d.costoUsd}::numeric, ${d.duracionMs}::integer, ${d.error}
      ) as r`);
    return fila.r as Resultado;
  },
  async guardarTurno(turno, pedido, mensajes) {
    const [fila] = await consultar((s) => s`
      select asistente_guardar_turno(${turno}::uuid, ${pedido}::uuid, ${s.json(mensajes as never)}) as r`);
    return fila.r as Resultado;
  },
  async calcularPrecio(consumoKwh, facturaCop, ciudad) {
    const [fila] = await consultar((s) => s`
      select asistente_calcular_precio(${consumoKwh}::integer, ${facturaCop}::bigint, ${ciudad}) as r`);
    return fila.r as Resultado;
  },
  async atarLead(claveHash, claveEnvio) {
    const [fila] = await consultar((s) => s`select asistente_atar_lead(${claveHash}, ${claveEnvio}) as r`);
    return fila.r as Resultado;
  },
  async horarios(turno, pedido, desde) {
    const [fila] = await consultar((s) => s`select asistente_horarios(${turno}::uuid, ${pedido}::uuid, ${desde}::date) as r`);
    return fila.r as Resultado;
  },
  async agendarVisita(turno, pedido, fecha, hora) {
    const [fila] = await consultar((s) => s`
      select asistente_agendar_visita(${turno}::uuid, ${pedido}::uuid, ${fecha}::date, ${hora}) as r`);
    return fila.r as Resultado;
  },
  async pasarAAsesor(turno, pedido, resumen, necesita) {
    const [fila] = await consultar((s) => s`
      select asistente_pasar_a_asesor(${turno}::uuid, ${pedido}::uuid, ${resumen}, ${necesita}) as r`);
    return fila.r as Resultado;
  },
};
