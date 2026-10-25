import { describe, expect, it } from "vitest";

import { armarCorreo, type ItemSeguimiento, type ResumenDeLaBase } from "./seguimiento";

const CRM = "https://crm.ejemplo";

function venta(campos: Partial<ItemSeguimiento> = {}): ItemSeguimiento {
  return {
    tipo: "venta",
    nivel: 3,
    codigo: "O0014",
    contacto: "C0014",
    cliente: "Ruth Barrera",
    etapa: "cotizado",
    dias: 5,
    asesor: "Andrés Rojas",
    asesor_activo: true,
    oportunidad_id: "v-1",
    actividad_id: null,
    ...campos,
  };
}

function resumen(campos: Partial<ResumenDeLaBase> = {}): ResumenDeLaBase {
  return {
    id: "r-1",
    destinatario: { nombre: "Andrés Rojas", email: "andres@solarandes.test", rol: "asesor" },
    es_gerente: false,
    items: [venta()],
    total_3: 12,
    total_7_por_asesor: null,
    ...campos,
  };
}

const LAURA = { nombre: "Laura Méndez", email: "laura@solarandes.test", rol: "gerente" };

describe("armarCorreo", () => {
  it("al asesor: sus ventas con 3+ días, con enlace a la ficha y el total que tiene", () => {
    const correo = armarCorreo(resumen(), CRM);
    expect(correo).toMatchObject({ id: "r-1", para: "andres@solarandes.test", quien: "Andrés Rojas" });
    expect(correo.asunto).toBe("Seguimiento: 1 venta con 3+ días sin actividad");
    expect(correo.texto).toContain("Hola, Andrés:");
    expect(correo.texto).toContain("- O0014 · Ruth Barrera (Cotizado) · 5 días sin actividad\n  https://crm.ejemplo/contactos/C0014");
    expect(correo.texto).toContain("En total tienes 12 ventas con 3+ días sin actividad");
  });

  it("las tareas vencidas sin venta van aparte", () => {
    const tarea = venta({
      tipo: "tarea",
      codigo: undefined,
      etapa: undefined,
      descripcion: "Contactar: el cliente volvió a escribir",
      oportunidad_id: null,
      actividad_id: "t-1",
      dias: 1,
    });
    const correo = armarCorreo(resumen({ items: [venta(), venta({ oportunidad_id: "v-2" }), tarea] }), CRM);
    expect(correo.asunto).toBe("Seguimiento: 2 ventas con 3+ días sin actividad y 1 tarea vencida");
    expect(correo.texto).toContain("Contactar: el cliente volvió a escribir · Ruth Barrera · vencida hace 1 día");
  });

  it("a la gerente: las de 7+ por asesor, y cada venta una sola vez", () => {
    const inactivo = { asesor: "Camilo Torres", asesor_activo: false };
    const correo = armarCorreo(
      resumen({
        destinatario: LAURA,
        es_gerente: true,
        total_3: 0,
        total_7_por_asesor: { "Andrés Rojas": 27, "Camilo Torres": 2 },
        items: [
          venta({ nivel: 7, dias: 9 }),
          // La venta de un asesor inactivo con 8 días llega como 3+ (a su cargo) y como 7+
          venta({ nivel: 7, dias: 8, oportunidad_id: "v-9", codigo: "O0099", ...inactivo }),
          venta({ nivel: 3, dias: 8, oportunidad_id: "v-9", codigo: "O0099", ...inactivo }),
          venta({ nivel: 3, dias: 4, oportunidad_id: "v-8", codigo: "O0088", ...inactivo }),
        ],
      }),
      CRM,
    );
    expect(correo.asunto).toBe(
      "Seguimiento: 2 ventas llegaron a 7+ días sin actividad y 1 venta con 3+ días sin actividad",
    );
    expect(correo.texto).toContain("Andrés Rojas (27 en total con 7+ días)\n- O0014");
    expect(correo.texto).toContain("Camilo Torres (ya no está activo: hay que reasignar sus ventas)");
    expect(correo.texto.match(/O0099/g)).toHaveLength(1);
    expect(correo.texto).toContain("A tu cargo, con 3 o más días sin actividad:");
    expect(correo.texto).toContain("O0088 · Ruth Barrera (Cotizado) · 4 días sin actividad · de Camilo Torres, que ya no está activo");
    expect(correo.texto).not.toContain("En total tienes");
  });

  it("nunca lleva el celular ni el correo del cliente", () => {
    const { texto } = armarCorreo(resumen(), CRM);
    expect(texto).not.toMatch(/\+57|@/);
  });
});
