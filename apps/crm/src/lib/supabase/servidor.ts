import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para el servidor, "en nombre" de la persona que inició sesión.
 * Lee su sesión de las cookies, así que la base de datos aplica sus permisos (RLS).
 */
export async function crearClienteSupabase() {
  const almacenCookies = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return almacenCookies.getAll();
        },
        setAll(cookiesNuevas) {
          try {
            for (const { name, value, options } of cookiesNuevas) {
              almacenCookies.set(name, value, options);
            }
          } catch {
            // Al mostrar una página no se pueden escribir cookies. No pasa nada:
            // el proxy ya renovó la sesión antes de llegar aquí.
          }
        },
      },
    },
  );
}
