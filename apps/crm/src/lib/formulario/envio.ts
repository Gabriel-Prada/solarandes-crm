/**
 * Lee lo que llega del formulario público (/cotiza): el campo trampa, el número del envío, la
 * autorización de datos y los campos del lead. La limpieza de los datos es la de siempre
 * (prepararLead, con las reglas de la fase 2); aquí solo se ordena lo propio del formulario.
 */

// La versión del texto de autorización que vio la persona (Ley 1581: hay que poder demostrarla)
// Cambia cuando cambia el texto que acepta la persona (2026-10-ia: el mensaje lo lee un servicio de IA)
export const VERSION_AUTORIZACION = "2026-10-ia";

// El número del envío lo crea el navegador al enviar (crypto.randomUUID()), nunca el servidor:
// Next guarda la página como fija y todos los visitantes recibirían el mismo
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// El campo trampa: invisible para las personas. Un robot que llena todo lo llena también
export const CAMPO_TRAMPA = "sitio_web";

export type CamposDelLead = {
  nombre: string;
  empresa: string;
  celular: string;
  ciudad: string;
  correo: string;
  consumo: string;
  mensaje: string;
};

export type EnvioFormulario = {
  trampa: boolean;
  idEnvio: string | null;
  autorizo: boolean;
  campos: CamposDelLead;
};

export function leerEnvio(valor: (campo: string) => string): EnvioFormulario {
  const texto = (campo: string) => valor(campo).trim().slice(0, 2000);
  const idEnvio = texto("id_envio");
  return {
    trampa: texto(CAMPO_TRAMPA) !== "",
    idEnvio: UUID.test(idEnvio) ? idEnvio.toLowerCase() : null,
    autorizo: texto("autorizacion") === "si",
    campos: {
      nombre: texto("nombre"),
      empresa: texto("empresa"),
      celular: texto("celular"),
      ciudad: texto("ciudad"),
      correo: texto("correo"),
      consumo: texto("consumo"),
      mensaje: texto("mensaje"),
    },
  };
}
