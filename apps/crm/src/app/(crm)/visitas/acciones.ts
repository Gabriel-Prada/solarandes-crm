"use server";

import { refresh } from "next/cache";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

export async function marcarVisitaHecha(actividadId: string): Promise<{ error: string | null }> {
  await exigirRol("tecnico");
  const supabase = await crearClienteSupabase();
  // Los permisos (RLS) solo le dejan marcar las actividades asignadas a él
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
