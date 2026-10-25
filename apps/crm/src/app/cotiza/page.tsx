import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { FormularioCotiza } from "./formulario-cotiza";

export const metadata: Metadata = { title: "Cotiza tu sistema solar" };

/**
 * El formulario público de SolarAndes: sin sesión (el portero lo deja pasar) y fuera de la carpeta
 * (crm), cuyo diseño supone que hay alguien conectado.
 */
export default function PaginaCotiza() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-2xl font-semibold text-stone-900">Cotiza tu sistema solar</h1>
          <p className="text-sm text-stone-500">Bogotá, Medellín y Cali. Te contactamos en menos de un día.</p>
        </div>
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Este es un <strong>proyecto de demostración</strong> con una empresa ficticia. No escribas datos reales de
          personas.
        </p>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <FormularioCotiza />
        </div>
        <p className="mt-4 text-center text-xs text-stone-500">
          ¿El formulario no funciona? Escríbenos a contacto@solarandes.test (correo ficticio).
        </p>
      </div>
    </main>
  );
}
