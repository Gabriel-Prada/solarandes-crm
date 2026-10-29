import "server-only";

import { regresoPermitido } from "@/lib/oauth/regreso";
import { obtenerPerfil } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

const opcionesDeRegreso = () => ({ permitirInspector: process.env.MCP_PERMITIR_INSPECTOR === "si" });

/**
 * La solicitud de autorización si se puede decidir: la gerente, una solicitud vigente y una app que
 * devuelve la llave a una dirección de la lista blanca. La usan la página (para mostrarla) y la acción
 * (para volver a revisarla al apretar el botón: lo que manda el formulario no es de fiar).
 * Vive aparte de acciones.ts porque todo lo que exporta un archivo "use server" se puede llamar desde afuera.
 */
export async function revisarSolicitud(authorizationId: string) {
  const perfil = await obtenerPerfil();
  if (perfil.rol !== "gerente") return { estado: "rol" as const };

  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return { estado: "vencida" as const };

  // Ya la había aprobado antes: Supabase devuelve directo la dirección de regreso con el código.
  // No trae el client_id, así que no se puede volver a anotar en la lista de apps aprobadas: si la app
  // se quitó de la lista, el MCP la sigue rechazando hasta que se le quite el permiso en Supabase y la
  // gerente la apruebe de nuevo aquí (docs/plan-fase-5.md, migración 023).
  if (!("authorization_id" in data)) {
    const regreso = new URL(data.redirect_url);
    if (!regresoPermitido(`${regreso.origin}${regreso.pathname}`, opcionesDeRegreso())) {
      return { estado: "no_permitida" as const, dominio: regreso.host };
    }
    return { estado: "ya_aprobada" as const, redirectUrl: data.redirect_url };
  }

  if (!regresoPermitido(data.redirect_uri, opcionesDeRegreso())) {
    return { estado: "no_permitida" as const, dominio: new URL(data.redirect_uri).host };
  }
  return { estado: "pendiente" as const, detalles: data, perfil };
}
