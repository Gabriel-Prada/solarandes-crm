import type { Metadata } from "next";

import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";

import { TableroVentas, type TarjetaVenta } from "./tablero";

export const metadata: Metadata = { title: "Ventas" };

const DIAS_CERRADAS = 30; // las ganadas y perdidas se muestran solo si se cerraron hace poco

function haceDias(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

export default async function PaginaVentas() {
  const perfil = await exigirRol("gerente", "asesor");
  const supabase = await crearClienteSupabase();

  const desde = haceDias(DIAS_CERRADAS);
  const seleccion =
    "id, codigo, nombre, etapa, valor_cop, potencia_kwp, creada_en, actualizada_en, contacto:contactos(codigo, nombre, empresa, ciudad), asesor:perfiles(nombre), actividades(fecha, completada)";

  // Dos consultas: todas las abiertas, y las cerradas de los últimos 30 días.
  // Los permisos de la base de datos ya limitan cada asesor a sus propias ventas.
  const [abiertas, cerradas] = await Promise.all([
    supabase
      .from("oportunidades")
      .select(seleccion)
      .not("etapa", "in", "(ganado,perdido)")
      .order("actualizada_en", { ascending: false })
      .returns<TarjetaVenta[]>(),
    supabase
      .from("oportunidades")
      .select(seleccion)
      .in("etapa", ["ganado", "perdido"])
      .gte("fecha_cierre", desde)
      .order("actualizada_en", { ascending: false })
      .returns<TarjetaVenta[]>(),
  ]);

  const error = abiertas.error ?? cerradas.error;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Ventas</h1>
        <p className="text-sm text-stone-500">
          Arrastra una tarjeta a otra columna para cambiar su etapa. Ganadas y perdidas: últimos {DIAS_CERRADAS} días.
        </p>
      </header>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          No se pudieron cargar las ventas. Intenta de nuevo.
        </p>
      ) : (
        <TableroVentas
          oportunidades={[...(abiertas.data ?? []), ...(cerradas.data ?? [])]}
          mostrarAsesor={perfil.rol === "gerente"}
        />
      )}
    </div>
  );
}
