"use server";

import { redirect } from "next/navigation";

import { cotizar } from "@/lib/cotizacion";
import { exigirRol } from "@/lib/sesion";
import { crearClienteSupabase } from "@/lib/supabase/servidor";
import { normalizarTelefono } from "@/lib/telefono";
import { CIUDADES, NOMBRE_CANAL, type CanalOrigen, type Ciudad } from "@/lib/tipos";

export type EstadoNuevoContacto = {
  error: string | null;
  intentos: number;
  valores: Record<string, string> | null; // lo escrito, para no perderlo si hay un error
};

export async function crearContacto(previo: EstadoNuevoContacto, formulario: FormData): Promise<EstadoNuevoContacto> {
  const perfil = await exigirRol("gerente", "asesor");

  const valores = Object.fromEntries(
    ["tipo", "nombre", "empresa", "telefono", "email", "ciudad", "direccion", "estrato", "consumo", "canal", "asesor_id"].map(
      (campo) => [campo, String(formulario.get(campo) ?? "").trim()],
    ),
  );
  const conError = (error: string): EstadoNuevoContacto => ({ error, intentos: previo.intentos + 1, valores });

  // Validaciones: mensajes claros aquí, y la base de datos vuelve a validar por su cuenta
  const tipo = valores.tipo;
  if (tipo !== "hogar" && tipo !== "negocio") return conError("Elige si es un hogar o un negocio.");
  if (valores.nombre.length < 3) return conError("Escribe el nombre de la persona de contacto.");
  if (tipo === "negocio" && valores.empresa.length < 2) return conError("Escribe el nombre del negocio.");

  const telefono = normalizarTelefono(valores.telefono);
  if (!telefono) return conError("El celular debe tener 10 dígitos y empezar por 3, por ejemplo 300 123 4567.");

  if (valores.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valores.email)) return conError("El correo no es válido.");

  const ciudad = CIUDADES.find((c) => c === valores.ciudad) as Ciudad | undefined;
  if (!ciudad) return conError("Elige la ciudad.");

  const estrato = tipo === "hogar" && valores.estrato ? Number(valores.estrato) : null;
  if (estrato !== null && !(Number.isInteger(estrato) && estrato >= 1 && estrato <= 6)) {
    return conError("El estrato debe estar entre 1 y 6.");
  }

  const consumo = Number(valores.consumo);
  if (!Number.isInteger(consumo) || consumo <= 0 || consumo > 100_000) {
    return conError("Escribe el consumo mensual en kWh (aparece en la factura de luz).");
  }

  if (!(valores.canal in NOMBRE_CANAL)) return conError("Elige por dónde llegó el contacto.");
  const canal = valores.canal as CanalOrigen;

  const supabase = await crearClienteSupabase();

  // Asesor responsable: el asesor crea a su nombre; la gerente elige, o por defecto el de la ciudad
  let asesorId = perfil.id;
  if (perfil.rol === "gerente") {
    if (valores.asesor_id) {
      // El formulario solo ofrece asesores, pero el valor llega del navegador: se comprueba
      const { data: elegido } = await supabase
        .from("perfiles")
        .select("id")
        .eq("id", valores.asesor_id)
        .eq("rol", "asesor")
        .eq("activo", true)
        .maybeSingle();
      if (!elegido) return conError("El asesor elegido no es válido.");
      asesorId = elegido.id;
    } else {
      const { data: asesor } = await supabase
        .from("perfiles")
        .select("id")
        .eq("rol", "asesor")
        .eq("ciudad", ciudad)
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (!asesor) return conError(`No hay un asesor activo en ${ciudad}. Elige uno.`);
      asesorId = asesor.id;
    }
  }

  // Valor estimado de la primera venta con la fórmula de cotización
  const estimado = cotizar(consumo, ciudad);
  const nombreVisible = tipo === "negocio" ? valores.empresa : valores.nombre;

  // Contacto y primera venta se guardan juntos: o los dos, o ninguno (migración 006)
  const { data: codigo, error } = await supabase.rpc("crear_contacto_con_venta", {
    contacto: {
      tipo,
      nombre: valores.nombre,
      empresa: tipo === "negocio" ? valores.empresa : "",
      telefono,
      email: valores.email.toLowerCase(),
      ciudad,
      direccion: valores.direccion,
      estrato,
      consumo_kwh_mes: consumo,
      canal_origen: canal,
      asesor_id: asesorId,
    },
    venta: {
      nombre: `Sistema ${estimado.potenciaInstaladaKwp} kWp - ${nombreVisible}`,
      potencia_kwp: estimado.potenciaInstaladaKwp,
      valor_cop: estimado.valorTotal,
    },
  });

  if (error) {
    // 23505 = la base de datos rechazó un valor repetido (teléfono único, migración 005)
    if (error.code === "23505") return conError("Ya existe un contacto con ese celular.");
    return conError("No se pudo crear el contacto. Revisa los datos e intenta de nuevo.");
  }

  redirect(`/contactos/${codigo}`);
}
