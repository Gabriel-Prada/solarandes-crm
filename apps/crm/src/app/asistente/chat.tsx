"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { CAMPO_TRAMPA } from "@/lib/formulario/envio";

import { enviarDatosAsistente, type EstadoDatos } from "./acciones";

type Mensaje = { de: "visitante" | "asistente" | "aviso"; texto: string; formulario?: boolean };

const SALUDO =
  "¡Hola! Soy Sol, el asistente automático de SolarAndes. Puedo darte una pre-cotización, resolver dudas sobre energía solar o agendar una visita técnica gratuita. ¿En qué te ayudo?";
const CAMPO =
  "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none";

/**
 * La conversación con Sol. El navegador solo manda el mensaje nuevo: el historial lo guarda la base, y
 * la conversación se identifica con una cookie que esta página no puede leer.
 */
export function Chat() {
  const [abierta, setAbierta] = useState(false);
  const [cerrada, setCerrada] = useState(false);
  const [aceptado, setAceptado] = useState(false);
  const [errorInicio, setErrorInicio] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ de: "asistente", texto: SALUDO }]);
  const [texto, setTexto] = useState("");
  const [esperando, setEsperando] = useState(false);
  const final = useRef<HTMLDivElement>(null);

  // Entre llaves: scrollIntoView devuelve una promesa en algunos navegadores, y un efecto solo puede devolver una función
  useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes]);

  async function empezar() {
    setErrorInicio(null);
    const r = await fetch("/api/asistente/abrir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acepto: true }),
    }).catch(() => null);
    if (!r?.ok) {
      const cuerpo = (await r?.json().catch(() => null)) as { error?: string } | null;
      setErrorInicio(cuerpo?.error ?? "El asistente no está disponible en este momento. Intenta más tarde.");
      return;
    }
    setAbierta(true);
  }

  async function enviar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || esperando || cerrada) return;
    setTexto("");
    setEsperando(true);
    setMensajes((m) => [...m, { de: "visitante", texto: limpio }, { de: "asistente", texto: "" }]);
    const agregar = (cambio: (ultimo: Mensaje) => Mensaje | Mensaje[]) =>
      setMensajes((m) => {
        const resto = m.slice(0, -1);
        const nuevo = cambio(m[m.length - 1]);
        return [...resto, ...(Array.isArray(nuevo) ? nuevo : [nuevo])];
      });
    try {
      const r = await fetch("/api/asistente/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: limpio }),
      });
      if (!r.ok || !r.body) {
        const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null;
        agregar(() => ({ de: "aviso", texto: cuerpo?.error ?? "Algo falló. Intenta de nuevo." }));
        if (r.status === 401) setCerrada(true);
        return;
      }
      const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let pendiente = "";
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        pendiente += value;
        const lineas = pendiente.split("\n");
        pendiente = lineas.pop() ?? "";
        for (const linea of lineas) {
          if (!linea.trim()) continue;
          const e = JSON.parse(linea) as
            | { tipo: "texto"; texto: string }
            | { tipo: "formulario"; motivo: string }
            | { tipo: "aviso"; texto: string; cerrada: boolean }
            | { tipo: "fin"; cerrada: boolean };
          if (e.tipo === "texto") agregar((u) => ({ ...u, texto: u.texto + e.texto }));
          else if (e.tipo === "formulario") agregar((u) => ({ ...u, formulario: true }));
          else if (e.tipo === "aviso") {
            // Una burbuja con el formulario se conserva aunque no tenga texto
            agregar((u) => (u.texto || u.formulario ? [u, { de: "aviso", texto: e.texto }] : { de: "aviso", texto: e.texto }));
            if (e.cerrada) setCerrada(true);
          } else if (e.tipo === "fin" && e.cerrada) setCerrada(true);
        }
      }
    } catch {
      agregar((u) => (u.texto ? [u, { de: "aviso", texto: "Se cortó la conexión. Intenta de nuevo." }] : { de: "aviso", texto: "Se cortó la conexión. Intenta de nuevo." }));
    } finally {
      setEsperando(false);
    }
  }

  if (!abierta) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-stone-800">{SALUDO}</p>
        <div className="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          <p className="font-medium text-stone-800">Antes de empezar</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Sol es un asistente automático, no una persona.</li>
            <li>
              Lo que escribas lo lee un servicio de inteligencia artificial externo para responderte. No escribas datos
              sensibles; los teléfonos, correos y documentos que escribas se tapan.
            </li>
            <li>Tus datos de contacto solo se piden en un formulario aparte, si los quieres dejar.</li>
            <li>La conversación se borra a los 30 días (Ley 1581 de 2012).</li>
          </ul>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={aceptado} onChange={(e) => setAceptado(e.target.checked)} className="mt-1" />
          <span>Acepto que SolarAndes S.A.S. (empresa ficticia) trate lo que escriba en esta conversación para atenderme.</span>
        </label>
        {errorInicio && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorInicio}
          </p>
        )}
        <button
          type="button"
          disabled={!aceptado}
          onClick={empezar}
          className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          Empezar a conversar
        </button>
      </div>
    );
  }

  return (
    // Altura fija con su propio desplazamiento: la caja de mensaje queda siempre a la vista, también en el celular
    <div className="flex h-[70vh] min-h-[420px] flex-col rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {mensajes.map((m, i) => (
          <div key={i}>
            <Burbuja mensaje={m} escribiendo={esperando && i === mensajes.length - 1 && m.de === "asistente" && !m.texto} />
            {m.formulario && (
              <FormularioDatos
                alTerminar={() => {
                  setMensajes((lista) => lista.map((x, j) => (j === i ? { ...x, formulario: false } : x)));
                  void enviar("Ya dejé mis datos en el formulario.");
                }}
              />
            )}
          </div>
        ))}
        <div ref={final} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
        className="flex gap-2 border-t border-stone-200 p-3"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={600}
          disabled={cerrada}
          placeholder={cerrada ? "La conversación terminó" : "Escribe tu pregunta…"}
          aria-label="Tu mensaje"
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:bg-stone-100"
        />
        <button
          type="submit"
          disabled={esperando || cerrada || !texto.trim()}
          className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

