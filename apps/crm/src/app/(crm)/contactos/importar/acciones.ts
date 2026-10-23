"use server";

import { cotizar } from "@/lib/cotizacion";
import { analizar, TAMANO_MAXIMO, type Asesor, type ContactoDelCrm, type Estado } from "@/lib/importar/analizar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { NOMBRE_CANAL, type CanalOrigen, type Ciudad } from "@/lib/tipos";

const PREFIJO_NOTA = "Nota del archivo importado: ";

export type FilaVista = {
  fila: number;
  nombre: string;
  telefono: string | null;
  ciudad: string | null;
  tipo: string | null;
  consumo: number | null;
  asesor: string | null;
  estado: Estado;
  detalle: string;
};

export type EstadoImportacion = {
  error: string | null;
  filas: FilaVista[];
  importado: {
    creados: { fila: number; codigo: string }[];
    fallidos: { fila: number; motivo: string }[];
    avisos: string[];
  } | null;
};

type Supabase = Awaited<ReturnType<typeof crearClienteSupabase>>;

const vacio = (error: string): EstadoImportacion => ({ error, filas: [], importado: null });

/** Todos los contactos del CRM. Supabase entrega un máximo de filas por consulta: se piden por páginas. */
async function leerContactos(supabase: Supabase): Promise<ContactoDelCrm[]> {
  const contactos: ContactoDelCrm[] = [];
  const PAGINA = 1000;
  // Se avanza tantas filas como llegaron y se para en una página vacía: así no importa si el
  // servidor entrega menos filas por página de las que se pidieron
  let desde = 0;
  while (true) {
    const { data, error } = await supabase
      .from("contactos")
      .select("codigo, nombre, empresa, telefono, email, ciudad")
      .order("codigo")
      .range(desde, desde + PAGINA - 1);
    if (error) throw error;
    if (data.length === 0) return contactos;
    for (const c of data) {
      contactos.push({ fila: 0, codigo: c.codigo, nombre: c.nombre, empresa: c.empresa, telefono: c.telefono, correo: c.email, ciudad: c.ciudad });
    }
    desde += data.length;
  }
}

/**
 * "ver" analiza el archivo y devuelve la vista previa. "importar" lo vuelve a analizar desde cero
 * (no confía en la vista previa que vio el navegador) y crea solo las filas listas para crear.
 */
export async function importarContactos(_previo: EstadoImportacion, formulario: FormData): Promise<EstadoImportacion> {
  await exigirRol("gerente");

  const archivo = formulario.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return vacio("Elige un archivo CSV.");
  if (archivo.size > TAMANO_MAXIMO) return vacio("El archivo pesa más de 900 KB. Pártelo en varios.");
  const canal = String(formulario.get("canal") ?? "");
  // Object.hasOwn y no "in": "in" también aceptaría cosas heredadas como "toString"
  if (!Object.hasOwn(NOMBRE_CANAL, canal)) return vacio("Elige el canal de origen para las filas que no lo traen.");

  const supabase = await crearClienteSupabase();
  const { data: asesores, error: errorAsesores } = await supabase
    .from("perfiles")
    .select("id, codigo, nombre, email, ciudad")
    .eq("rol", "asesor")
    .eq("activo", true)
    .order("nombre")
    .returns<Asesor[]>();
  if (errorAsesores || !asesores) return vacio("No se pudo leer la lista de asesores. Intenta de nuevo.");

  let analisis;
  try {
    analisis = analizar(await archivo.text(), await leerContactos(supabase), asesores, canal as CanalOrigen);
  } catch {
    return vacio("No se pudo leer el CRM para comparar. Intenta de nuevo.");
  }
  if (analisis.error) return vacio(analisis.error);

  const nombreAsesor = new Map(asesores.map((a) => [a.id, a.nombre]));
  const filas: FilaVista[] = analisis.filas.map((f) => ({
    fila: f.fila,
    nombre: [f.contacto.empresa, f.contacto.nombre].filter(Boolean).join(" · ") || f.original,
    telefono: f.contacto.telefono,
    ciudad: f.contacto.ciudad,
    tipo: f.contacto.tipo,
    consumo: f.contacto.consumo,
    asesor: f.contacto.asesorId ? (nombreAsesor.get(f.contacto.asesorId) ?? null) : null,
    estado: f.estado,
    detalle: f.detalle,
  }));
  if (formulario.get("accion") !== "importar") return { error: null, filas, importado: null };

  // Cada contacto se crea con su primera venta, con la misma función del formulario de nuevo contacto
  const importado: NonNullable<EstadoImportacion["importado"]> = { creados: [], fallidos: [], avisos: [] };
  const notasPorCodigo = new Map<string, { asesorId: string; notas: string[] }>();
  for (const f of analisis.filas.filter((fila) => fila.estado === "crear")) {
    const c = f.contacto;
    const estimado = cotizar(c.consumo!, c.ciudad as Ciudad);
    const { data: codigo, error } = await supabase.rpc("crear_contacto_con_venta", {
      contacto: {
        tipo: c.tipo, nombre: c.nombre ?? c.empresa, empresa: c.tipo === "negocio" ? c.empresa : "",
        telefono: c.telefono, email: c.correo ?? "", ciudad: c.ciudad, direccion: "", estrato: null,
        consumo_kwh_mes: c.consumo, canal_origen: c.canal, asesor_id: c.asesorId,
      }, // prettier-ignore
      venta: {
        nombre: `Sistema ${estimado.potenciaInstaladaKwp} kWp - ${c.empresa ?? c.nombre}`,
        potencia_kwp: estimado.potenciaInstaladaKwp,
        valor_cop: estimado.valorTotal,
      },
    });
    if (error) {
      // 23505 = la base de datos rechazó un valor repetido (teléfono único, migración 005)
      const motivo = error.code === "23505" ? "ya existe un contacto con ese celular" : "la base de datos no aceptó los datos";
      importado.fallidos.push({ fila: f.fila, motivo });
      continue;
    }
    importado.creados.push({ fila: f.fila, codigo });
    if (c.notas.length > 0) notasPorCodigo.set(codigo, { asesorId: c.asesorId!, notas: c.notas });
  }

  // Las notas, todas juntas al final: dos consultas en total, no dos por contacto
  if (notasPorCodigo.size > 0) {
    const { data: nuevos, error } = await supabase.from("contactos").select("id, codigo").in("codigo", [...notasPorCodigo.keys()]);
    const actividades = (nuevos ?? []).flatMap(({ id, codigo }) =>
      notasPorCodigo.get(codigo)!.notas.map((nota) => ({
        contacto_id: id, usuario_id: notasPorCodigo.get(codigo)!.asesorId, tipo: "nota",
        descripcion: PREFIJO_NOTA + nota, fecha: new Date().toISOString(), completada: true,
      })), // prettier-ignore
    );
    const guardado = error ? { error } : await supabase.from("actividades").insert(actividades);
    if (guardado.error || actividades.length === 0) {
      importado.avisos.push("Los contactos se crearon, pero sus notas no se pudieron guardar. Agrégalas desde la ficha de cada uno.");
    }
  }
  return { error: null, filas, importado };
}
