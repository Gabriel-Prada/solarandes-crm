import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Panel } from "@/lib/panel";
import type { FilaPrioridad } from "@/lib/prioridad";
import { CIUDADES, type Ciudad, type Etapa } from "@/lib/tipos";

import { esResultado, NO_SE_SI_QUEDO, type ResultadoAccion } from "./acciones";
import {
  LECTURA_MAXIMA,
  masOlvidadas,
  type ClienteBreve,
  type DatosFicha,
  type FilaAgenda,
  type FilaCotizacion,
  type FilaSeguimiento,
  type FilaVenta,
  type Miembro,
} from "./consultas";

/**
 * Las lecturas de la base del MCP (pieza 2). Todas con el cliente "en nombre" de la gerente
 * (clienteConLlave): la base aplica sus permisos (RLS) y la 023 impide escribir. Aquí no se calcula
 * nada: se lee de las mismas tablas, vistas y funciones que usan el panel, el tablero y n8n.
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

// Mensaje genérico para Claude; en el registro de Vercel solo el código del error, sin datos
function fallo(donde: string, error: { code?: string } | null): { ok: false; mensaje: string } {
  console.error(`MCP: falló ${donde}`, error?.code);
  return { ok: false, mensaje: "No pude leer el CRM. Intenta de nuevo en un momento." };
}

/**
 * Todo el equipo, también quien ya no está activo: los conteos por asesor deben coincidir con el panel,
 * que los cuenta a todos. Para elegir a alguien por su nombre, elegirAsesor solo mira a los activos.
 */
export async function leerEquipo(supabase: SupabaseClient): Promise<Resultado<Miembro[]>> {
  const { data, error } = await supabase.from("perfiles").select("id, nombre, rol, activo").order("codigo");
  if (error) return fallo("leer el equipo", error);
  return { ok: true, valor: (data ?? []) as Miembro[] };
}

/** Todo lo de un cliente. Que el código no exista y que no se pueda ver dan el mismo mensaje. */
export async function leerFicha(supabase: SupabaseClient, codigo: string): Promise<Resultado<DatosFicha>> {
  const { data: contacto, error } = await supabase
    .from("contactos")
    .select(
      "id, codigo, tipo, nombre, empresa, telefono, email, ciudad, direccion, estrato, consumo_kwh_mes, canal_origen, asesor:perfiles!contactos_asesor_id_fkey(nombre)",
    )
    .eq("codigo", codigo)
    .maybeSingle<DatosFicha["contacto"]>();
  if (error) return fallo("leer la ficha", error);
  if (!contacto) return { ok: false, mensaje: `No encontré el cliente ${codigo}.` };

  const [ventas, actividades, prioridades] = await Promise.all([
    supabase
      .from("oportunidades")
      .select("id, codigo, nombre, etapa, valor_cop, potencia_kwp, probabilidad, motivo_perdida")
      .eq("contacto_id", contacto.id)
      .order("creada_en", { ascending: false })
      .returns<DatosFicha["ventas"]>(),
    supabase
      .from("actividades")
      .select("tipo, descripcion, fecha, completada, oportunidad:oportunidades(codigo), usuario:perfiles(nombre)")
      .eq("contacto_id", contacto.id)
      .order("fecha", { ascending: false })
      .limit(LECTURA_MAXIMA)
      .returns<DatosFicha["actividades"]>(),
    supabase
      .from("prioridades_leads")
      .select("id, oportunidad_id, estado, prioridad, prioridad_asesor, resumen, creada_en")
      .eq("contacto_id", contacto.id)
      .returns<DatosFicha["prioridades"]>(),
  ]);
  if (ventas.error) return fallo("leer las ventas de la ficha", ventas.error);
  if (actividades.error) return fallo("leer las actividades de la ficha", actividades.error);
  if (prioridades.error) return fallo("leer las prioridades de la ficha", prioridades.error);

  const idsVentas = (ventas.data ?? []).map((v) => v.id);
  let cotizaciones: DatosFicha["cotizaciones"] = [];
  if (idsVentas.length > 0) {
    const leidas = await supabase
      .from("cotizaciones")
      .select("numero, oportunidad_id, version, fecha, consumo_kwh_mes, potencia_kwp, num_paneles, descuento_pct, valor_total, estado")
      .in("oportunidad_id", idsVentas)
      .returns<DatosFicha["cotizaciones"]>();
    if (leidas.error) return fallo("leer las cotizaciones de la ficha", leidas.error);
    cotizaciones = leidas.data ?? [];
  }

  return {
    ok: true,
    valor: {
      contacto,
      ventas: ventas.data ?? [],
      actividades: actividades.data ?? [],
      prioridades: prioridades.data ?? [],
      cotizaciones,
    },
  };
}

export type FiltroVentas = { etapa?: Etapa; asesorId?: string; ciudad?: Ciudad };

