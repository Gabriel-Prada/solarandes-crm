import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EtiquetaEtapa } from "@/components/etiqueta-etapa";
import {
  formatoFecha,
  formatoFechaHora,
  formatoNumero,
  formatoPesos,
  formatoTelefono,
} from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import {
  NOMBRE_ACTIVIDAD,
  NOMBRE_CANAL,
  NOMBRE_ETAPA,
  NOMBRE_MOTIVO,
  type Actividad,
  type Contacto,
  type Cotizacion,
  type Etapa,
  type Oportunidad,
} from "@/lib/tipos";

import { BotonCompletar } from "./boton-completar";
import { FormularioActividad } from "./formulario-actividad";

export async function generateMetadata({ params }: PageProps<"/contactos/[codigo]">): Promise<Metadata> {
  const { codigo } = await params;
  return { title: codigo };
}

type Paso = { oportunidad_id: string; etapa_nueva: Etapa; fecha: string };

export default async function FichaContacto({ params }: PageProps<"/contactos/[codigo]">) {
  const perfil = await exigirRol("gerente", "asesor");
  const { codigo } = await params;
  const supabase = await crearClienteSupabase();

  // Si el contacto no existe o es de otro asesor, la base de datos no lo devuelve: 404
  const { data: contacto } = await supabase
    .from("contactos")
    .select(
      "id, codigo, tipo, nombre, empresa, telefono, email, ciudad, direccion, estrato, consumo_kwh_mes, canal_origen, creado_en, asesor:perfiles!contactos_asesor_id_fkey(nombre)",
    )
    .eq("codigo", codigo)
    .maybeSingle<Contacto & { direccion: string | null; estrato: number | null }>();
  if (!contacto) notFound();

  const [{ data: oportunidades }, { data: actividades }] = await Promise.all([
    supabase
      .from("oportunidades")
      .select("id, codigo, nombre, tipo, etapa, potencia_kwp, valor_cop, probabilidad, motivo_perdida, creada_en, actualizada_en, fecha_cierre")
      .eq("contacto_id", contacto.id)
      .order("creada_en", { ascending: false })
      .returns<Oportunidad[]>(),
    supabase
      .from("actividades")
      .select("id, tipo, descripcion, fecha, completada, oportunidad:oportunidades(codigo), usuario:perfiles(nombre)")
      .eq("contacto_id", contacto.id)
      .order("fecha", { ascending: false })
      .returns<Actividad[]>(),
  ]);

  const idsOportunidades = (oportunidades ?? []).map((o) => o.id);
  const [{ data: cotizaciones }, { data: historial }] = await Promise.all([
    supabase
      .from("cotizaciones")
      .select("id, numero, oportunidad_id, version, fecha, potencia_kwp, num_paneles, descuento_pct, valor_total, estado")
      .in("oportunidad_id", idsOportunidades)
      .order("fecha")
      .returns<Cotizacion[]>(),
    supabase
      .from("historial_etapas")
      .select("oportunidad_id, etapa_nueva, fecha")
      .in("oportunidad_id", idsOportunidades)
      .order("fecha")
      .returns<Paso[]>(),
  ]);

  const pendientes = (actividades ?? []).filter((a) => !a.completada);
  const realizadas = (actividades ?? []).filter((a) => a.completada);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/contactos" className="text-sm text-stone-500 hover:text-stone-900">
        ← Contactos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-stone-500">{contacto.codigo}</p>
          <h1 className="text-2xl font-semibold">{contacto.empresa ?? contacto.nombre}</h1>
          {contacto.empresa && <p className="text-stone-600">{contacto.nombre}</p>}
        </div>
        <div className="flex gap-2">
          <a
            href={`tel:${contacto.telefono}`}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-100"
          >
            Llamar
          </a>
          <a
            href={`https://wa.me/${contacto.telefono.replace("+", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-100"
          >
            WhatsApp
          </a>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Columna izquierda: datos y ventas */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Datos</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Dato nombre="Teléfono">{formatoTelefono(contacto.telefono)}</Dato>
              <Dato nombre="Correo">{contacto.email ?? "—"}</Dato>
              <Dato nombre="Dirección">
                {[contacto.direccion, contacto.ciudad].filter(Boolean).join(", ")}
              </Dato>
              <Dato nombre="Tipo">
                {contacto.tipo === "hogar" ? `Hogar${contacto.estrato ? `, estrato ${contacto.estrato}` : ""}` : "Negocio"}
              </Dato>
              <Dato nombre="Consumo">
                {contacto.consumo_kwh_mes != null ? `${formatoNumero(contacto.consumo_kwh_mes)} kWh/mes` : "—"}
              </Dato>
              <Dato nombre="Llegó por">{NOMBRE_CANAL[contacto.canal_origen]}</Dato>
              <Dato nombre="Cliente desde">{formatoFecha(contacto.creado_en)}</Dato>
              {perfil.rol === "gerente" && <Dato nombre="Asesor">{contacto.asesor?.nombre ?? "—"}</Dato>}
            </dl>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Ventas</h2>
            {(oportunidades ?? []).map((o) => (
              <article key={o.id} className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-stone-500">{o.codigo}</p>
                    <p className="font-medium">{o.nombre}</p>
                  </div>
                  <EtiquetaEtapa etapa={o.etapa} />
                </div>
                <p className="mt-2 text-sm text-stone-600">
                  {o.valor_cop != null && <span className="font-medium text-stone-900">{formatoPesos(o.valor_cop)}</span>}
                  {o.etapa === "perdido" && o.motivo_perdida && ` · ${NOMBRE_MOTIVO[o.motivo_perdida]}`}
                  {o.etapa !== "perdido" && o.etapa !== "ganado" && ` · ${o.probabilidad} % de probabilidad`}
                </p>

                {/* El recorrido sale de historial_etapas, que la base de datos llena sola */}
                <ol className="mt-3 flex flex-wrap items-center gap-1 text-xs text-stone-500">
                  {(historial ?? [])
                    .filter((h) => h.oportunidad_id === o.id)
                    .map((h, i) => (
                      <li key={`${h.etapa_nueva}-${h.fecha}`} className="flex items-center gap-1">
                        {i > 0 && <span aria-hidden="true">→</span>}
                        <span title={formatoFechaHora(h.fecha)}>
                          {NOMBRE_ETAPA[h.etapa_nueva]}{" "}
                          <span className="text-stone-400">{formatoFecha(h.fecha)}</span>
                        </span>
                      </li>
                    ))}
                </ol>

                {(cotizaciones ?? [])
                  .filter((c) => c.oportunidad_id === o.id)
                  .map((c) => (
                    <div
                      key={c.id}
                      className={`mt-3 flex flex-wrap justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm ${
                        c.estado === "reemplazada" ? "text-stone-400 line-through" : ""
                      }`}
                    >
                      <span>
                        <span className="font-mono text-xs">{c.numero}</span> · {c.num_paneles} paneles,{" "}
                        {formatoNumero(c.potencia_kwp)} kWp
                        {c.descuento_pct > 0 && ` · ${c.descuento_pct} % dto.`}
                      </span>
                      <span className="font-medium">{formatoPesos(c.valor_total)}</span>
                    </div>
                  ))}
              </article>
            ))}
            {(oportunidades ?? []).length === 0 && <p className="text-sm text-stone-500">Sin ventas registradas.</p>}
          </section>
        </div>

        {/* Columna derecha: actividades */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Registrar actividad</h2>
            <FormularioActividad
              contactoId={contacto.id}
              oportunidades={(oportunidades ?? []).map((o) => ({ id: o.id, codigo: o.codigo, nombre: o.nombre }))}
            />
          </section>

          {pendientes.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Pendientes</h2>
              {pendientes.map((a) => (
                <ItemActividad key={a.id} actividad={a} accion={<BotonCompletar actividadId={a.id} />} />
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Historial</h2>
            {realizadas.map((a) => (
              <ItemActividad key={a.id} actividad={a} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function Dato({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-stone-500">{nombre}</dt>
      <dd className="text-stone-900">{children}</dd>
    </>
  );
}

function ItemActividad({ actividad: a, accion }: { actividad: Actividad; accion?: React.ReactNode }) {
  return (
    <article className="flex gap-3 rounded-xl border border-stone-200 bg-white p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-stone-500">
          <span className="font-medium text-stone-700">{NOMBRE_ACTIVIDAD[a.tipo]}</span> ·{" "}
          <span className="first-letter:uppercase">{formatoFechaHora(a.fecha)}</span>
          {a.usuario && ` · ${a.usuario.nombre}`}
          {a.oportunidad && <span className="font-mono"> · {a.oportunidad.codigo}</span>}
        </p>
        <p className="mt-1 text-stone-900">{a.descripcion}</p>
      </div>
      {accion}
    </article>
  );
}
