"use server";

import { refresh } from "next/cache";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import type { TipoActividad } from "@/lib/tipos";

export type ValoresActividad = { tipo: string; oportunidad_id: string; descripcion: string; fecha: string };

export type EstadoFormulario = {
  error: string | null;
  guardadas: number;
  intentos: number;
  // Lo que escribió la persona, para devolvérselo si hubo un error (el formulario se vacía al enviarse)
  valores: ValoresActividad | null;
};

const TIPOS_PERMITIDOS: TipoActividad[] = ["llamada", "whatsapp", "correo", "nota", "tarea"];

export async function registrarActividad(previo: EstadoFormulario, formulario: FormData): Promise<EstadoFormulario> {
  // Se vuelve a verificar quién es: una acción del servidor se puede llamar sin pasar por la página
  const perfil = await exigirRol("gerente", "asesor");

  const contactoId = String(formulario.get("contacto_id") ?? "");
  const valores: ValoresActividad = {
    tipo: String(formulario.get("tipo") ?? ""),
    oportunidad_id: String(formulario.get("oportunidad_id") ?? ""),
    descripcion: String(formulario.get("descripcion") ?? "").trim(),
    fecha: String(formulario.get("fecha") ?? ""),
  };
  const conError = (error: string): EstadoFormulario => ({
    ...previo,
    error,
    intentos: previo.intentos + 1,
    valores,
  });

  const tipo = valores.tipo as TipoActividad;
  if (!TIPOS_PERMITIDOS.includes(tipo)) {
    return conError("Elige un tipo de actividad.");
  }
  if (valores.descripcion.length < 3 || valores.descripcion.length > 500) {
    return conError("Escribe una descripción de entre 3 y 500 caracteres.");
  }

  let fecha = new Date();
  if (tipo === "tarea") {
    // El campo de fecha del navegador no trae zona horaria: se interpreta como hora de Colombia
    fecha = new Date(`${valores.fecha}:00-05:00`);
    if (!valores.fecha || Number.isNaN(fecha.getTime())) {
      return conError("Elige la fecha y hora de la tarea.");
    }
  }

  const supabase = await crearClienteSupabase();
  const oportunidadId = valores.oportunidad_id || null;

  if (oportunidadId) {
    const { data: oportunidad } = await supabase
      .from("oportunidades")
      .select("id")
      .eq("id", oportunidadId)
      .eq("contacto_id", contactoId)
      .maybeSingle();
    if (!oportunidad) {
      return conError("Esa venta no pertenece a este contacto.");
    }
  }

  // Los permisos (RLS) impiden registrar actividades en contactos de otro asesor
  const { error } = await supabase.from("actividades").insert({
    contacto_id: contactoId,
    oportunidad_id: oportunidadId,
    usuario_id: perfil.id,
    tipo,
    descripcion: valores.descripcion,
    fecha: fecha.toISOString(),
    completada: tipo !== "tarea", // una tarea queda pendiente; lo demás ya ocurrió
  });
  if (error) {
    return conError("No se pudo guardar la actividad. Intenta de nuevo.");
  }

  refresh();
  return { error: null, guardadas: previo.guardadas + 1, intentos: previo.intentos + 1, valores: null };
}

export async function completarActividad(actividadId: string): Promise<{ error: string | null }> {
  await exigirRol("gerente", "asesor");
  const supabase = await crearClienteSupabase();
  // .select() devuelve las filas cambiadas: si no cambió ninguna (no existe o es ajena), se avisa
  const { data, error } = await supabase
    .from("actividades")
    .update({ completada: true })
    .eq("id", actividadId)
    .select("id");
  if (error || !data?.length) {
    return { error: "No se pudo marcar como hecha." };
  }
  refresh();
  return { error: null };
}
