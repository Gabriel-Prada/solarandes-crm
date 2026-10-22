import { Logo } from "@/components/logo";
import { obtenerPerfil } from "@/lib/sesion";
import { seccionesDe } from "@/lib/navegacion";
import { NOMBRE_ROL } from "@/lib/tipos";

import { cerrarSesion } from "../login/acciones";
import { EnlaceMenu } from "./enlace-menu";

// Estructura común de todas las páginas del CRM: menú lateral (arriba en el celular) y contenido.
export default async function LayoutCrm({ children }: LayoutProps<"/">) {
  const perfil = await obtenerPerfil();
  const secciones = seccionesDe(perfil.rol);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-stone-200 bg-white p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold">SolarAndes</span>
        </div>

        <nav className="flex gap-1 md:flex-col">
          {secciones.map((s) => (
            <EnlaceMenu key={s.href} href={s.href}>
              {s.nombre}
            </EnlaceMenu>
          ))}
        </nav>

        <div className="flex items-center justify-between gap-2 md:mt-auto md:flex-col md:items-start">
          <div className="text-sm">
            <p className="font-medium">{perfil.nombre}</p>
            <p className="text-stone-500">
              {NOMBRE_ROL[perfil.rol]}
              {perfil.ciudad ? ` · ${perfil.ciudad}` : ""}
            </p>
          </div>
          <form action={cerrarSesion}>
            <button type="submit" className="text-sm text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      {/* min-w-0: sin esto, una tabla ancha estira toda la página en vez de desplazarse sola */}
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
