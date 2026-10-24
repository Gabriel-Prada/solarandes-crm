import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * El "portero" del CRM. Corre antes de cada página:
 * 1. Renueva la sesión de Supabase si está por vencer (y guarda las cookies nuevas).
 * 2. Si no hay sesión, manda a /login. Si ya hay sesión y se abre /login, manda al inicio.
 *
 * Es solo un primer filtro: los permisos de verdad los aplica la base de datos.
 */
export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesNuevas, cabeceras) {
          for (const { name, value } of cookiesNuevas) {
            request.cookies.set(name, value);
          }
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of cookiesNuevas) {
            respuesta.cookies.set(name, value, options);
          }
          for (const [clave, valor] of Object.entries(cabeceras ?? {})) {
            respuesta.headers.set(clave, valor);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const conSesion = Boolean(data?.claims);
  const enLogin = request.nextUrl.pathname.startsWith("/login");

  // Al redirigir hay que llevar las cookies que getClaims() acaba de renovar; si no, se pierde la sesión
  const redirigir = (ruta: string) => {
    const redireccion = NextResponse.redirect(new URL(ruta, request.url));
    for (const cookie of respuesta.cookies.getAll()) {
      redireccion.cookies.set(cookie);
    }
    return redireccion;
  };

  if (!conSesion && !enLogin) {
    return redirigir("/login");
  }
  if (conSesion && enLogin) {
    return redirigir("/");
  }
  return respuesta;
}

export const config = {
  // Todas las rutas menos los archivos estáticos (imágenes, íconos, estilos) y la puerta de las
  // automatizaciones: n8n no inicia sesión; esa puerta la protege su propia llave (route.ts)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/automatizaciones/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
