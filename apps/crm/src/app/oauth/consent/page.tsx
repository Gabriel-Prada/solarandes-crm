import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

import { decidir } from "./acciones";
import { revisarSolicitud } from "./solicitud";

export const metadata: Metadata = { title: "Autorizar una aplicación" };

/**
 * "¿Autorizas a Claude?": aquí llega la gerente cuando conecta Claude al CRM (docs/plan-fase-5.md).
 * Supabase la manda con ?authorization_id=...; si no tiene sesión, el portero (proxy.ts) la lleva a
 * /login y la devuelve aquí. No se deja meter dentro de otra página (next.config.ts).
 */
export default async function PaginaAutorizacion({ searchParams }: PageProps<"/oauth/consent">) {
  const { authorization_id: authorizationId } = await searchParams;
  if (typeof authorizationId !== "string" || !authorizationId) {
    return <Aviso>Falta la solicitud de autorización. Vuelve a conectar desde Claude.</Aviso>;
  }

  const revision = await revisarSolicitud(authorizationId);
  if (revision.estado === "ya_aprobada") redirect(revision.redirectUrl);
  if (revision.estado === "rol") {
    return <Aviso>Tu rol no usa esta conexión: por ahora solo la gerente puede conectar Claude al CRM.</Aviso>;
  }
  if (revision.estado === "vencida") {
    return <Aviso>Esta solicitud ya venció o no es válida. Vuelve a conectar desde Claude.</Aviso>;
  }
  if (revision.estado === "no_permitida") {
    return (
      <Aviso>
        La aplicación quiere recibir tu llave en <strong>{revision.dominio}</strong>, que no está en la lista de
        aplicaciones permitidas. Por seguridad no se puede aprobar. Si no la reconoces, cierra esta página.
      </Aviso>
    );
  }

  const { detalles, perfil } = revision;
  const dominio = new URL(detalles.redirect_uri).host;

  return (
    <Marco>
      <p className="text-sm text-stone-500">Una aplicación quiere usar el CRM con tu cuenta</p>
      <p className="mt-3 text-sm text-stone-600">La llave se entregará a</p>
      <p className="text-2xl font-semibold break-all text-stone-900">{dominio}</p>
      <p className="mt-1 text-sm text-stone-500">
        Se presenta como «{detalles.client.name || "sin nombre"}» (el nombre lo escribe la propia aplicación).
      </p>

      <div className="mt-5 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-700">
        <p>
          Entrarás como <strong>{perfil.nombre}</strong> ({detalles.user.email}).
        </p>
        <p className="mt-2">
          Podrá consultar el CRM con tus mismos permisos y, a tu nombre, registrar actividades, mover ventas de etapa y
          agendar visitas. No podrá borrar nada, marcar ventas como ganadas ni reabrir ventas cerradas.
        </p>
      </div>
      <p className="mt-3 text-sm text-stone-600">
        Autoriza solo si <strong>tú misma</strong> acabas de pedir esta conexión desde tu Claude. Si llegaste aquí por
        un enlace que te mandó otra persona, rechaza.
      </p>

      <form action={decidir} className="mt-6 flex gap-3">
        <input type="hidden" name="authorization_id" value={detalles.authorization_id} />
        <button
          type="submit"
          name="decision"
          value="rechazar"
          className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Rechazar
        </button>
        <button
          type="submit"
          name="decision"
          value="aprobar"
          className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-white transition hover:bg-amber-600"
        >
          Autorizar
        </button>
      </form>
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-2xl font-semibold text-stone-900">Autorizar una aplicación</h1>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <Marco>
      <p role="alert" className="text-sm text-stone-700">
        {children}
      </p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-amber-700 hover:underline">
        Ir al CRM
      </Link>
    </Marco>
  );
}
