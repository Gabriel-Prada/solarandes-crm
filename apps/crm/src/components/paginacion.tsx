import Link from "next/link";

type Props = {
  pagina: number;
  totalPaginas: number;
  // Los filtros actuales, para que cambiar de página no los borre
  parametros: Record<string, string | undefined>;
  ruta: string;
};

export function Paginacion({ pagina, totalPaginas, parametros, ruta }: Props) {
  if (totalPaginas <= 1) return null;

  const enlace = (p: number) => {
    const query = new URLSearchParams();
    for (const [clave, valor] of Object.entries(parametros)) {
      if (valor) query.set(clave, valor);
    }
    query.set("pagina", String(p));
    return `${ruta}?${query}`;
  };
  const clase = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100";

  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Paginación">
      {pagina > 1 ? (
        <Link href={enlace(pagina - 1)} className={clase}>
          ← Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-stone-500">
        Página {pagina} de {totalPaginas}
      </span>
      {pagina < totalPaginas ? (
        <Link href={enlace(pagina + 1)} className={clase}>
          Siguiente →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
