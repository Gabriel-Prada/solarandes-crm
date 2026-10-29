"use server";

import { redirect } from "next/navigation";

import { rutaDeRegreso } from "@/lib/oauth/regreso";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

// Se devuelve el correo para volver a mostrarlo si hubo error (el formulario se limpia al enviarse)
export type EstadoLogin = { error: string | null; email: string };

export async function iniciarSesion(_previo: EstadoLogin, formulario: FormData): Promise<EstadoLogin> {
  const email = String(formulario.get("email") ?? "").trim().toLowerCase();
  const password = String(formulario.get("password") ?? "");
  if (!email || !password) {
    return { error: "Escribe tu correo y tu contraseña.", email };
  }

  const supabase = await crearClienteSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Mensaje genérico a propósito: no revela si el correo existe o no
    return { error: "Correo o contraseña incorrectos.", email };
  }
  // Si venía de autorizar una app (fase 5), vuelve allá; a ninguna otra parte (ver rutaDeRegreso)
  redirect(rutaDeRegreso(formulario.get("volver")) ?? "/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
