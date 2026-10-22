import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { aviso } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-2xl font-semibold text-stone-900">SolarAndes CRM</h1>
          <p className="text-sm text-stone-500">Entra con tu cuenta del equipo</p>
        </div>
        {aviso === "sin-perfil" && (
          <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Tu usuario existe pero todavía no tiene acceso al CRM. Pídele a la gerente que lo active.
          </p>
        )}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <FormularioLogin />
        </div>
      </div>
    </main>
  );
}
