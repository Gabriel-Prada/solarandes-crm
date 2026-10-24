import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la llave de servicio: no actúa en nombre de ninguna persona y se salta
 * los permisos por fila (RLS). Solo lo usa la puerta de las automatizaciones, que no tiene sesión,
 * para leer contactos y llamar a capturar_lead(). Nunca debe llegar al navegador ("server-only").
 *
 * Ojo: la migración 011 limita lo que esta llave hace en las TABLAS (leer 6 columnas de contactos,
 * escribir solo con capturar_lead), pero la misma llave también abre la administración de usuarios
 * de Supabase (listar usuarios, cambiar contraseñas). Si se filtra, hay que cambiarla de inmediato.
 */
export function crearClienteDeServicio() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !llave) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en el servidor");
  return createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });
}
