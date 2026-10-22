// Tipos de los datos del CRM. Reflejan las tablas de supabase/migraciones/001_esquema_crm.sql.

export type Rol = "gerente" | "asesor" | "tecnico" | "contadora";
export type Ciudad = "Bogotá" | "Medellín" | "Cali";
export type TipoContacto = "hogar" | "negocio";
export type CanalOrigen = "anuncios" | "whatsapp" | "web" | "referido";

export type Perfil = {
  id: string;
  codigo: string;
  nombre: string;
  email: string;
  rol: Rol;
  ciudad: Ciudad | null;
};

export type Contacto = {
  id: string;
  codigo: string;
  tipo: TipoContacto;
  nombre: string;
  empresa: string | null;
  telefono: string;
  email: string | null;
  ciudad: Ciudad;
  consumo_kwh_mes: number | null;
  canal_origen: CanalOrigen;
  creado_en: string;
  asesor: { nombre: string } | null;
};

export type VisitaTecnico = {
  id: string;
  tipo: "visita" | "tarea";
  descripcion: string;
  fecha: string;
  completada: boolean;
  cliente: string;
  empresa: string | null;
  telefono: string;
  direccion: string | null;
  ciudad: Ciudad;
};

export const CIUDADES: Ciudad[] = ["Bogotá", "Medellín", "Cali"];

export const NOMBRE_ROL: Record<Rol, string> = {
  gerente: "Gerente",
  asesor: "Asesor comercial",
  tecnico: "Técnico",
  contadora: "Contadora",
};

export const NOMBRE_CANAL: Record<CanalOrigen, string> = {
  anuncios: "Anuncios",
  whatsapp: "WhatsApp",
  web: "Web",
  referido: "Referido",
};
