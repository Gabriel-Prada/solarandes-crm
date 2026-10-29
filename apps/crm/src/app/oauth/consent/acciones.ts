"use server";

import { redirect } from "next/navigation";

import { crearClienteSupabase } from "@/lib/supabase/servidor";

import { revisarSolicitud } from "./solicitud";

/** Autorizar o rechazar la app. Vuelve a revisar todo: el formulario no es de fiar. */
export async function decidir(formulario: FormData) {
  const authorizationId = String(formulario.get("authorization_id") ?? "");
  const aprobar = formulario.get("decision") === "aprobar";
  const volver = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;

  const revision = await revisarSolicitud(authorizationId);
  if (revision.estado !== "pendiente") redirect(volver);

  const supabase = await crearClienteSupabase();
  if (aprobar) {
    // Primero queda en la lista de apps aprobadas (migración 023): el MCP solo acepta llaves de esas apps
    const { error: errorLista } = await supabase.rpc("aprobar_app", {
      p_client_id: revision.detalles.client.id,
      p_nombre: revision.detalles.client.name ?? "",
      p_dominio: new URL(revision.detalles.redirect_uri).host,
    });
    if (errorLista) {
      console.error("No se pudo anotar la app aprobada", errorLista.code);
      redirect(volver);
    }
  }
  const { data, error } = aprobar
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data) redirect(volver);
  redirect(data.redirect_url);
}
