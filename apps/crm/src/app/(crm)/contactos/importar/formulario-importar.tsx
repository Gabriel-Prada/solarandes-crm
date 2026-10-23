"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { TAMANO_MAXIMO, type Estado } from "@/lib/importar/analizar";
import { NOMBRE_CANAL } from "@/lib/tipos";

import { importarContactos, type EstadoImportacion } from "./acciones";

const estadoInicial: EstadoImportacion = { error: null, filas: [], importado: null };

// El estado se dice con palabras, no solo con color
const ESTADOS: Record<Estado, { texto: string; clase: string }> = {
  crear: { texto: "Se crea", clase: "bg-emerald-50 text-emerald-800" },
  existe: { texto: "Ya existe", clase: "bg-stone-100 text-stone-700" },
  repetida: { texto: "Repetida", clase: "bg-stone-100 text-stone-700" },
  revisar: { texto: "Revisar", clase: "bg-amber-50 text-amber-800" },
  error: { texto: "Error", clase: "bg-red-50 text-red-700" },
};

/**
 * El texto del archivo. Excel en español guarda los CSV en Windows-1252 y no en UTF-8: si se
 * leyeran como UTF-8, "Medellín" llegaría como "Medell�n". Se intenta UTF-8 y, si no es, Windows-1252.
 */
function leerTexto(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function FormularioImportar() {
  const [estado, enviar, enviando] = useActionState(importarContactos, estadoInicial);
  // Una copia del archivo en memoria: "Importar" manda la misma que se vio en la vista previa, y
  // si la persona edita el archivo en Excel después de elegirlo, el navegador no falla al enviarlo
  const [archivo, setArchivo] = useState<File | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [canal, setCanal] = useState("");
  // El archivo y el canal de la última vista previa: "Importar" manda exactamente esos, y si la
  // persona cambia cualquiera de los dos, la vista previa se oculta hasta que la vuelva a pedir
  const [revisado, setRevisado] = useState<{ archivo: File; canal: string } | null>(null);
  const vistaVigente = revisado !== null && revisado.archivo === archivo && revisado.canal === canal;

  const elegir = async (elegido: File | undefined) => {
    setArchivo(null);
    setAviso(null);
    if (!elegido) return;
    // Next.js rechaza envíos de más de 1 MB antes de llegar a la acción: se avisa aquí
    if (elegido.size > TAMANO_MAXIMO) return setAviso("El archivo pesa más de 900 KB. Pártelo en varios.");
    try {
      setArchivo(new File([leerTexto(await elegido.arrayBuffer())], elegido.name, { type: "text/csv" }));
    } catch {
      setAviso("No se pudo leer el archivo. Ciérralo en Excel y vuelve a elegirlo.");
    }
  };

  const mandar = (accion: "ver" | "importar") => {
    const elegidos = accion === "ver" ? archivo && { archivo, canal } : revisado;
    if (!elegidos) return;
    if (accion === "ver") setRevisado(elegidos);
    const datos = new FormData();
    datos.set("archivo", elegidos.archivo);
    datos.set("canal", elegidos.canal);
    datos.set("accion", accion);
    startTransition(() => enviar(datos));
  };

  const cuenta = (e: Estado) => estado.filas.filter((f) => f.estado === e).length;
  const porCrear = cuenta("crear");

  return (
    <div className="space-y-6">
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          mandar("ver");
        }}
        className="flex flex-wrap items-end gap-4 rounded-2xl border border-stone-200 bg-white p-5"
      >
        <label className="space-y-1 text-sm">
          <span className="block text-stone-600">Archivo CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(e) => elegir(e.target.files?.[0])}
            className="block text-sm"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-stone-600">Canal para las filas que no lo traen</span>
          <select
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
            required
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Elige…
            </option>
            {Object.entries(NOMBRE_CANAL).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={enviando}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {enviando ? "Revisando…" : "Ver vista previa"}
        </button>
      </form>

      {(aviso ?? estado.error) && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {aviso ?? estado.error}
        </p>
      )}

      {estado.importado && (
        <div role="status" className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm">
          <p className="font-medium text-emerald-900">
            Se crearon {estado.importado.creados.length} contacto(s), cada uno con su primera venta en &quot;Nuevo&quot;.
          </p>
          {estado.importado.creados.length > 0 && (
            <p className="text-emerald-900">
              {estado.importado.creados.map(({ fila, codigo }, i) => (
                <span key={codigo}>
                  {i > 0 && ", "}
                  <Link href={`/contactos/${codigo}`} className="underline">
                    {codigo}
                  </Link>{" "}
                  (fila {fila})
                </span>
              ))}
            </p>
          )}
          {estado.importado.fallidos.map(({ fila, motivo }) => (
            <p key={fila} className="text-red-700">
              Fila {fila}: no se creó porque {motivo}.
            </p>
          ))}
          {estado.importado.avisos.map((texto) => (
            <p key={texto} className="text-amber-800">
              {texto}
            </p>
          ))}
        </div>
      )}

      {estado.filas.length > 0 && !estado.importado && !vistaVigente && (
        <p className="text-sm text-stone-600">
          Cambiaste el archivo o el canal: pulsa &quot;Ver vista previa&quot; para revisarlo antes de importar.
        </p>
      )}

      {estado.filas.length > 0 && !estado.importado && vistaVigente && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-stone-600">
              {estado.filas.length} fila(s): {porCrear} se crean, {cuenta("existe")} ya existen, {cuenta("repetida")}{" "}
              repetida(s) dentro del archivo, {cuenta("revisar")} para revisar y {cuenta("error")} con errores.
            </p>
            <button
              type="button"
              onClick={() => mandar("importar")}
              disabled={enviando || porCrear === 0}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {enviando ? "Importando…" : `Importar ${porCrear} contacto(s)`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  {["Fila", "Nombre", "Celular", "Ciudad", "Tipo", "Consumo", "Asesor", "Estado", "Detalle"].map((t) => (
                    <th key={t} scope="col" className="px-3 py-2 font-medium">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {estado.filas.map((f) => (
                  <tr key={f.fila}>
                    <td className="px-3 py-2 text-stone-500">{f.fila}</td>
                    <td className="px-3 py-2">{f.nombre}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{f.telefono ?? "—"}</td>
                    <td className="px-3 py-2">{f.ciudad ?? "—"}</td>
                    <td className="px-3 py-2">{f.tipo ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{f.consumo ? `${f.consumo} kWh` : "—"}</td>
                    <td className="px-3 py-2">{f.asesor ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADOS[f.estado].clase}`}>
                        {ESTADOS[f.estado].texto}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-stone-600">{f.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
