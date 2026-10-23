"use server";

import { refresh } from "next/cache";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { ETAPAS, type Etapa } from "@/lib/tipos";

export type EstadoAccionVenta = { error: string | null; mensaje: string | null; intentos: number };

// Una venta "avanza sola" hasta una etapa solo si todavía no ha pasado por ella
function etapaAnteriorA(actual: Etapa, destino: Etapa): boolean {
  return ETAPAS.indexOf(actual) < ETAPAS.indexOf(destino);
}

async function oportunidadAbierta(oportunidadId: string) {
  // Los permisos (RLS) hacen que solo se encuentre si es de quien está conectado (o si es la gerente)
  const supabase = await crearClienteSupabase();
  const { data } = await supabase
    .from("oportunidades")
    .select("id, etapa, contacto_id")
    .eq("id", oportunidadId)
    .maybeSingle<{ id: string; etapa: Etapa; contacto_id: string }>();
  if (!data) return { supabase, oportunidad: null, error: "No se encontró la venta." };
  if (data.etapa === "ganado" || data.etapa === "perdido") {
    return { supabase, oportunidad: null, error: "La venta ya está cerrada." };
  }
  return { supabase, oportunidad: data, error: null };
}

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

  // El campo de fecha del navegador no trae zona horaria: se interpreta como hora de Colombia
  const fechaTexto = String(formulario.get("fecha") ?? "");
  const fecha = new Date(`${fechaTexto}:00-05:00`);
  if (!fechaTexto || Number.isNaN(fecha.getTime())) return fallo("Elige la fecha y hora de la visita.");
  if (fecha.getTime() < Date.now()) return fallo("La visita debe ser en el futuro.");
  const nota = String(formulario.get("nota") ?? "").trim().slice(0, 300);

  const { supabase, oportunidad, error } = await oportunidadAbierta(String(formulario.get("oportunidad_id") ?? ""));
  if (!oportunidad) return fallo(error ?? "No se encontró la venta.");

  const { data: tecnico } = await supabase
    .from("perfiles")
    .select("id")
    .eq("rol", "tecnico")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (!tecnico) return fallo("No hay un técnico activo para asignar la visita.");

  // La visita queda asignada al técnico: le aparece en "Mis visitas" (vista visitas_tecnico)
  const { error: errorVisita } = await supabase.from("actividades").insert({
    contacto_id: oportunidad.contacto_id,
    oportunidad_id: oportunidad.id,
    usuario_id: tecnico.id,
    tipo: "visita",
    descripcion: nota || "Visita técnica: revisar techo, sombras y tablero eléctrico.",
    fecha: fecha.toISOString(),
    completada: false,
  });
  if (errorVisita) return fallo("No se pudo agendar la visita.");

  if (etapaAnteriorA(oportunidad.etapa, "visita_agendada")) {
    await supabase.from("oportunidades").update({ etapa: "visita_agendada" }).eq("id", oportunidad.id);
  }

  refresh();
  return { error: null, mensaje: "Visita agendada y asignada al técnico.", intentos: previo.intentos + 1 };
}
