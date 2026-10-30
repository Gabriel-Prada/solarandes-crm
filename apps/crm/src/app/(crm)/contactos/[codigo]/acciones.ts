"use server";

import { refresh } from "next/cache";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { esResultado } from "@/lib/acciones-de-la-base";
import { PRIORIDADES } from "@/lib/prioridad";

export type ValoresActividad = { tipo: string; oportunidad_id: string; descripcion: string; fecha: string };

export type EstadoFormulario = {
  error: string | null;
  guardadas: number;
  intentos: number;
  // Lo que escribió la persona, para devolvérselo si hubo un error (el formulario se vacía al enviarse)
  valores: ValoresActividad | null;
};

export async function registrarActividad(previo: EstadoFormulario, formulario: FormData): Promise<EstadoFormulario> {
  // Se vuelve a verificar quién es: una acción del servidor se puede llamar sin pasar por la página
  await exigirRol("gerente", "asesor");

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

  // El campo de fecha del navegador no trae zona horaria: se interpreta como hora de Colombia.
  // Una fecha vacía o inválida va como null y la base responde "Elige la fecha y hora de la tarea".
  const fecha = new Date(`${valores.fecha}:00-05:00`);
  const fechaTarea = valores.tipo === "tarea" && valores.fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : null;

  // Las reglas (tipos, descripción, que la venta sea del contacto y de quien anota, permisos) viven en la
  // base, en la misma función que usa Claude por el MCP (migración 024): una sola regla para los dos
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase.rpc("registrar_actividad", {
    p_contacto: contactoId,
    p_oportunidad: valores.oportunidad_id || null,
    p_tipo: valores.tipo,
    p_descripcion: valores.descripcion,
    p_fecha: fechaTarea,
  });
  if (error || !esResultado(data)) {
    return conError("No se pudo guardar la actividad. Intenta de nuevo.");
  }
  if (data.estado === "rechazada") {
    return conError(data.mensaje);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El asesor (o la gerente) cambia la prioridad que dio la IA, o vuelve a la de la regla ("regla").
 * Quién y cuándo los anota la base (cambiar_prioridad, migración 020), que también revisa que el contacto
 * sea suyo: aquí solo se valida que el valor sea uno de los permitidos.
 */
export async function cambiarPrioridad(calificacionId: string, valor: string): Promise<{ error: string | null }> {
  await exigirRol("gerente", "asesor");
  if (!UUID.test(calificacionId)) return { error: "No se encontró la calificación." };
  if (valor !== "regla" && !(PRIORIDADES as string[]).includes(valor)) return { error: "Elige una prioridad." };

  const supabase = await crearClienteSupabase();
  const { error } = await supabase.rpc("cambiar_prioridad", {
    p_calificacion: calificacionId,
    p_prioridad: valor === "regla" ? null : valor,
  });
  if (error) {
    return { error: error.code === "42501" ? "No puedes cambiar la prioridad de este contacto." : "No se pudo cambiar la prioridad. Intenta de nuevo." };
  }
  refresh();
  return { error: null };
}
