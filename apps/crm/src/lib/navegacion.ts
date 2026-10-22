import type { Rol } from "@/lib/tipos";

export type Seccion = { href: string; nombre: string; roles: Rol[] };

// Qué secciones ve cada rol en el menú. Cada página vuelve a revisar el rol con exigirRol().
export const SECCIONES: Seccion[] = [
  { href: "/contactos", nombre: "Contactos", roles: ["gerente", "asesor"] },
  { href: "/visitas", nombre: "Mis visitas", roles: ["tecnico"] },
];

export function seccionesDe(rol: Rol): Seccion[] {
  return SECCIONES.filter((s) => s.roles.includes(rol));
}
