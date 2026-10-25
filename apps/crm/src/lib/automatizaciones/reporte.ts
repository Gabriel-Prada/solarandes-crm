/**
 * El texto del reporte semanal para la gerente (flujo 5 de la fase 3). La base de datos calcula las
 * cifras (tomar_reporte_semanal, migración 018); aquí solo se escribe el correo. Solo cifras y nombres
 * del equipo, nunca de clientes. Se prueba solo (reporte.test.ts).
 */

import { formatoPesosCorto } from "@/lib/formato";
import { NOMBRE_CANAL, NOMBRE_MOTIVO, type CanalOrigen, type MotivoPerdida } from "@/lib/tipos";

type DeAsesor = { leads: number; ganadas: number; valor_ganado: number };

export type Movimiento = {
  leads: number;
  leads_por_canal: Partial<Record<CanalOrigen, number>>;
  ganadas: number;
  valor_ganado: number;
  ampliaciones: number;
  ganadas_sin_valor: number;
  perdidas: number;
  motivos: Partial<Record<MotivoPerdida, number>>;
  por_asesor: Record<string, DeAsesor>;
};

export type Foto = {
  abiertas: number;
  pipeline: number;
  pipeline_ponderado: number;
  sin_seguimiento: number;
  sin_seguimiento_por_asesor: Record<string, number>;
};

export type ReporteDeLaBase = {
  lunes: string; // "2026-10-12"
  llega_tarde: boolean;
  destinatario: { nombre: string; email: string };
  semana: Movimiento;
  anterior: Movimiento;
  foto: Foto;
  foto_anterior: Foto | null;
};

export type CorreoDelReporte = { id: string; para: string; quien: string; asunto: string; texto: string };

// Las fechas del reporte son días sin hora: se leen y se escriben en UTC para que no se corran un día
function dia(iso: string, opciones: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-CO", { ...opciones, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function sumarDias(iso: string, dias: number): string {
  const fecha = new Date(`${iso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
// Siempre los dos números: con cifras tan pequeñas, un porcentaje ("de 1 a 3, +200 %") confunde
const antes = (n: number | undefined | null) => (n == null ? "antes: sin dato" : `antes ${n}`);
const antesPesos = (n: number | undefined | null) => (n == null ? "antes: sin dato" : `antes ${formatoPesosCorto(n)}`);

/** El correo del reporte. crm es la dirección del CRM, sin "/" al final, para el enlace al panel. */
export function armarReporte(r: ReporteDeLaBase, crm: string): CorreoDelReporte {
  const { semana: s, anterior: a, foto: f, foto_anterior: fa } = r;
  const domingo = sumarDias(r.lunes, 6);
  const rango = `del lunes ${dia(r.lunes, { day: "numeric", month: "long" })} al domingo ${dia(domingo, { day: "numeric", month: "long" })}`;

  const canales = (Object.keys(NOMBRE_CANAL) as CanalOrigen[])
    .filter((c) => s.leads_por_canal[c] || a.leads_por_canal[c])
    .map((c) => `- ${NOMBRE_CANAL[c]}: ${s.leads_por_canal[c] ?? 0} (${antes(a.leads_por_canal[c] ?? 0)})`);

  const detalleGanadas = [
    s.ampliaciones ? `De ellas, ${plural(s.ampliaciones, "es ampliación", "son ampliaciones")}.` : "",
    s.ganadas_sin_valor ? `${plural(s.ganadas_sin_valor, "no tiene", "no tienen")} valor definido.` : "",
  ].filter(Boolean);
  const motivos = (Object.entries(s.motivos) as [MotivoPerdida, number][])
    .sort((x, y) => y[1] - x[1])
    .map(([m, n]) => `${NOMBRE_MOTIVO[m].toLowerCase()} ${n}`);

  const asesores = Object.keys({ ...s.por_asesor, ...f.sin_seguimiento_por_asesor })
    .sort()
    .map((nombre) => {
      const x = s.por_asesor[nombre] ?? { leads: 0, ganadas: 0, valor_ganado: 0 };
      const ganadas = x.ganadas ? `${plural(x.ganadas, "ganada", "ganadas")} por ${formatoPesosCorto(x.valor_ganado)}` : "0 ganadas";
      return `- ${nombre}: ${plural(x.leads, "lead", "leads")}, ${ganadas}; hoy ${f.sin_seguimiento_por_asesor[nombre] ?? 0} con 7+ días sin actividad`;
    });

  const partes = [
    `Hola, ${r.destinatario.nombre.split(" ")[0]}:`,
    `Este es el resumen de la semana ${rango}, comparado con la semana anterior.` +
      (r.llega_tarde ? " Llega tarde: el lunes no se pudo enviar (el sistema estaba apagado o falló)." : ""),
    [`LEADS NUEVOS: ${s.leads} (${antes(a.leads)})`, ...canales].join("\n"),
    [
      "VENTAS DE LA SEMANA",
      `- Ganadas: ${s.ganadas} por ${formatoPesosCorto(s.valor_ganado)} (${antes(a.ganadas)} por ${formatoPesosCorto(a.valor_ganado)}).${detalleGanadas.length ? ` ${detalleGanadas.join(" ")}` : ""}`,
      `- Perdidas: ${s.perdidas} (${antes(a.perdidas)}).${motivos.length ? ` Motivos: ${motivos.join(", ")}.` : ""}`,
    ].join("\n"),
    [
      "LO QUE HAY ABIERTO HOY",
      `- ${plural(f.abiertas, "venta abierta", "ventas abiertas")} por ${formatoPesosCorto(f.pipeline)} (${fa ? `antes ${fa.abiertas} por ${formatoPesosCorto(fa.pipeline)}` : "antes: sin dato"})`,
      `- Valor ponderado por la probabilidad de cada etapa: ${formatoPesosCorto(f.pipeline_ponderado)} (${antesPesos(fa?.pipeline_ponderado)})`,
      `- Con 7+ días sin actividad: ${f.sin_seguimiento} (${antes(fa?.sin_seguimiento)})`,
    ].join("\n"),
    ["POR ASESOR (la semana y lo de hoy)", ...asesores].join("\n"),
    `Las cifras de la semana van de lunes a domingo; el panel del CRM muestra los últimos 30 días, así que no coinciden. Panel: ${crm}/panel`,
    "Lo envía el reporte automático de SolarAndes, los lunes.",
  ];

  return {
    id: r.lunes,
    para: r.destinatario.email,
    quien: r.destinatario.nombre,
    asunto: `Reporte semanal SolarAndes: ${dia(r.lunes, { day: "numeric", month: "short" })} al ${dia(domingo, { day: "numeric", month: "short" })}${r.llega_tarde ? " (llega tarde)" : ""}`,
    texto: partes.join("\n\n"),
  };
}
