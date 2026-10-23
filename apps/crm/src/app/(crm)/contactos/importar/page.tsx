import type { Metadata } from "next";
import Link from "next/link";

import { exigirRol } from "@/lib/sesion";

import { FormularioImportar } from "./formulario-importar";

export const metadata: Metadata = { title: "Importar contactos" };

// Tiempo máximo en segundos, también para su acción del servidor: crear 500 contactos toma su rato
export const maxDuration = 60;

export default async function PaginaImportar() {
  await exigirRol("gerente");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/contactos" className="text-sm text-stone-500 hover:text-stone-900">
        ← Contactos
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Importar contactos</h1>
        <p className="max-w-3xl text-sm text-stone-500">
          Sube un CSV (por ejemplo, exportado de Excel). Antes de guardar verás qué pasará con cada fila: la limpieza y
          la detección de repetidos son las mismas de la migración del Excel heredado. Solo se crean las filas
          completas que no estén ya en el CRM.{" "}
          <a href="/plantilla-importar-contactos.csv" download className="text-amber-700 underline">
            Descargar plantilla
          </a>
        </p>
      </header>
      <FormularioImportar />
    </div>
  );
}
