// Gráficas simples en HTML/CSS, sin librerías. Reglas (guía de visualización de datos):
// - Una sola serie = un solo color (azul #2a78d6, validado contra el fondo blanco).
// - Barras delgadas (máx. 24 px) con la punta redondeada y la base recta; rejilla en gris claro.
// - El texto nunca va en el color de la serie; el valor exacto aparece al pasar el mouse
//   o al enfocar con el teclado, y cada gráfica tiene su tabla con los mismos números.

const AZUL = "#2a78d6";

// etiquetaLarga: lo que lee el lector de pantalla cuando la etiqueta visible es corta ("oct" → "octubre de 2026")
type Dato = { etiqueta: string; valor: number; detalle: string; etiquetaLarga?: string };

/** Columnas verticales (cambio en el tiempo). */
export function Columnas({ datos, titulo }: { datos: Dato[]; titulo: string }) {
  const maximo = Math.max(...datos.map((d) => d.valor), 1);
  return (
    <figure>
      <div role="list" aria-label={titulo} className="flex h-48 items-end gap-1 border-b border-stone-300 pt-6">
        {datos.map((d) => (
          <div
            key={d.etiqueta}
            role="listitem"
            tabIndex={0}
            aria-label={`${d.etiquetaLarga ?? d.etiqueta}: ${d.detalle}`}
            className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
          >
            <Globo texto={d.detalle} />
            <div
              className="w-full max-w-6 rounded-t group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-stone-900"
              style={{ height: `${(d.valor / maximo) * 100}%`, backgroundColor: AZUL, minHeight: d.valor ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-center text-xs text-stone-500">
        {datos.map((d) => (
          <span key={d.etiqueta} className="flex-1 truncate">
            {d.etiqueta}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Barras horizontales (comparar cantidades entre categorías). El valor va escrito al lado de cada barra. */
export function Barras({ datos, titulo }: { datos: Dato[]; titulo: string }) {
  const maximo = Math.max(...datos.map((d) => d.valor), 1);
  return (
    <ul aria-label={titulo} className="space-y-2">
      {datos.map((d) => (
        <li key={d.etiqueta} className="grid grid-cols-[10.5rem_1fr] items-center gap-3 text-sm">
          <span className="truncate text-stone-600">{d.etiqueta}</span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-5 max-h-6 rounded-r"
              style={{ width: `${(d.valor / maximo) * 85}%`, backgroundColor: AZUL, minWidth: d.valor ? 2 : 0 }}
            />
            <span className="text-xs whitespace-nowrap text-stone-700 tabular-nums">{d.detalle}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Globo({ texto }: { texto: string }) {
  return (
    <span className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full rounded-md bg-stone-900 px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block group-focus-visible:block">
      {texto}
    </span>
  );
}

/** La tabla con los mismos números de la gráfica, desplegable. */
export function VerTabla({ columnas, filas }: { columnas: string[]; filas: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-stone-500 hover:text-stone-900">Ver tabla</summary>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs text-stone-500">
          <tr>
            {columnas.map((c, i) => (
              <th key={c} className={`py-1 font-medium ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 tabular-nums">
          {filas.map((fila) => (
            <tr key={String(fila[0])}>
              {fila.map((celda, i) => (
                <td key={i} className={`py-1 ${i > 0 ? "text-right" : ""}`}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
