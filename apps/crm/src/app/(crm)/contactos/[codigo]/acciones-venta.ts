"use server";

import { refresh } from "next/cache";

import { esResultado } from "@/lib/acciones-de-la-base";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

export type EstadoAccionVenta = { error: string | null; mensaje: string | null; intentos: number };

export async function crearCotizacion(previo: EstadoAccionVenta, formulario: FormData): Promise<EstadoAccionVenta> {
  await exigirRol("gerente", "asesor");
  const fallo = (error: string) => ({ error, mensaje: null, intentos: previo.intentos + 1 });

  const consumo = Number(formulario.get("consumo"));
  const descuento = Number(formulario.get("descuento") ?? 0);
  if (!Number.isInteger(consumo) || consumo <= 0) return fallo("Escribe un consumo mayor que cero.");
  if (!(descuento >= 0 && descuento <= 30)) return fallo("El descuento debe estar entre 0 % y 30 %.");

  // Todo pasa en la base de datos en una sola operación (migración 007): calcula el precio con la
  // fórmula, numera la cotización, actualiza la venta y anota la actividad. Desde aquí no se manda
  // ningún precio: así nadie puede guardar un valor inventado, ni siquiera saltándose la app.
  const supabase = await crearClienteSupabase();
  const { data: numero, error } = await supabase.rpc("crear_cotizacion", {
    p_oportunidad_id: String(formulario.get("oportunidad_id") ?? ""),
    p_consumo: consumo,
    p_descuento: descuento,
  });

  if (error) {
    // La función explica qué pasó: venta cerrada, venta ajena, consumo o descuento fuera de rango
    const conocido = ["Venta no encontrada", "La venta ya está cerrada", "El consumo", "El descuento"].some((m) =>
      error.message.startsWith(m),
    );
    return fallo(conocido ? `${error.message}.` : "No se pudo guardar la cotización.");
  }

  refresh();
  return { error: null, mensaje: `Cotización ${numero} guardada.`, intentos: previo.intentos + 1 };
}

export async function agendarVisita(previo: EstadoAccionVenta, formulario: FormData): Promise<EstadoAccionVenta> {
  await exigirRol("gerente", "asesor");
  const fallo = (error: string) => ({ error, mensaje: null, intentos: previo.intentos + 1 });

  // El campo de fecha del navegador no trae zona horaria: se interpreta como hora de Colombia.
  // Una fecha vacía o inválida va como null y la base responde "Elige la fecha y hora de la visita".
  const fechaTexto = String(formulario.get("fecha") ?? "");
  const fecha = new Date(`${fechaTexto}:00-05:00`);

  // Las reglas (venta abierta y suya, fecha futura, técnico activo, la etapa que avanza a "visita
  // agendada") viven en la base, en la misma función que usa Claude por el MCP (migración 024)
  const oportunidadId = String(formulario.get("oportunidad_id") ?? "");
  if (!oportunidadId) return fallo("No se encontró la venta.");
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase.rpc("agendar_visita", {
    p_oportunidad: oportunidadId,
    p_fecha: fechaTexto && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : null,
    p_nota: String(formulario.get("nota") ?? ""),
  });
  if (error || !esResultado(data)) return fallo("No se pudo agendar la visita.");
  if (data.estado === "rechazada") return fallo(data.mensaje);

  refresh();
  return { error: null, mensaje: data.mensaje, intentos: previo.intentos + 1 };
}
