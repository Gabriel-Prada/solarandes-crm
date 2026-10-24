import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContactoDelCrm } from "./analizar";

/**
 * Todos los contactos del CRM, con los datos que se comparan para encontrar duplicados.
 * Lo usan la importación de CSV y la puerta de las automatizaciones.
 *
 * Supabase entrega un máximo de filas por consulta: se piden por páginas.
 */
export async function leerContactos(supabase: SupabaseClient): Promise<ContactoDelCrm[]> {
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
