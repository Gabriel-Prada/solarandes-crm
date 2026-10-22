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

export type Etapa = "nuevo" | "contactado" | "visita_agendada" | "cotizado" | "negociacion" | "ganado" | "perdido";
export type MotivoPerdida = "precio" | "competencia" | "no_respondio" | "techo_no_apto" | "sin_financiacion" | "aplazo";
export type TipoActividad = "llamada" | "whatsapp" | "correo" | "visita" | "nota" | "tarea";

export type Oportunidad = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "nueva" | "ampliacion";
  etapa: Etapa;
  potencia_kwp: number | null;
  valor_cop: number | null;
  probabilidad: number;
  motivo_perdida: MotivoPerdida | null;
  creada_en: string;
  actualizada_en: string;
  fecha_cierre: string | null;
};

export type Actividad = {
  id: string;
  tipo: TipoActividad;
  descripcion: string;
  fecha: string;
  completada: boolean;
  oportunidad: { codigo: string } | null;
  usuario: { nombre: string } | null;
};

export type Cotizacion = {
  id: string;
  numero: string;
  oportunidad_id: string;
  version: number;
  fecha: string;
  potencia_kwp: number;
  num_paneles: number;
  descuento_pct: number;
  valor_total: number;
  estado: "enviada" | "aceptada" | "rechazada" | "reemplazada";
};

// El orden del embudo de ventas (docs/requisitos.md, sección 3)
export const ETAPAS: Etapa[] = ["nuevo", "contactado", "visita_agendada", "cotizado", "negociacion", "ganado", "perdido"];

export const NOMBRE_ETAPA: Record<Etapa, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  visita_agendada: "Visita agendada",
  cotizado: "Cotizado",
  negociacion: "Negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};

export const NOMBRE_MOTIVO: Record<MotivoPerdida, string> = {
  precio: "Le pareció caro",
  competencia: "Eligió a la competencia",
  no_respondio: "Dejó de responder",
  techo_no_apto: "Techo no apto",
  sin_financiacion: "Sin financiación",
  aplazo: "Aplazó la decisión",
};

export const NOMBRE_ACTIVIDAD: Record<TipoActividad, string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  correo: "Correo",
  visita: "Visita técnica",
  nota: "Nota",
  tarea: "Tarea",
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
