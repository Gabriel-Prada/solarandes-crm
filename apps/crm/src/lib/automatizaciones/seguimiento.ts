/**
 * El texto de los correos de seguimiento (flujo 3 de la fase 3). La base de datos decide qué va en cada
 * resumen (tomar_resumenes_seguimiento, migración 016); aquí solo se escribe el correo. No toca la base
 * de datos ni la red, así que se prueba sola (seguimiento.test.ts).
 *
 * El correo va en texto plano: un nombre que llegó por el formulario público nunca se interpreta como
 * HTML. Solo lleva código, nombre, etapa, días y enlace; nunca el celular ni el correo del cliente.
 */

import { NOMBRE_ETAPA, type Etapa } from "@/lib/tipos";

export type ItemSeguimiento = {
  tipo: "venta" | "tarea";
  nivel: 3 | 7;
  contacto: string;
  cliente: string;
  dias: number;
  asesor: string;
  asesor_activo: boolean;
  oportunidad_id: string | null;
  actividad_id: string | null;
  // Solo las ventas
  codigo?: string;
  etapa?: Etapa;
  // Solo las tareas
  descripcion?: string;
};

export type ResumenDeLaBase = {
  id: string;
  destinatario: { nombre: string; email: string; rol: string };
  es_gerente: boolean;
  items: ItemSeguimiento[];
  total_3: number;
  total_7_por_asesor: Record<string, number> | null;
};

export type CorreoDeSeguimiento = { id: string; para: string; quien: string; asunto: string; texto: string };

const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
const dias = (n: number) => plural(n, "día", "días");

function lineaVenta(i: ItemSeguimiento, crm: string, conAsesor = false): string {
  const etapa = i.etapa ? ` (${NOMBRE_ETAPA[i.etapa]})` : "";
  const deQuien = conAsesor ? ` · de ${i.asesor}${i.asesor_activo ? "" : ", que ya no está activo"}` : "";
  return `- ${i.codigo} · ${i.cliente}${etapa} · ${dias(i.dias)} sin actividad${deQuien}\n  ${crm}/contactos/${i.contacto}`;
}

function lineaTarea(i: ItemSeguimiento, crm: string): string {
  return `- ${i.descripcion} · ${i.cliente} · vencida hace ${dias(i.dias)}\n  ${crm}/contactos/${i.contacto}`;
}

const DESPEDIDA = "Lo envía el seguimiento automático de SolarAndes, de lunes a viernes.";

/** El correo de un resumen. crm es la dirección del CRM, sin "/" al final, para los enlaces. */
export function armarCorreo(r: ResumenDeLaBase, crm: string): CorreoDeSeguimiento {
  const nombre = r.destinatario.nombre.split(" ")[0];
  const tareas = r.items.filter((i) => i.tipo === "tarea");
  const siete = r.es_gerente ? r.items.filter((i) => i.tipo === "venta" && i.nivel === 7) : [];
  // Cada venta sale una sola vez: si ya va en las de 7+ días, no se repite en las de 3+
  const yaEnSiete = new Set(siete.map((i) => i.oportunidad_id));
  const tres = r.items.filter((i) => i.tipo === "venta" && i.nivel === 3 && !yaEnSiete.has(i.oportunidad_id));

  const partes: string[] = [`Hola, ${nombre}:`];
  const asunto: string[] = [];

  if (siete.length) {
    asunto.push(`${plural(siete.length, "venta llegó", "ventas llegaron")} a 7+ días sin actividad`);
    partes.push("Estas ventas llegaron a 7 o más días sin actividad:");
    const porAsesor = new Map<string, ItemSeguimiento[]>();
    for (const i of siete) porAsesor.set(i.asesor, [...(porAsesor.get(i.asesor) ?? []), i]);
    for (const [asesor, ventas] of porAsesor) {
      const total = r.total_7_por_asesor?.[asesor];
      const nota = ventas[0].asesor_activo
        ? total ? ` (${total} en total con 7+ días)` : ""
        : " (ya no está activo: hay que reasignar sus ventas)";
      partes.push(`${asesor}${nota}\n${ventas.map((i) => lineaVenta(i, crm)).join("\n")}`);
    }
  }

  if (tres.length) {
    asunto.push(`${plural(tres.length, "venta", "ventas")} con 3+ días sin actividad`);
    // A la gerente le llegan las de 3+ días que atiende ella: las suyas y las de asesores inactivos
    partes.push(
      r.es_gerente ? "A tu cargo, con 3 o más días sin actividad:" : "Estas ventas llevan 3 o más días sin actividad:",
      tres.map((i) => lineaVenta(i, crm, r.es_gerente && i.asesor !== r.destinatario.nombre)).join("\n"),
    );
  }

  if (tareas.length) {
    asunto.push(plural(tareas.length, "tarea vencida", "tareas vencidas"));
    partes.push("Tareas vencidas hace 3 o más días:", tareas.map((i) => lineaTarea(i, crm)).join("\n"));
  }

  if (r.total_3 > 0) {
    partes.push(
      `En total tienes ${plural(r.total_3, "venta", "ventas")} con 3+ días sin actividad. Están en el tablero: ${crm}/ventas`,
    );
  }
  partes.push(DESPEDIDA);

  return {
    id: r.id,
    para: r.destinatario.email,
    quien: r.destinatario.nombre,
    asunto: `Seguimiento: ${asunto.join(" y ")}`,
    texto: partes.join("\n\n"),
  };
}
