"use client";

import { useActionState, useState } from "react";

import { CIUDADES, NOMBRE_CANAL } from "@/lib/tipos";

import { crearContacto, type EstadoNuevoContacto } from "./acciones";

const estadoInicial: EstadoNuevoContacto = { error: null, intentos: 0, valores: null };
const campo = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

type Props = {
  asesores: { id: string; nombre: string; ciudad: string }[];
  ciudadPorDefecto: string;
};

export function FormularioContacto({ asesores, ciudadPorDefecto }: Props) {
  const [estado, enviar, enviando] = useActionState(crearContacto, estadoInicial);
  const v = estado.valores; // lo escrito antes, si el último intento falló
  const [tipo, setTipo] = useState(v?.tipo ?? "hogar");

  return (
    // key: tras un error el formulario se vuelve a crear con lo que la persona había escrito
    <form key={estado.intentos} action={enviar} className="space-y-4">
      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-1 text-stone-600">Tipo de cliente</legend>
        {(["hogar", "negocio"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2">
            <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} />
            {t === "hogar" ? "Hogar" : "Negocio"}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {tipo === "negocio" && (
          <Campo etiqueta="Nombre del negocio" className="sm:col-span-2">
            <input name="empresa" required defaultValue={v?.empresa} className={campo} placeholder="Panadería La Esquina" />
          </Campo>
        )}
        <Campo etiqueta={tipo === "negocio" ? "Persona de contacto" : "Nombre"}>
          <input name="nombre" required minLength={3} defaultValue={v?.nombre} className={campo} />
        </Campo>
        <Campo etiqueta="Celular">
          <input name="telefono" type="tel" required defaultValue={v?.telefono} className={campo} placeholder="300 123 4567" />
        </Campo>
        <Campo etiqueta="Correo (opcional)">
          <input name="email" type="email" defaultValue={v?.email} className={campo} />
        </Campo>
        <Campo etiqueta="Ciudad">
          <select name="ciudad" defaultValue={v?.ciudad ?? ciudadPorDefecto} className={campo}>
            {CIUDADES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Dirección (opcional)" className="sm:col-span-2">
          <input name="direccion" defaultValue={v?.direccion} className={campo} />
        </Campo>
        <Campo etiqueta="Consumo mensual (kWh)">
          <input
            name="consumo"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={v?.consumo}
            className={campo}
            placeholder="Aparece en la factura de luz"
          />
        </Campo>
        {tipo === "hogar" && (
          <Campo etiqueta="Estrato (opcional)">
            <select name="estrato" defaultValue={v?.estrato ?? ""} className={campo}>
              <option value="">Sin dato</option>
              {[1, 2, 3, 4, 5, 6].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </Campo>
        )}
        <Campo etiqueta="¿Por dónde llegó?">
          <select name="canal" defaultValue={v?.canal ?? "whatsapp"} className={campo}>
            {Object.entries(NOMBRE_CANAL).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
        </Campo>
        {asesores.length > 0 && (
          <Campo etiqueta="Asesor responsable">
            <select name="asesor_id" defaultValue={v?.asesor_id ?? ""} className={campo}>
              <option value="">El de su ciudad</option>
              {asesores.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre} ({a.ciudad})
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60"
      >
        {enviando ? "Creando…" : "Crear contacto"}
      </button>
    </form>
  );
}

function Campo({ etiqueta, className = "", children }: { etiqueta: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-stone-600">{etiqueta}</span>
      {children}
    </label>
  );
}
