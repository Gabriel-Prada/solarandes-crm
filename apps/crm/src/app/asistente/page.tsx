import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { Chat } from "./chat";

export const metadata: Metadata = { title: "Sol, el asistente de SolarAndes" };

/**
 * El asistente público de SolarAndes (fase 6): sin sesión (el portero lo deja pasar), como /cotiza.
 * El diseño, con lo que puede fallar, está en docs/plan-fase-6.md.
 */
export default function PaginaAsistente() {
  return (
    <main className="flex min-h-screen justify-center bg-stone-50 px-4 py-6 sm:py-10">
      <div className="flex w-full max-w-xl flex-col">
        <div className="mb-4 flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Sol, el asistente de SolarAndes</h1>
            <p className="text-sm text-stone-500">Pre-cotizaciones, preguntas y visitas técnicas, a cualquier hora.</p>
          </div>
        </div>
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Este es un <strong>proyecto de demostración</strong> con una empresa ficticia. No escribas datos reales de
          personas.
        </p>
        <Chat />
      </div>
    </main>
  );
}
