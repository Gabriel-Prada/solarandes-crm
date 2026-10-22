import { NextResponse, type NextRequest } from "next/server";

import { crearClienteSupabase } from "@/lib/supabase/servidor";

/**
 * Cierra la sesión y lleva a /login con un aviso. Se usa cuando alguien tiene sesión
 * pero no tiene perfil en el CRM: sin esto, /login y / se redirigirían entre sí sin fin.
 */
export async function GET(request: NextRequest) {
  const supabase = await crearClienteSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?aviso=sin-perfil", request.url));
}