/** Las ventas (abiertas, si no se pide una etapa), las más valiosas primero y las sin valor al final. */
export async function leerVentas(
  supabase: SupabaseClient,
  filtro: FiltroVentas,
): Promise<Resultado<{ filas: FilaVenta[]; prioridades: FilaPrioridad[] }>> {
  let consulta = supabase
    .from("oportunidades")
    .select(
      "id, codigo, nombre, etapa, valor_cop, probabilidad, asesor:perfiles!oportunidades_asesor_id_fkey(nombre), contacto:contactos!inner(codigo, nombre, empresa, ciudad)",
    );
  consulta = filtro.etapa ? consulta.eq("etapa", filtro.etapa) : consulta.not("etapa", "in", "(ganado,perdido)");
  if (filtro.asesorId) consulta = consulta.eq("asesor_id", filtro.asesorId);
  if (filtro.ciudad) consulta = consulta.eq("contacto.ciudad", filtro.ciudad);

  const [ventas, prioridades] = await Promise.all([
    consulta
      .order("valor_cop", { ascending: false, nullsFirst: false })
      .order("codigo")
      .limit(LECTURA_MAXIMA)
      .returns<FilaVenta[]>(),
    // Las más nuevas primero: si algún día pasan de 1000, las que quedan por fuera son las viejas, y de
    // cada venta solo importa la última (ultimaPorVenta)
    supabase
      .from("prioridades_leads")
      .select("id, oportunidad_id, estado, prioridad, prioridad_asesor, creada_en")
      .not("oportunidad_id", "is", null)
      .order("creada_en", { ascending: false })
      .limit(LECTURA_MAXIMA)
      .returns<FilaPrioridad[]>(),
  ]);
  if (ventas.error) return fallo("leer las ventas", ventas.error);
  if (prioridades.error) return fallo("leer las prioridades", prioridades.error);
  return { ok: true, valor: { filas: ventas.data ?? [], prioridades: prioridades.data ?? [] } };
}

/** Las ventas con 3 días o más sin actividad, según la vista seguimiento_ventas (la regla única). */
export async function leerSeguimiento(
  supabase: SupabaseClient,
  asesorId?: string,
): Promise<Resultado<{ filas: FilaSeguimiento[]; clientes: Map<string, ClienteBreve> }>> {
  let consulta = supabase.from("seguimiento_ventas").select("codigo, contacto_id, asesor_id, etapa, dias").gte("dias", 3);
  if (asesorId) consulta = consulta.eq("asesor_id", asesorId);
  const { data, error } = await consulta.limit(LECTURA_MAXIMA).returns<FilaSeguimiento[]>();
  if (error) return fallo("leer el seguimiento", error);

  const filas = data ?? [];
  const ids = [...new Set(masOlvidadas(filas).map((f) => f.contacto_id))];
  const clientes = new Map<string, ClienteBreve>();
  if (ids.length > 0) {
    const leidos = await supabase
      .from("contactos")
      .select("id, codigo, nombre, empresa, ciudad")
      .in("id", ids)
      .returns<(ClienteBreve & { id: string })[]>();
    if (leidos.error) return fallo("leer los clientes del seguimiento", leidos.error);
    for (const c of leidos.data ?? []) clientes.set(c.id, c);
  }
  return { ok: true, valor: { filas, clientes } };
}

export async function leerPanel(supabase: SupabaseClient): Promise<Resultado<Panel>> {
  const { data, error } = await supabase.rpc("panel_gerente");
  if (error || !data) return fallo("leer el panel", error);
  return { ok: true, valor: data as Panel };
}

/** Visitas y tareas del rango (el servidor deja solo las de los técnicos: consultas.agendaTecnica). */
export async function leerAgenda(
  supabase: SupabaseClient,
  rango: { inicio: string; finExclusivo: string },
): Promise<Resultado<FilaAgenda[]>> {
  const { data, error } = await supabase
    .from("actividades")
    .select(
      "tipo, descripcion, fecha, completada, usuario:perfiles(nombre, rol), contacto:contactos(codigo, nombre, empresa, ciudad), oportunidad:oportunidades(codigo)",
    )
    .in("tipo", ["visita", "tarea"])
    .gte("fecha", rango.inicio)
    .lt("fecha", rango.finExclusivo)
    .order("fecha")
    .limit(LECTURA_MAXIMA)
    .returns<FilaAgenda[]>();
  if (error) return fallo("leer la agenda", error);
  return { ok: true, valor: data ?? [] };
}