function Burbuja({ mensaje, escribiendo }: { mensaje: Mensaje; escribiendo: boolean }) {
  if (mensaje.de === "visitante") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500 px-3 py-2 whitespace-pre-wrap text-white">
          {mensaje.texto}
        </p>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <p
        className={`max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 whitespace-pre-wrap ${
          mensaje.de === "aviso" ? "bg-stone-100 text-stone-600 italic" : "bg-stone-100 text-stone-900"
        }`}
      >
        {escribiendo ? "Escribiendo…" : mensaje.texto}
      </p>
    </div>
  );
}

const estadoInicial: EstadoDatos = { enviado: false, error: null };

function FormularioDatos({ alTerminar }: { alTerminar: () => void }) {
  const [estado, enviar, enviando] = useActionState(enviarDatosAsistente, estadoInicial);
  const idEnvio = useRef<string | null>(null);
  const avisado = useRef(false);
  const v = estado.valores;

  useEffect(() => {
    if (estado.enviado && !avisado.current) {
      avisado.current = true;
      alTerminar();
    }
  }, [estado.enviado, alTerminar]);

  if (estado.enviado) return null;
  return (
    <form
      action={(datos: FormData) => {
        idEnvio.current ??= crypto.randomUUID();
        datos.set("id_envio", idEnvio.current);
        enviar(datos);
      }}
      key={JSON.stringify(v ?? {})}
      className="mt-2 space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4"
    >
      <p className="text-sm font-medium text-stone-800">Tus datos de contacto</p>
      <label className="block text-sm text-stone-700">
        Nombre
        <input name="nombre" required maxLength={120} autoComplete="name" defaultValue={v?.nombre} className={CAMPO} />
      </label>
      <label className="block text-sm text-stone-700">
        Celular (10 dígitos)
        <input name="celular" type="tel" required maxLength={20} autoComplete="tel" defaultValue={v?.celular} className={CAMPO} />
      </label>
      <label className="block text-sm text-stone-700">
        Ciudad
        <select name="ciudad" required defaultValue={v?.ciudad ?? ""} className={CAMPO}>
          <option value="" disabled>
            Elige tu ciudad
          </option>
          <option>Bogotá</option>
          <option>Medellín</option>
          <option>Cali</option>
        </select>
      </label>
      <label className="block text-sm text-stone-700">
        Correo (opcional)
        <input name="correo" type="email" maxLength={120} autoComplete="email" defaultValue={v?.correo} className={CAMPO} />
      </label>
      <label className="block text-sm text-stone-700">
        ¿Qué necesitas? (opcional)
        <textarea name="mensaje" rows={2} maxLength={600} defaultValue={v?.mensaje} className={CAMPO} />
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${CAMPO_TRAMPA}-chat`}>No llenes este campo</label>
        <input id={`${CAMPO_TRAMPA}-chat`} name={CAMPO_TRAMPA} type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-2 text-xs text-stone-600">
        <input type="checkbox" name="autorizacion" value="si" required className="mt-0.5" />
        <span>
          Autorizo a SolarAndes S.A.S. (empresa ficticia) a tratar mis datos para contactarme, según la Ley 1581 de 2012.
          Lo que escriba en &quot;¿Qué necesitas?&quot; lo lee un servicio de inteligencia artificial externo para
          clasificarlo; no recibe mi nombre, celular ni correo.
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
        className="w-full rounded-lg bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Enviar mis datos"}
      </button>
    </form>
  );
}
