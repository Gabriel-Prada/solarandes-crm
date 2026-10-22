import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { crearClienteSupabase } from "@/lib/supabase/servidor";
import type { Perfil, Rol } from "@/lib/tipos";

/**
 * Quién está conectado y con qué rol. Si no hay sesión válida, manda a /login.
 * cache() hace que, aunque varias partes de la página lo pidan, se consulte una sola vez.
 */
export const obtenerPerfil = cache(async (): Promise<Perfil> => {
  const supabase = await crearClienteSupabase();
  const { data } = await supabase.auth.getClaims();
  const usuarioId = data?.claims?.sub;
  if (!usuarioId) {
    redirect("/login");
  }

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, codigo, nombre, email, rol, ciudad")
    .eq("id", usuarioId)
    .single<Perfil>();
  if (!perfil) {
    // Tiene sesión pero no perfil: hay que cerrar la sesión antes de ir a /login (ver /salir)
    redirect("/salir");
  }
  return perfil;
});

/** Para el inicio de cada página: si el rol no tiene acceso, vuelve al inicio. */
export async function exigirRol(...roles: Rol[]): Promise<Perfil> {
  const perfil = await obtenerPerfil();
  if (!roles.includes(perfil.rol)) {
    redirect("/");
  }
  return perfil;
}
