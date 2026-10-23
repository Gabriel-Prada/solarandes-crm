import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Paginacion } from "@/components/paginacion";
import { normalizarBusqueda, patronContiene } from "@/lib/busqueda";
import { formatoFecha, formatoNumero, formatoTelefono } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { CIUDADES, NOMBRE_CANAL, type Contacto } from "@/lib/tipos";

export const metadata: Metadata = { title: "Contactos" };

const POR_PAGINA = 25;

export default async function PaginaContactos({ searchParams }: PageProps<"/contactos">) {
  const perfil = await exigirRol("gerente", "asesor");
  const esGerente = perfil.rol === "gerente";

  const parametros = await searchParams;
  const valor = (clave: string) => {
    const v = parametros[clave];
    return typeof v === "string" ? v : undefined;
  };
  const busqueda = (valor("q") ?? "").trim().slice(0, 60); // tal como la escribió la persona
  const termino = normalizarBusqueda(busqueda); // sin tildes ni mayúsculas, para comparar
  const tipo = valor("tipo") === "hogar" || valor("tipo") === "negocio" ? valor("tipo") : undefined;
  const ciudad = esGerente ? CIUDADES.find((c) => c === valor("ciudad")) : undefined;
  const pagina = Math.max(1, Math.floor(Number(valor("pagina"))) || 1);

  // La base de datos solo devuelve los contactos que esta persona puede ver (RLS):
  // aquí no hace falta filtrar por asesor.
  const supabase = await crearClienteSupabase();
  let consulta = supabase
    .from("contactos")
    .select(
      "id, codigo, tipo, nombre, empresa, telefono, email, ciudad, consumo_kwh_mes, canal_origen, creado_en, asesor:perfiles!contactos_asesor_id_fkey(nombre)",
      { count: "exact" },
    )
    .order("creado_en", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  if (termino) {
    // `busqueda` es una columna calculada por la base de datos (migración 002)
    consulta = consulta.ilike("busqueda", patronContiene(termino));
  }
  if (tipo) consulta = consulta.eq("tipo", tipo);
  if (ciudad) consulta = consulta.eq("ciudad", ciudad);

  const { data, count, error } = await consulta.returns<Contacto[]>();
  if (error && pagina > 1) {
    // Página que no existe (por ejemplo ?pagina=999): volver a la primera con los mismos filtros
    const query = new URLSearchParams(
      Object.entries({ q: busqueda, tipo, ciudad }).filter((par): par is [string, string] => Boolean(par[1])),
    );
    redirect(`/contactos${query.size ? `?${query}` : ""}`);
  }
  const contactos = data ?? [];
  const total = count ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Contactos</h1>
          <p className="text-sm text-stone-500">
            {formatoNumero(total)} {total === 1 ? "contacto" : "contactos"}
            {busqueda || tipo || ciudad
              ? total === 1
                ? " encontrado"
                : " encontrados"
              : esGerente
                ? " en total"
                : " asignados a ti"}
          </p>
        </div>
        <Link
          href="/contactos/nuevo"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          + Nuevo contacto
        </Link>
      </header>

      {/* Formulario GET: los filtros quedan en la dirección, así se pueden compartir o recargar */}
      <form className="flex flex-wrap gap-2 rounded-2xl border border-stone-200 bg-white p-3" role="search">
        <input
          type="search"
          name="q"
          defaultValue={busqueda}
          placeholder="Buscar por nombre, empresa, teléfono o código"
          aria-label="Buscar contactos"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
        <select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo de cliente" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
          <option value="">Hogares y negocios</option>
          <option value="hogar">Hogares</option>
          <option value="negocio">Negocios</option>
        </select>
        {esGerente && (
          <select name="ciudad" defaultValue={ciudad ?? ""} aria-label="Ciudad" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
            <option value="">Todas las ciudades</option>
            {CIUDADES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
          Filtrar
        </button>
        {(busqueda || tipo || ciudad) && (
          <Link href="/contactos" className="self-center px-2 text-sm text-stone-500 hover:text-stone-900">
            Limpiar
          </Link>
        )}
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          No se pudieron cargar los contactos. Intenta de nuevo.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Contacto</th>
              <th className="px-4 py-3 font-medium">Teléfono</th>
              <th className="px-4 py-3 font-medium">Ciudad</th>
              <th className="px-4 py-3 text-right font-medium">Consumo</th>
              <th className="px-4 py-3 font-medium">Canal</th>
              {esGerente && <th className="px-4 py-3 font-medium">Asesor</th>}
              <th className="px-4 py-3 font-medium">Creado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {contactos.map((c) => (
              <tr key={c.id} className="hover:bg-stone-50">
                <td className="px-4 py-3">
                  <Link href={`/contactos/${c.codigo}`} className="font-medium text-stone-900 hover:text-amber-700 hover:underline">
                    {c.empresa ?? c.nombre}
                  </Link>
                  <p className="text-stone-500">
                    {c.empresa ? `${c.nombre} · ` : ""}
                    <span className="font-mono text-xs">{c.codigo}</span>
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        c.tipo === "negocio" ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {c.tipo === "negocio" ? "Negocio" : "Hogar"}
                    </span>
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatoTelefono(c.telefono)}</td>
                <td className="px-4 py-3">{c.ciudad}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {c.consumo_kwh_mes != null ? `${formatoNumero(c.consumo_kwh_mes)} kWh` : "—"}
                </td>
                <td className="px-4 py-3">{NOMBRE_CANAL[c.canal_origen]}</td>
                {esGerente && <td className="px-4 py-3">{c.asesor?.nombre ?? "—"}</td>}
                <td className="px-4 py-3 whitespace-nowrap text-stone-500">{formatoFecha(c.creado_en)}</td>
              </tr>
            ))}
            {contactos.length === 0 && !error && (
              <tr>
                <td colSpan={esGerente ? 7 : 6} className="px-4 py-10 text-center text-stone-500">
                  No hay contactos que coincidan con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion
        ruta="/contactos"
        pagina={pagina}
        totalPaginas={Math.ceil(total / POR_PAGINA)}
        parametros={{ q: busqueda || undefined, tipo, ciudad }}
      />
    </div>
  );
}
