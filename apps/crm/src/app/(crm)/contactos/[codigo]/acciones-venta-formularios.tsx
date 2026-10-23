"use client";

import { useActionState, useState } from "react";

import { cotizar } from "@/lib/cotizacion";
import { formatoNumero, formatoPesos } from "@/lib/formato";
import type { Ciudad } from "@/lib/tipos";

import { agendarVisita, crearCotizacion, type EstadoAccionVenta } from "./acciones-venta";

const estadoInicial: EstadoAccionVenta = { error: null, mensaje: null, intentos: 0 };
const campo = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";
const boton = "rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100";

type Props = { oportunidadId: string; consumo: number | null; ciudad: Ciudad };

// Los botones "Cotizar" y "Agendar visita" de cada venta abierta en la ficha del contacto
export function AccionesVenta({ oportunidadId, consumo, ciudad }: Props) {
  const [abierto, setAbierto] = useState<"cotizar" | "visita" | null>(null);

  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      <div className="flex gap-2">
        <button type="button" className={boton} onClick={() => setAbierto(abierto === "cotizar" ? null : "cotizar")}>
          Cotizar
        </button>
        <button type="button" className={boton} onClick={() => setAbierto(abierto === "visita" ? null : "visita")}>
          Agendar visita
        </button>
      </div>
      {abierto === "cotizar" && <FormularioCotizacion oportunidadId={oportunidadId} consumo={consumo} ciudad={ciudad} />}
      {abierto === "visita" && <FormularioVisita oportunidadId={oportunidadId} />}
    </div>
  );
}

function FormularioCotizacion(props: Props) {
  const [estado, enviar, enviando] = useActionState(crearCotizacion, estadoInicial);
  return (
    <form action={enviar} className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3">
      <input type="hidden" name="oportunidad_id" value={props.oportunidadId} />
      {/* key: después de cada envío los campos se crean de nuevo, así el cálculo y los campos
          nunca muestran valores distintos (React vacía el formulario al enviarlo) */}
      <CamposCotizacion key={estado.intentos} {...props} enviando={enviando} />
      <Resultado estado={estado} />
    </form>
  );
}

function CamposCotizacion({ consumo: consumoInicial, ciudad, enviando }: Props & { enviando: boolean }) {
  const [consumo, setConsumo] = useState(String(consumoInicial ?? ""));
  const [descuento, setDescuento] = useState("0");

  // Vista previa en el navegador con la misma fórmula; el servidor la recalcula al guardar
  let vistaPrevia = null;
  try {
    vistaPrevia = cotizar(Number(consumo), ciudad, Number(descuento));
  } catch {
    vistaPrevia = null;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">Consumo (kWh/mes)</span>
          <input
            name="consumo"
            type="number"
            min={1}
            required
            value={consumo}
            onChange={(e) => setConsumo(e.target.value)}
            className={campo}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">Descuento</span>
          <select name="descuento" value={descuento} onChange={(e) => setDescuento(e.target.value)} className={campo}>
            {[0, 3, 5, 8, 10, 15].map((d) => (
              <option key={d} value={d}>
                {d} %
              </option>
            ))}
          </select>
        </label>
      </div>

      {vistaPrevia ? (
        <p className="text-sm text-stone-700" aria-live="polite">
          {vistaPrevia.numPaneles} paneles de 550 W · {formatoNumero(vistaPrevia.potenciaInstaladaKwp)} kWp en {ciudad} ·{" "}
          <span className="font-semibold">{formatoPesos(vistaPrevia.valorTotal)}</span>
          {vistaPrevia.descuentoPct > 0 && (
            <span className="text-stone-500"> (antes {formatoPesos(vistaPrevia.valorSinDescuento)})</span>
          )}
        </p>
      ) : (
        <p className="text-sm text-stone-500">Escribe un consumo mayor que cero para ver el cálculo.</p>
      )}

      <button
        type="submit"
        disabled={enviando || !vistaPrevia}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
      >
        {enviando ? "Guardando…" : "Guardar cotización"}
      </button>
    </>
  );
}

function FormularioVisita({ oportunidadId }: { oportunidadId: string }) {
  const [estado, enviar, enviando] = useActionState(agendarVisita, estadoInicial);
  return (
    <form action={enviar} className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3">
      <input type="hidden" name="oportunidad_id" value={oportunidadId} />
      <label className="block text-sm">
        <span className="mb-1 block text-stone-600">Fecha y hora</span>
        <input type="datetime-local" name="fecha" required className={campo} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-stone-600">Indicaciones para el técnico (opcional)</span>
        <input name="nota" maxLength={300} className={campo} placeholder="Ej.: techo de teja, llevar escalera larga" />
      </label>
      <Resultado estado={estado} />
      <button
        type="submit"
        disabled={enviando}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
      >
        {enviando ? "Agendando…" : "Agendar visita"}
      </button>
    </form>
  );
}

function Resultado({ estado }: { estado: EstadoAccionVenta }) {
  if (estado.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {estado.error}
      </p>
    );
  }
  if (estado.mensaje) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {estado.mensaje}
      </p>
    );
  }
  return null;
}
