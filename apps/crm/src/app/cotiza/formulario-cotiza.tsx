"use client";

import { useActionState, useRef } from "react";

import { CAMPO_TRAMPA } from "@/lib/formulario/envio";

import { enviarCotizacion, type EstadoCotiza } from "./acciones";

const estadoInicial: EstadoCotiza = { enviado: false, error: null };
const CAMPO =
  "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none";

export function FormularioCotiza() {
  const [estado, enviar, enviando] = useActionState(enviarCotizacion, estadoInicial);
  // El número del envío se crea en el navegador al enviar (la página es fija: si lo creara el servidor,
  // todos los visitantes tendrían el mismo). Se conserva si hay que corregir un dato y reenviar.
  const idEnvio = useRef<string | null>(null);
  const v = estado.valores ?? ({} as Partial<NonNullable<EstadoCotiza["valores"]>>);

  if (estado.enviado) {
    return (
      <div role="status" className="space-y-2 text-center">
        <p className="text-lg font-semibold text-stone-900">¡Gracias! Recibimos tu solicitud.</p>
        <p className="text-sm text-stone-600">Un asesor de tu ciudad te contactará pronto.</p>
      </div>
    );
  }

  return (
    <form
      action={(datos: FormData) => {
        idEnvio.current ??= crypto.randomUUID();
        datos.set("id_envio", idEnvio.current);
        enviar(datos);
      }}
      // Al volver con un error, el formulario se arma de nuevo con lo que la persona escribió
      key={JSON.stringify(estado.valores ?? {})}
      className="space-y-4"
    >
      <Campo etiqueta="Nombre" nombre="nombre" requerido autoComplete="name" valor={v.nombre} />
      <Campo etiqueta="Empresa (si es para un negocio)" nombre="empresa" autoComplete="organization" valor={v.empresa} />
      <Campo
        etiqueta="Celular"
        nombre="celular"
        requerido
        tipo="tel"
        autoComplete="tel"
        ayuda="Celular colombiano de 10 dígitos"
        valor={v.celular}
      />
      <div>
        <label htmlFor="ciudad" className="block text-sm font-medium text-stone-700">
          Ciudad
        </label>
        <select id="ciudad" name="ciudad" required defaultValue={v.ciudad ?? ""} className={CAMPO}>
          <option value="" disabled>
            Elige tu ciudad
          </option>
          <option>Bogotá</option>
          <option>Medellín</option>
          <option>Cali</option>
        </select>
      </div>
      <Campo etiqueta="Correo (opcional)" nombre="correo" tipo="email" autoComplete="email" valor={v.correo} />
      <Campo
        etiqueta="Consumo mensual en kWh (opcional)"
        nombre="consumo"
        tipo="number"
        ayuda="Aparece en tu factura de luz"
        valor={v.consumo}
      />
      <div>
        <label htmlFor="mensaje" className="block text-sm font-medium text-stone-700">
          ¿En qué te podemos ayudar? (opcional)
        </label>
        <textarea id="mensaje" name="mensaje" rows={3} maxLength={2000} defaultValue={v.mensaje} className={CAMPO} />
      </div>

      {/* Campo trampa: invisible para las personas (y para los lectores de pantalla). Un robot lo llena */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={CAMPO_TRAMPA}>No llenes este campo</label>
        <input id={CAMPO_TRAMPA} name={CAMPO_TRAMPA} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex items-start gap-2 text-sm text-stone-600">
        <input type="checkbox" name="autorizacion" value="si" required className="mt-1" />
        <span>
          Autorizo a SolarAndes S.A.S. (empresa ficticia) a tratar mis datos para contactarme sobre mi cotización,
          según la Ley 1581 de 2012. Mi mensaje lo lee un servicio de inteligencia artificial externo para
          clasificarlo: no recibe los datos del formulario (nombre, empresa, celular, correo), y del mensaje se
          tapan los teléfonos, correos y documentos.
        </span>
      </label>

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
        {enviando ? "Enviando…" : "Quiero mi cotización"}
      </button>
    </form>
  );
}

function Campo({
  etiqueta,
  nombre,
  tipo = "text",
  requerido = false,
  autoComplete,
  ayuda,
  valor,
}: {
  etiqueta: string;
  nombre: string;
  tipo?: string;
  requerido?: boolean;
  autoComplete?: string;
  ayuda?: string;
  valor?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-sm font-medium text-stone-700">
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        autoComplete={autoComplete}
        maxLength={120}
        defaultValue={valor}
        className={CAMPO}
      />
      {ayuda && <p className="mt-1 text-xs text-stone-500">{ayuda}</p>}
    </div>
  );
}
