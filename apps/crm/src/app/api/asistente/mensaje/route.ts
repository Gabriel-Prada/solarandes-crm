import { randomUUID } from "node:crypto";

import { baseAsistente } from "@/lib/asistente/base";
import { responderTurno, type Evento } from "@/lib/asistente/conversar";
import { crearEjecutor } from "@/lib/asistente/herramientas";
import { claveDeLaCookie, fechaHoraBogota, huellaDeClave, vieneDeLaPagina } from "@/lib/asistente/sesion";
import { huellaDeIp, ipDeLaPeticion } from "@/lib/formulario/huella";
import { clienteAnthropic } from "@/lib/ia/cliente";

// Hasta 3 llamadas a Claude de máximo 20 segundos cada una, más la base: cabe en 90
export const maxDuration = 90;

/**
 * Un mensaje del visitante. Recibe SOLO el texto nuevo (el historial lo carga la base) y responde letra a
 * letra, una línea JSON por evento (texto, formulario, aviso, fin). Ver src/lib/asistente/conversar.ts.
 */
export async function POST(request: Request) {
  if (!vieneDeLaPagina(request.headers, request.url)) {
    return Response.json({ error: "Pedido no permitido." }, { status: 403 });
  }
  const clave = claveDeLaCookie(request.headers);
  if (!clave) return Response.json({ error: "No hay una conversación abierta." }, { status: 401 });
  const cuerpo = (await request.json().catch(() => null)) as { mensaje?: unknown } | null;
  const mensaje = typeof cuerpo?.mensaje === "string" ? cuerpo.mensaje.slice(0, 2000) : "";

  let huella: string;
  let claude;
  try {
    huella = huellaDeIp(ipDeLaPeticion(request.headers), process.env.HUELLA_SECRETA);
    claude = clienteAnthropic();
  } catch {
    console.error("asistente: falta configuración (HUELLA_SECRETA o ANTHROPIC_API_KEY)");
    return Response.json({ error: "El asistente no está disponible." }, { status: 503 });
  }

  const eventos = responderTurno(
    { claveHash: huellaDeClave(clave), huella, pedido: randomUUID(), mensaje },
    { base: baseAsistente, claude, ejecutar: crearEjecutor({ base: baseAsistente, claude }), fechaHora: () => fechaHoraBogota() },
  );
  const codificar = (e: Evento) => new TextEncoder().encode(JSON.stringify(e) + "\n");
  const cuerpoRespuesta = new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        const { value, done } = await eventos.next();
        if (done) controlador.close();
        else controlador.enqueue(codificar(value));
      } catch (e) {
        console.error("asistente: el turno falló", (e as { code?: string }).code ?? "sin_codigo");
        controlador.enqueue(codificar({ tipo: "aviso", texto: "Algo falló. Intenta de nuevo.", cerrada: false }));
        controlador.close();
      }
    },
    async cancel() {
      await eventos.return(undefined);
    },
  });
  return new Response(cuerpoRespuesta, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
