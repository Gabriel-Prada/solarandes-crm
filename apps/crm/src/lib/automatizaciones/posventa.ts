/**
 * El texto del recordatorio de mantenimiento al cliente (flujo 6 de la fase 3). La base de datos decide a
 * quién y cuándo (tomar_posventa, migración 018). Sin precios: eso lo define el asesor. Texto plano.
 * Todo pasa por destino seguro (00b): los clientes del set de datos nunca lo reciben. Se prueba solo
 * (posventa.test.ts).
 */

export type AvisoDeLaBase = {
  id: string;
  meses: number;
  para: string;
  cliente: string; // el nombre de la persona (en un negocio sin persona, el del negocio)
  empresa: string | null;
  responsable: string; // quien tiene la tarea de agendarlo: el asesor, o la gerente si el asesor no está
};

export type CorreoDePosventa = { id: string; para: string; quien: string; asunto: string; texto: string };

export function armarRecordatorio(a: AvisoDeLaBase): CorreoDePosventa {
  // Un negocio sin nombre de persona trae el nombre del negocio en "cliente": no se saluda "Hola, Ferretería"
  const soloEmpresa = Boolean(a.empresa) && a.cliente === a.empresa;
  const saludo = soloEmpresa ? "Hola:" : `Hola, ${a.cliente.split(" ")[0]}:`;
  const tiempo = a.meses % 12 === 0 ? (a.meses === 12 ? "un año" : `${a.meses / 12} años`) : `${a.meses} meses`;
  const sistema = a.empresa ? `el sistema solar de ${a.empresa}` : "tu sistema solar";

  return {
    id: a.id,
    para: a.para,
    quien: a.empresa ?? a.cliente,
    asunto: "Es hora del mantenimiento de tu sistema solar",
    texto: [
      saludo,
      `Ya pasaron ${tiempo} desde la instalación de ${sistema}. Para que siga produciendo lo mismo, te recomendamos un mantenimiento: limpieza de los paneles y revisión del inversor.`,
      `${a.responsable} te contactará en estos días para agendarlo. Si prefieres, responde este correo.`,
      "SolarAndes S.A.S.",
    ].join("\n\n"),
  };
}