/** El precio de referencia con la fórmula de la base. Si la base lo rechaza con su propio mensaje, pasa tal cual. */
export async function calcularPrecio(
  supabase: SupabaseClient,
  consumo: number,
  ciudad: Ciudad,
): Promise<Resultado<FilaCotizacion>> {
  const { data, error } = await supabase.rpc("calcular_cotizacion", { p_consumo: consumo, p_ciudad: ciudad, p_descuento: 0 });
  if (error?.code === "22023") return { ok: false, mensaje: error.message }; // dato inválido: el mensaje de la base sirve
  if (error) return fallo("calcular el precio", error);
  const fila = (Array.isArray(data) ? data[0] : data) as FilaCotizacion | undefined;
  if (!fila) return fallo("calcular el precio (sin resultado)", null);
  return { ok: true, valor: fila };
}

export type Producto = { sku: string; nombre: string; categoria: string; precio_cop: number };

export async function leerCatalogo(supabase: SupabaseClient): Promise<Resultado<Producto[]>> {
  const { data, error } = await supabase
    .from("productos")
    .select("sku, nombre, categoria, precio_cop")
    .eq("activo", true)
    .order("categoria")
    .order("nombre")
    .returns<Producto[]>();
  if (error) return fallo("leer el catálogo", error);
  return { ok: true, valor: data ?? [] };
}

// ---------------------------------------------------------------------------
// Pieza 3: lo que necesitan las acciones. Los códigos (C0153, O0153) se pasan a sus identificadores
// con la llave de la gerente (RLS); las reglas las aplican las funciones de la base (migración 024).
// ---------------------------------------------------------------------------

export type ClienteParaAccion = { id: string; codigo: string; nombre: string; empresa: string | null };
export type VentaParaAccion = { id: string; codigo: string; nombre: string; etapa: Etapa; contacto: ClienteParaAccion };

export async function clientePorCodigo(supabase: SupabaseClient, codigo: string): Promise<Resultado<ClienteParaAccion>> {
  const { data, error } = await supabase
    .from("contactos")
    .select("id, codigo, nombre, empresa")
    .eq("codigo", codigo)
    .maybeSingle<ClienteParaAccion>();
  if (error) return fallo("buscar el cliente", error);
  if (!data) return { ok: false, mensaje: `No encontré el cliente ${codigo}.` };
  return { ok: true, valor: data };
}

const COLUMNAS_VENTA = "id, codigo, nombre, etapa, contacto:contactos!inner(id, codigo, nombre, empresa)";

export async function ventaPorCodigo(supabase: SupabaseClient, codigo: string): Promise<Resultado<VentaParaAccion>> {
  const { data, error } = await supabase
    .from("oportunidades")
    .select(COLUMNAS_VENTA)
    .eq("codigo", codigo)
    .maybeSingle<VentaParaAccion>();
  if (error) return fallo("buscar la venta", error);
  if (!data) return { ok: false, mensaje: `No encontré la venta ${codigo}.` };
  return { ok: true, valor: data };
}

/** Las ventas abiertas de un cliente (para agendar con el código del cliente). */
export async function ventasAbiertasDe(supabase: SupabaseClient, contactoId: string): Promise<Resultado<VentaParaAccion[]>> {
  const { data, error } = await supabase
    .from("oportunidades")
    .select(COLUMNAS_VENTA)
    .eq("contacto_id", contactoId)
    .not("etapa", "in", "(ganado,perdido)")
    .order("creada_en", { ascending: false })
    .returns<VentaParaAccion[]>();
  if (error) return fallo("buscar las ventas del cliente", error);
  return { ok: true, valor: data ?? [] };
}

/** Llama a una de las tres acciones de la base. Sus rechazos llegan como resultado, no como error. */
export async function ejecutarAccion(
  supabase: SupabaseClient,
  funcion: "registrar_actividad" | "mover_venta" | "agendar_visita",
  parametros: Record<string, unknown>,
): Promise<Resultado<ResultadoAccion>> {
  const { data, error } = await supabase.rpc(funcion, parametros);
  if (error || !esResultado(data)) {
    // Puede que la base sí lo haya guardado y solo se perdió la respuesta: que Claude no repita a ciegas
    console.error(`MCP: falló ${funcion}`, error?.code);
    return { ok: false, mensaje: NO_SE_SI_QUEDO };
  }
  return { ok: true, valor: data };
}

export const CONSUMOS_DE_EJEMPLO = [150, 300, 500, 1000, 2000];

/** La tabla de ejemplos del resource de precios, calculada por la base en el momento. */
export async function tablaDePrecios(
  supabase: SupabaseClient,
): Promise<Resultado<{ consumo: number; ciudad: Ciudad; fila: FilaCotizacion }[]>> {
  const casos = CONSUMOS_DE_EJEMPLO.flatMap((consumo) => CIUDADES.map((ciudad) => ({ consumo, ciudad })));
  const resultados = await Promise.all(casos.map((c) => calcularPrecio(supabase, c.consumo, c.ciudad)));
  const filas = [];
  for (const [i, r] of resultados.entries()) {
    if (!r.ok) return r;
    filas.push({ ...casos[i], fila: r.valor });
  }
  return { ok: true, valor: filas };
}
