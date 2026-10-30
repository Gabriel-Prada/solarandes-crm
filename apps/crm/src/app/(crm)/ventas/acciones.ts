"use server";

import { refresh } from "next/cache";

import { esResultado } from "@/lib/acciones-de-la-base";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import type { Etapa, MotivoPerdida } from "@/lib/tipos";

export async function moverOportunidad(
  oportunidadId: string,
  etapa: Etapa,
  motivo?: MotivoPerdida,
): Promise<{ error: string | null }> {
  await exigirRol("gerente", "asesor");

  // Las reglas (etapa válida, motivo obligatorio para "perdida", que la venta sea suya) viven en la base,
  // en la misma función que usa Claude por el MCP (migración 024). El resto lo hace el trigger: anota el
  // cambio en el historial, pone o quita la fecha de cierre y recalcula la probabilidad.
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase.rpc("mover_venta", {
    p_oportunidad: oportunidadId,
    p_etapa: etapa,
    p_motivo: etapa === "perdido" ? (motivo ?? null) : null,
  });

  if (error || !esResultado(data)) {
    return { error: "No se pudo mover la venta. Recarga la página e intenta de nuevo." };
  }
  if (data.estado === "rechazada") {
    return { error: data.mensaje };
  }
  refresh();
  return { error: null };
}
