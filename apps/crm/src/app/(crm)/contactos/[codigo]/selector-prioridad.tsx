"use client";

import { useState, useTransition } from "react";

import { NOMBRE_PRIORIDAD, PRIORIDADES, type Prioridad } from "@/lib/prioridad";

import { cambiarPrioridad } from "./acciones";

/** Para que el asesor corrija la prioridad que dio la IA, o vuelva a la de la regla. */
export function SelectorPrioridad({
  calificacionId,
  prioridadAsesor,
  prioridadRegla,
}: {
  calificacionId: string;
  prioridadAsesor: Prioridad | null;
  prioridadRegla: Prioridad | null;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
        Cambiar prioridad:
        <select
          value={prioridadAsesor ?? "regla"}
          disabled={pendiente}
          onChange={(e) => {
            const valor = e.target.value;
            setError(null);
            iniciar(async () => {
              const r = await cambiarPrioridad(calificacionId, valor);
              if (r.error) setError(r.error);
            });
          }}
          className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs"
        >
          <option value="regla">
            La de la regla{prioridadRegla ? ` (${NOMBRE_PRIORIDAD[prioridadRegla].toLowerCase()})` : ""}
          </option>
          {PRIORIDADES.map((p) => (
            <option key={p} value={p}>
              {NOMBRE_PRIORIDAD[p]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
