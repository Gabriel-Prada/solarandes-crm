import type { Metadata } from "next";

import { formatoFechaHora, formatoTelefono } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import type { VisitaTecnico } from "@/lib/tipos";

export const metadata: Metadata = { title: "Mis visitas" };

// Pensada para el celular del técnico: tarjetas en una columna, con teléfono y dirección a mano.
export default async function PaginaVisitas() {
  await exigirRol("tecnico");

  // La vista visitas_tecnico ya trae solo lo suyo y solo las columnas que necesita
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase
    .from("visitas_tecnico")
    .select("*")
    .order("fecha", { ascending: true })
    .returns<VisitaTecnico[]>();
  const visitas = data ?? [];

  const pendientes = visitas.filter((v) => !v.completada);
  const realizadas = visitas.filter((v) => v.completada).reverse().slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Mis visitas</h1>
        <p className="text-sm text-stone-500">
          {pendientes.length} {pendientes.length === 1 ? "pendiente" : "pendientes"}
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            No se pudieron cargar tus visitas. Revisa tu conexión e intenta de nuevo.
          </p>
        )}
        {pendientes.map((v) => (
          <TarjetaVisita key={v.id} visita={v} />
        ))}
        {pendientes.length === 0 && !error && <p className="text-stone-500">No tienes visitas pendientes.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Últimas realizadas</h2>
        {realizadas.map((v) => (
          <TarjetaVisita key={v.id} visita={v} />
        ))}
      </section>
    </div>
  );
}

function TarjetaVisita({ visita: v }: { visita: VisitaTecnico }) {
  return (
    <article
      className={`rounded-2xl border bg-white p-4 ${v.completada ? "border-stone-200 opacity-70" : "border-amber-200"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{v.empresa ?? v.cliente}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            v.tipo === "visita" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"
          }`}
        >
          {v.tipo === "visita" ? "Visita técnica" : "Instalación"}
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-600 first-letter:uppercase">{formatoFechaHora(v.fecha)}</p>
      <p className="mt-2 text-sm">{v.descripcion}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
        <a href={`tel:${v.telefono}`} className="font-medium text-amber-700 hover:underline">
          {formatoTelefono(v.telefono)}
        </a>
        <span>{[v.direccion, v.ciudad].filter(Boolean).join(", ")}</span>
      </div>
    </article>
  );
}
