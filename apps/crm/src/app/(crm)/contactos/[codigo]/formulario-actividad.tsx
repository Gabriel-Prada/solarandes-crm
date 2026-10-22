"use client";

import { useActionState, useState } from "react";

import { registrarActividad, type EstadoFormulario } from "./acciones";

type Props = {
  contactoId: string;
  oportunidades: { id: string; codigo: string; nombre: string }[];
};

const estadoInicial: EstadoFormulario = { error: null, guardadas: 0, intentos: 0, valores: null };
const campo = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

export function FormularioActividad({ contactoId, oportunidades }: Props) {
  const [estado, enviar, enviando] = useActionState(registrarActividad, estadoInicial);
  const [tipo, setTipo] = useState("llamada");
  const previos = estado.valores; // solo hay valores previos si el último envío falló

  return (
    // key: tras cada envío el formulario se vuelve a crear. Si salió bien queda vacío;
    // si falló, se rellena con lo que la persona había escrito.
    <form key={estado.intentos} action={enviar} className="space-y-3">
      <input type="hidden" name="contacto_id" value={contactoId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">Tipo</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
            <option value="llamada">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="correo">Correo</option>
            <option value="nota">Nota</option>
            <option value="tarea">Tarea pendiente</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">Venta (opcional)</span>
          <select name="oportunidad_id" defaultValue={previos?.oportunidad_id ?? oportunidades[0]?.id ?? ""} className={campo}>
            <option value="">Ninguna</option>
            {oportunidades.map((o) => (
              <option key={o.id} value={o.id}>
                {o.codigo}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tipo === "tarea" && (
        <label className="block text-sm">
          <span className="mb-1 block text-stone-600">¿Para cuándo?</span>
          <input type="datetime-local" name="fecha" required defaultValue={previos?.fecha} className={campo} />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-stone-600">Descripción</span>
        <textarea
          name="descripcion"
          rows={3}
          required
          minLength={3}
          maxLength={500}
          defaultValue={previos?.descripcion}
          placeholder={tipo === "tarea" ? "Ej.: Llamar para confirmar la visita" : "Ej.: Pidió la cotización por correo"}
          className={campo}
        />
      </label>

      {estado.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.error}
        </p>
      )}
      {estado.guardadas > 0 && !estado.error && (
        <p role="status" className="text-sm text-emerald-700">
          Actividad guardada.
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
      >
        {enviando ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
