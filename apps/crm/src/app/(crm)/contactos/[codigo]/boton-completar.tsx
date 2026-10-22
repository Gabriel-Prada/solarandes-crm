"use client";

import { useState, useTransition } from "react";

import { completarActividad } from "./acciones";

export function BotonCompletar({ actividadId }: { actividadId: string }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1 self-start">
      <button
        type="button"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            const resultado = await completarActividad(actividadId);
            setError(resultado.error);
          })
        }
        className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-medium hover:bg-stone-100 disabled:opacity-60"
      >
        {pendiente ? "…" : "Marcar hecha"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
