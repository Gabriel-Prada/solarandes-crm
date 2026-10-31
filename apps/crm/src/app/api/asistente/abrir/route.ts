import { baseAsistente } from "@/lib/asistente/base";
import { VERSION_AVISO } from "@/lib/asistente/prompt";
import { cookieDeConversacion, huellaDeClave, nuevaClave, vieneDeLaPagina } from "@/lib/asistente/sesion";
import { huellaDeIp, ipDeLaPeticion } from "@/lib/formulario/huella";

/**
 * Abre una conversación del asistente cuando la persona acepta el aviso de datos (Ley 1581): la base
 * guarda la versión del aviso y la hora. Los topes de conversaciones por persona y por día los decide la
 * base (asistente_abrir, migración 025). Devuelve la cookie de la conversación; nunca su valor en el JSON.
 */
export async function POST(request: Request) {
  if (!vieneDeLaPagina(request.headers, request.url)) {
    return Response.json({ error: "Pedido no permitido." }, { status: 403 });
  }
  const cuerpo = (await request.json().catch(() => null)) as { acepto?: unknown } | null;
  if (cuerpo?.acepto !== true) {
    return Response.json({ error: "Para conversar debes aceptar el aviso de datos." }, { status: 400 });
  }

  let huella: string;
  try {
    huella = huellaDeIp(ipDeLaPeticion(request.headers), process.env.HUELLA_SECRETA);
  } catch {
    console.error("asistente: falta HUELLA_SECRETA");
    return Response.json({ error: "El asistente no está disponible." }, { status: 503 });
  }

  const clave = nuevaClave();
  try {
    const r = await baseAsistente.abrir(huellaDeClave(clave), huella, VERSION_AVISO);
    if (r.estado === "limite") {
      const texto =
        r.motivo === "dia"
          ? "El asistente llegó a su máximo de conversaciones por hoy. Deja tus datos en /cotiza y un asesor te contacta."
          : "Abriste muchas conversaciones seguidas. Intenta más tarde o deja tus datos en /cotiza.";
      return Response.json({ error: texto }, { status: 429 });
    }
    if (r.estado !== "ok") return Response.json({ error: "No se pudo abrir la conversación." }, { status: 400 });
  } catch (e) {
    console.error("asistente: asistente_abrir falló", (e as { code?: string }).code ?? "sin_codigo");
    return Response.json({ error: "El asistente no está disponible en este momento." }, { status: 503 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookieDeConversacion(clave, process.env.NODE_ENV === "production") } },
  );
}
