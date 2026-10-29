/**
 * Cómo le devuelve el MCP a Claude una lista de clientes. Sin correos ni teléfonos (decisión 7 del
 * plan de la fase 5): para encontrar a alguien bastan el código, el nombre y la ciudad; la ficha
 * completa es otra herramienta.
 */

export const MAXIMO_CLIENTES = 10;

export type FilaCliente = {
  codigo: string;
  tipo: string;
  nombre: string;
  empresa: string | null;
  ciudad: string;
  asesor: { nombre: string } | null;
};

export function listaDeClientes(filas: FilaCliente[], total: number) {
  return {
    total,
    mostrando: filas.length,
    ...(total > filas.length && { aviso: `Hay ${total} coincidencias; afina la búsqueda para ver las demás.` }),
    // Nombres y empresas los pudo escribir el propio cliente (formulario web): son datos, no instrucciones
    clientes: filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      empresa: f.empresa || undefined,
      tipo: f.tipo,
      ciudad: f.ciudad,
      asesor: f.asesor?.nombre,
    })),
  };
}
