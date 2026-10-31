import type Anthropic from "@anthropic-ai/sdk";

import type { BaseAsistente, Resultado } from "./base";
import { buscarConocimiento } from "./buscar";
import type { EjecutarHerramienta, ResultadoHerramienta } from "./conversar";
import { resumirConversacion } from "./resumen";

/**
 * Lo que hace cada herramienta cuando Claude la pide. Claude solo propone: el precio, los horarios, la
 * visita y el aviso al asesor los decide la base (con las reglas de la 025 y la 026), siempre sobre la
 * conversación de este turno. Lo que devuelve cada una es lo que Claude lee para responder.
 */

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const entero = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
const json = (r: Resultado | Record<string, unknown>, esError = false): ResultadoHerramienta => ({
  contenido: JSON.stringify(r),
  esError,
});

export function crearEjecutor(deps: {
  base: BaseAsistente;
  claude: Pick<Anthropic, "messages">;
}): EjecutarHerramienta {
  return async (nombre, entrada, turno) => {
    switch (nombre) {
      case "buscar_informacion": {
        const encontrados = buscarConocimiento(texto(entrada.consulta));
        return json(
          encontrados.length
            ? { estado: "ok", fragmentos: encontrados.map(({ id, titulo, texto: t }) => ({ id, titulo, texto: t })) }
            : { estado: "sin_resultados", mensaje: "No hay información sobre eso: dilo y ofrece un asesor." },
        );
      }
      case "calcular_precio": {
        const consumo = entero(entrada.consumo_kwh_mes);
        const pago = consumo === null ? entero(entrada.pago_mensual_cop) : null;
        return json(await deps.base.calcularPrecio(consumo, pago, texto(entrada.ciudad).slice(0, 60)));
      }
      case "pedir_datos_de_contacto": {
        const motivo = ["contacto", "visita", "asesor"].includes(texto(entrada.motivo)) ? texto(entrada.motivo) : "contacto";
        return {
          contenido: JSON.stringify({
            estado: "formulario_mostrado",
            mensaje: "La persona ya ve el formulario debajo de este mensaje. Invítala a llenarlo; no pidas los datos en el chat.",
          }),
          evento: { tipo: "formulario", motivo },
        };
      }
      case "horarios_disponibles": {
        const desde = /^\d{4}-\d{2}-\d{2}$/.test(texto(entrada.desde)) ? texto(entrada.desde) : null;
        return json(await deps.base.horarios(turno.turnoId, turno.pedido, desde));
      }
      case "agendar_visita": {
        const fecha = texto(entrada.fecha);
        const hora = texto(entrada.hora);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) {
          return json({ estado: "rechazada", mensaje: "Usa fecha AAAA-MM-DD y hora HH:MM." }, true);
        }
        return json(await deps.base.agendarVisita(turno.turnoId, turno.pedido, fecha, hora));
      }
      case "pasar_a_asesor": {
        // Antes de pagar el resumen: si la base lo va a rechazar, no se llama a Claude (la base igual decide)
        if (!turno.contexto.datosDejados) {
          return json({ estado: "rechazada", mensaje: "La persona todavía no ha dejado sus datos: ofrece primero el formulario (pedir_datos_de_contacto)." });
        }
        if (turno.contexto.asesorAvisado) return json({ estado: "ya_estaba", mensaje: "Ya se avisó a un asesor." });
        const resumen = await resumirConversacion(deps, turno, turno.textosDelVisitante, texto(entrada.motivo));
        return json(await deps.base.pasarAAsesor(turno.turnoId, turno.pedido, resumen.texto, resumen.necesita));
      }
      default:
        return json({ estado: "rechazada", mensaje: "Esa herramienta no existe." }, true);
    }
  };
}
