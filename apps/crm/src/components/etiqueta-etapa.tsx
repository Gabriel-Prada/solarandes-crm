import { NOMBRE_ETAPA, type Etapa } from "@/lib/tipos";

// Colores por etapa: grises al inicio, ámbar en la mitad del embudo, verde/rojo al cerrar
const COLOR: Record<Etapa, string> = {
  nuevo: "bg-stone-100 text-stone-700",
  contactado: "bg-stone-100 text-stone-700",
  visita_agendada: "bg-amber-50 text-amber-800",
  cotizado: "bg-amber-50 text-amber-800",
  negociacion: "bg-amber-100 text-amber-900",
  ganado: "bg-emerald-50 text-emerald-800",
  perdido: "bg-red-50 text-red-700",
};

export function EtiquetaEtapa({ etapa }: { etapa: Etapa }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLOR[etapa]}`}>
      {NOMBRE_ETAPA[etapa]}
    </span>
  );
}
