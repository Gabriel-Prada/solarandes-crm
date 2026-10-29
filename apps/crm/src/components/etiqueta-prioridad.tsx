import type { Etiqueta } from "@/lib/prioridad";

const TONO: Record<Etiqueta["tono"], string> = {
  alta: "bg-red-100 text-red-800",
  media: "bg-amber-100 text-amber-800",
  baja: "bg-sky-100 text-sky-800",
  gris: "bg-stone-100 text-stone-600",
};

/** La prioridad de un lead, como una etiqueta pequeña. Sin etiqueta (lead de antes de la fase 4), nada. */
export function EtiquetaPrioridad({ etiqueta, titulo }: { etiqueta: Etiqueta | null; titulo?: string }) {
  if (!etiqueta) return null;
  return (
    <span title={titulo} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONO[etiqueta.tono]}`}>
      {etiqueta.texto}
    </span>
  );
}
