import { redirect } from "next/navigation";

import { obtenerPerfil } from "@/lib/sesion";
import { seccionesDe } from "@/lib/navegacion";

// El inicio lleva a la primera sección del rol. Quien aún no tiene secciones ve un aviso.
export default async function Inicio() {
  const perfil = await obtenerPerfil();
  const [primera] = seccionesDe(perfil.rol);
  if (primera) {
    redirect(primera.href);
  }

  return (
    <div className="max-w-lg rounded-2xl border border-stone-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Hola, {perfil.nombre.split(" ")[0]}</h1>
      <p className="mt-2 text-stone-600">
        Tu módulo de registro de facturas de proveedores llega en una próxima fase del proyecto.
      </p>
    </div>
  );
}
