import type { Metadata } from "next";

import { Barras, Columnas, VerTabla } from "@/components/graficas";
import { formatoNumero, formatoPesos, formatoPesosCorto } from "@/lib/formato";
import { entraronAlEmbudo, porcentaje, variacion as calcularVariacion, type Panel } from "@/lib/panel";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { NOMBRE_CANAL, NOMBRE_ETAPA, NOMBRE_MOTIVO } from "@/lib/tipos";

export const metadata: Metadata = { title: "Panel" };

function nombreMes(mes: string, largo = false): string {
  const [anio, numero] = mes.split("-").map(Number);
  const opciones: Intl.DateTimeFormatOptions = largo
    ? { month: "long", year: "numeric", timeZone: "UTC" }
    : { month: "short", timeZone: "UTC" };
  return new Intl.DateTimeFormat("es-CO", opciones).format(new Date(Date.UTC(anio, numero - 1, 1))).replace(".", "");
}

export default async function PaginaPanel() {
  await exigirRol("gerente");
  const supabase = await crearClienteSupabase();
  const { data, error } = await supabase.rpc("panel_gerente");
  const panel = data as Panel | null; // la función devuelve un solo objeto JSON con la forma de Panel

  if (error || !panel) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        No se pudo cargar el panel. Intenta de nuevo.
      </p>
    );
  }

  const { kpis } = panel;
  const variacion = calcularVariacion(kpis.valor_30, kpis.valor_30_previo);
  const entraron = entraronAlEmbudo(panel);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Panel</h1>
        <p className="text-sm text-stone-500">Cómo va el negocio. Las cifras se calculan en el momento.</p>
      </header>

      {/* Indicadores: cuando la respuesta es un número, la gráfica es el número */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <Tarjeta etiqueta="Ventas ganadas · últimos 30 días">
          <p className="text-5xl font-semibold tracking-tight whitespace-nowrap">{formatoPesosCorto(kpis.valor_30)}</p>
          <p className="mt-2 text-sm text-stone-600">
            {kpis.ganadas_30} {kpis.ganadas_30 === 1 ? "instalación" : "instalaciones"}
            {variacion != null && (
              <span className={variacion >= 0 ? "text-[#006300]" : "text-red-700"}>
                {" "}
                · <span aria-hidden="true">{variacion >= 0 ? "▲" : "▼"}</span>{" "}
                {variacion >= 0 ? "subió" : "bajó"} {Math.abs(variacion)} % vs. los 30 días anteriores
              </span>
            )}
          </p>
        </Tarjeta>
        <Tarjeta etiqueta="Tasa de cierre · 90 días">
          <p className="text-3xl font-semibold">{porcentaje(kpis.ganadas_90, kpis.cerradas_90)} %</p>
          <p className="mt-2 text-sm text-stone-600">
            {kpis.ganadas_90} ganadas de {kpis.cerradas_90} cerradas
          </p>
        </Tarjeta>
        <Tarjeta etiqueta="En proceso (ponderado)">
          <p className="text-3xl font-semibold whitespace-nowrap">{formatoPesosCorto(kpis.pipeline_ponderado)}</p>
          <p className="mt-2 text-sm text-stone-600">
            {kpis.abiertas} ventas abiertas por {formatoPesosCorto(kpis.pipeline)}, según su probabilidad
          </p>
        </Tarjeta>
        <Tarjeta etiqueta="Sin seguimiento · 7+ días">
          <p className="text-3xl font-semibold">{kpis.sin_seguimiento}</p>
          <p className="mt-2 text-sm text-red-700">
            <span aria-hidden="true">⚠</span> {porcentaje(kpis.sin_seguimiento, kpis.abiertas)} % de las abiertas necesita
            atención
          </p>
        </Tarjeta>
      </section>

      <Seccion titulo="Ventas ganadas por mes" subtitulo="Valor de las ventas cerradas como ganadas, últimos 12 meses">
        <Columnas
          titulo="Ventas ganadas por mes"
          datos={panel.por_mes.map((m) => ({
            etiqueta: nombreMes(m.mes),
            etiquetaLarga: nombreMes(m.mes, true),
            valor: m.valor,
            detalle: `${formatoPesosCorto(m.valor)} · ${m.ventas} ventas`,
          }))}
        />
        <VerTabla
          columnas={["Mes", "Ventas", "Valor"]}
          filas={panel.por_mes.map((m) => [m.mes, m.ventas, formatoPesos(m.valor)])}
        />
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion titulo="Embudo de ventas" subtitulo="Cuántas oportunidades llegaron a cada etapa">
          <Barras
            titulo="Embudo de ventas"
            datos={panel.embudo.map((e) => ({
              etiqueta: NOMBRE_ETAPA[e.etapa],
              valor: e.ventas,
              detalle: `${formatoNumero(e.ventas)} · ${porcentaje(e.ventas, entraron)} %`,
            }))}
          />
          <VerTabla
            columnas={["Etapa", "Ventas", "% de las que entraron"]}
            filas={panel.embudo.map((e) => [NOMBRE_ETAPA[e.etapa], e.ventas, `${porcentaje(e.ventas, entraron)} %`])}
          />
        </Seccion>

        <Seccion titulo="¿En qué etapa se pierden?" subtitulo="Ventas perdidas según la etapa en la que estaban">
          <Barras
            titulo="Ventas perdidas por etapa"
            datos={panel.perdidas_por_etapa.map((p) => ({
              etiqueta: NOMBRE_ETAPA[p.etapa],
              valor: p.ventas,
              detalle: formatoNumero(p.ventas),
            }))}
          />
          <VerTabla
            columnas={["Etapa", "Perdidas"]}
            filas={panel.perdidas_por_etapa.map((p) => [NOMBRE_ETAPA[p.etapa], p.ventas])}
          />
        </Seccion>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion titulo="¿Por qué se pierden?" subtitulo="Motivo registrado al cerrar como perdida">
          <Barras
            titulo="Motivos de pérdida"
            datos={panel.motivos.map((m) => ({
              etiqueta: NOMBRE_MOTIVO[m.motivo],
              valor: m.ventas,
              detalle: formatoNumero(m.ventas),
            }))}
          />
          <VerTabla
            columnas={["Motivo", "Ventas"]}
            filas={panel.motivos.map((m) => [NOMBRE_MOTIVO[m.motivo], m.ventas])}
          />
        </Seccion>

        <Seccion titulo="Canales" subtitulo="De dónde llegan los leads y cuáles se convierten (desde que hay registros)">
          <Tabla
            columnas={["Canal", "Leads", "Ganadas", "Cierre", "Vendido"]}
            filas={panel.canales.map((c) => [
              NOMBRE_CANAL[c.canal],
              formatoNumero(c.leads),
              formatoNumero(c.ganadas),
              `${porcentaje(c.ganadas, c.cerradas)} %`,
              formatoPesosCorto(c.valor),
            ])}
          />
          <p className="mt-3 text-xs text-stone-500">Cierre = ganadas ÷ cerradas (ganadas + perdidas).</p>
        </Seccion>
      </div>

      <Seccion titulo="Asesores" subtitulo="Resultados de cada asesor desde que hay registros">
        <Tabla
          columnas={["Asesor", "Ciudad", "Abiertas", "Ganadas", "Cierre", "Vendido", "7+ días sin actividad"]}
          filas={panel.asesores.map((a) => [
            a.nombre,
            a.ciudad,
            formatoNumero(a.abiertas),
            formatoNumero(a.ganadas),
            `${porcentaje(a.ganadas, a.cerradas)} %`,
            formatoPesosCorto(a.valor),
            formatoNumero(a.sin_seguimiento),
          ])}
        />
      </Seccion>
    </div>
  );
}

function Tarjeta({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-500">{etiqueta}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Seccion({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="font-semibold">{titulo}</h2>
      <p className="mb-4 text-sm text-stone-500">{subtitulo}</p>
      {children}
    </section>
  );
}

function Tabla({ columnas, filas }: { columnas: string[]; filas: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 text-xs text-stone-500">
          <tr>
            {columnas.map((c, i) => (
              <th key={c} className={`py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 tabular-nums">
          {filas.map((fila) => (
            <tr key={fila[0]}>
              {fila.map((celda, i) => (
                <td key={i} className={`py-2 ${i > 0 ? "text-right" : "font-medium"}`}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
