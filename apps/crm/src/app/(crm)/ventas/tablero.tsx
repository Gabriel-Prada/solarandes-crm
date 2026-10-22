"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { formatoPesosCorto } from "@/lib/formato";
import { diasDesde, nivelSeguimiento, ultimaActividad, type NivelSeguimiento } from "@/lib/seguimiento";
import { ETAPAS, NOMBRE_ETAPA, NOMBRE_MOTIVO, type Etapa, type MotivoPerdida } from "@/lib/tipos";

import { moverOportunidad } from "./acciones";

export type TarjetaVenta = {
  id: string;
  codigo: string;
  nombre: string;
  etapa: Etapa;
  valor_cop: number | null;
  potencia_kwp: number | null;
  creada_en: string;
  actualizada_en: string;
  contacto: { codigo: string; nombre: string; empresa: string | null; ciudad: string } | null;
  asesor: { nombre: string } | null;
  actividades: { fecha: string; completada: boolean }[];
};

// Ámbar: sin seguimiento (3+ días sin actividad). Rojo: ya hay que avisarle a la gerente (7+).
const BORDE: Record<NivelSeguimiento, string> = {
  al_dia: "border-stone-200",
  sin_seguimiento: "border-amber-300",
  aviso_gerente: "border-red-300",
};

export function TableroVentas({
  oportunidades,
  mostrarAsesor,
}: {
  oportunidades: TarjetaVenta[];
  mostrarAsesor: boolean;
}) {
  // Actualización optimista: la tarjeta cambia de columna al instante y, si el servidor
  // rechaza el cambio, vuelve sola a donde estaba cuando termina la transición
  const [tarjetas, moverEnPantalla] = useOptimistic(
    oportunidades,
    (estado, cambio: { id: string; etapa: Etapa }) =>
      estado.map((o) => (o.id === cambio.id ? { ...o, etapa: cambio.etapa, actualizada_en: new Date().toISOString() } : o)),
  );
  const [, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [porPerder, setPorPerder] = useState<TarjetaVenta | null>(null);
  const [columnaResaltada, setColumnaResaltada] = useState<Etapa | null>(null);
  const [ahora] = useState(() => Date.now());

  function mover(tarjeta: TarjetaVenta, etapa: Etapa, motivo?: MotivoPerdida) {
    if (tarjeta.etapa === etapa) return;
    if (etapa === "perdido" && !motivo) {
      setPorPerder(tarjeta); // primero hay que preguntar el motivo
      return;
    }
    setError(null);
    iniciar(async () => {
      moverEnPantalla({ id: tarjeta.id, etapa });
      const resultado = await moverOportunidad(tarjeta.id, etapa, motivo);
      if (resultado.error) setError(resultado.error);
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {ETAPAS.map((etapa) => {
          const enColumna = tarjetas.filter((t) => t.etapa === etapa);
          const total = enColumna.reduce((suma, t) => suma + (t.valor_cop ?? 0), 0);
          return (
            <section
              key={etapa}
              aria-label={NOMBRE_ETAPA[etapa]}
              onDragOver={(e) => {
                e.preventDefault();
                setColumnaResaltada(etapa);
              }}
              onDragLeave={() => setColumnaResaltada(null)}
              onDrop={(e) => {
                e.preventDefault();
                setColumnaResaltada(null);
                const tarjeta = tarjetas.find((t) => t.id === e.dataTransfer.getData("text/plain"));
                if (tarjeta) mover(tarjeta, etapa);
              }}
              className={`flex w-64 shrink-0 flex-col gap-2 rounded-2xl p-2 transition ${
                columnaResaltada === etapa ? "bg-amber-100" : "bg-stone-100"
              }`}
            >
              <header className="px-1 pt-1">
                <h2 className="text-sm font-semibold">
                  {NOMBRE_ETAPA[etapa]} <span className="font-normal text-stone-500">({enColumna.length})</span>
                </h2>
                <p className="text-xs text-stone-500">{formatoPesosCorto(total)}</p>
              </header>

              {enColumna.map((t) => {
                const abierta = t.etapa !== "ganado" && t.etapa !== "perdido";
                const dias = diasDesde(ultimaActividad(t.actividades, t.creada_en), ahora);
                const nivel = abierta ? nivelSeguimiento(dias) : "al_dia";
                return (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    className={`cursor-grab rounded-xl border bg-white p-3 text-sm shadow-sm active:cursor-grabbing ${BORDE[nivel]}`}
                  >
                    <Link
                      href={`/contactos/${t.contacto?.codigo}`}
                      className="font-medium text-stone-900 hover:text-amber-700 hover:underline"
                    >
                      {t.contacto?.empresa ?? t.contacto?.nombre}
                    </Link>
                    <p className="text-xs text-stone-500">
                      <span className="font-mono">{t.codigo}</span> · {t.contacto?.ciudad}
                      {mostrarAsesor && t.asesor && ` · ${t.asesor.nombre.split(" ")[0]}`}
                    </p>
                    <p className="mt-2 flex justify-between">
                      <span className="font-medium">{t.valor_cop != null ? formatoPesosCorto(t.valor_cop) : "—"}</span>
                      <span className="text-stone-500">{t.potencia_kwp} kWp</span>
                    </p>
                    {nivel !== "al_dia" && (
                      <p className={`mt-1 text-xs ${nivel === "aviso_gerente" ? "text-red-700" : "text-amber-800"}`}>
                        Sin actividad hace {dias} días
                      </p>
                    )}

                    {/* Alternativa a arrastrar: para teclado y celular */}
                    <select
                      aria-label={`Mover ${t.codigo} a otra etapa`}
                      value={t.etapa}
                      onChange={(e) => mover(t, e.target.value as Etapa)}
                      className="mt-2 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600"
                    >
                      {ETAPAS.map((e) => (
                        <option key={e} value={e}>
                          {e === t.etapa ? NOMBRE_ETAPA[e] : `Mover a ${NOMBRE_ETAPA[e]}`}
                        </option>
                      ))}
                    </select>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {porPerder && (
        <DialogoMotivo
          tarjeta={porPerder}
          onCancelar={() => setPorPerder(null)}
          onConfirmar={(motivo) => {
            mover(porPerder, "perdido", motivo);
            setPorPerder(null);
          }}
        />
      )}
    </>
  );
}

function DialogoMotivo({
  tarjeta,
  onCancelar,
  onConfirmar,
}: {
  tarjeta: TarjetaVenta;
  onCancelar: () => void;
  onConfirmar: (motivo: MotivoPerdida) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPerdida | "">("");
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={onCancelar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-motivo"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="titulo-motivo" className="font-semibold">
          ¿Por qué se perdió {tarjeta.codigo}?
        </h2>
        <p className="mt-1 text-sm text-stone-500">{tarjeta.contacto?.empresa ?? tarjeta.contacto?.nombre}</p>
        <select
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as MotivoPerdida)}
          className="mt-4 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Elige el motivo
          </option>
          {Object.entries(NOMBRE_MOTIVO).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="rounded-lg px-3 py-2 text-sm hover:bg-stone-100">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!motivo}
            onClick={() => motivo && onConfirmar(motivo)}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Marcar como perdida
          </button>
        </div>
      </div>
    </div>
  );
}
