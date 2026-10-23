import type { Metadata } from "next";
import Link from "next/link";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

import { FormularioContacto } from "./formulario-contacto";

export const metadata: Metadata = { title: "Nuevo contacto" };

export default async function PaginaNuevoContacto() {
  const perfil = await exigirRol("gerente", "asesor");

  // Solo la gerente elige el asesor; un asesor siempre crea contactos a su nombre
  let asesores: { id: string; nombre: string; ciudad: string }[] = [];
  if (perfil.rol === "gerente") {
    const supabase = await crearClienteSupabase();
    const { data } = await supabase
      .from("perfiles")
      .select("id, nombre, ciudad")
      .eq("rol", "asesor")
      .eq("activo", true)
      .order("nombre");
    asesores = data ?? [];
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/contactos" className="text-sm text-stone-500 hover:text-stone-900">
        ← Contactos
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Nuevo contacto</h1>
        <p className="text-sm text-stone-500">
          Se crea también su primera venta en la etapa &quot;Nuevo&quot;, con un valor estimado según su consumo.
        </p>
      </header>
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <FormularioContacto asesores={asesores} ciudadPorDefecto={perfil.ciudad ?? "Bogotá"} />
      </div>
    </div>
  );
}
