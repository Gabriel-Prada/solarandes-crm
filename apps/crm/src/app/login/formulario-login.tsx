"use client";

import { useActionState } from "react";

import { iniciarSesion, type EstadoLogin } from "./acciones";

const estadoInicial: EstadoLogin = { error: null, email: "" };

export function FormularioLogin({ volver }: { volver?: string }) {
  const [estado, enviar, enviando] = useActionState(iniciarSesion, estadoInicial);

  return (
    <form action={enviar} className="space-y-4">
      {volver && <input type="hidden" name="volver" value={volver} />}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-stone-700">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={estado.email}
          key={estado.email}
          required
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-stone-700">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
        />
      </div>

      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
