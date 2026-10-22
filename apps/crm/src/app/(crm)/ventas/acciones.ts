"use server";

import { refresh } from "next/cache";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { ETAPAS, NOMBRE_MOTIVO, type Etapa, type MotivoPerdida } from "@/lib/tipos";

export async function moverOportunidad(
  oportunidadId: string,
  etapa: Etapa,
  motivo?: MotivoPerdida,
): Promise<{ error: string | null }> {
  await exigirRol("gerente", "asesor");

  if (!ETAPAS.includes(etapa)) {
    return { error: "Etapa no válida." };
  }
  // Object.hasOwn y no "in": "in" también aceptaría cosas heredadas como "toString"
  if (etapa === "perdido" && !(motivo && Object.hasOwn(NOMBRE_MOTIVO, motivo))) {
    return { error: "Para marcar una venta como perdida hay que indicar el motivo." };
  }

  // La base de datos se encarga del resto: anota el cambio en el historial, pone o quita la
  // fecha de cierre y recalcula la probabilidad. Los permisos impiden mover ventas ajenas.
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase
    .from("oportunidades")
    .update({ etapa, motivo_perdida: etapa === "perdido" ? motivo : null })
    .eq("id", oportunidadId)
    .select("id");

  if (error || !data?.length) {
    return { error: "No se pudo mover la venta. Recarga la página e intenta de nuevo." };
  }
  refresh();
  return { error: null };
}
