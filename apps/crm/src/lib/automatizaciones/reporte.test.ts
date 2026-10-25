import { describe, expect, it } from "vitest";

import { armarReporte, type Movimiento, type ReporteDeLaBase } from "./reporte";

const CRM = "https://crm.ejemplo";

function movimiento(campos: Partial<Movimiento> = {}): Movimiento {
  return {
    leads: 0,
    leads_por_canal: {},
    ganadas: 0,
    valor_ganado: 0,
    ampliaciones: 0,
    ganadas_sin_valor: 0,
    perdidas: 0,
    motivos: {},
    por_asesor: {},
    ...campos,
  };
}

function reporte(campos: Partial<ReporteDeLaBase> = {}): ReporteDeLaBase {
  return {
    lunes: "2026-10-12",
    llega_tarde: false,
    destinatario: { nombre: "Laura Méndez", email: "laura@solarandes.test" },
    semana: movimiento({
      leads: 5,
      leads_por_canal: { web: 3, referido: 2 },
      ganadas: 2,
      valor_ganado: 30_000_000,
      ampliaciones: 1,
      perdidas: 3,
      motivos: { precio: 2, no_respondio: 1 },
      por_asesor: { "Andrés Rojas": { leads: 3, ganadas: 1, valor_ganado: 20_000_000 } },
    }),
    anterior: movimiento({ leads: 3, leads_por_canal: { web: 1, anuncios: 2 }, ganadas: 1, valor_ganado: 10_000_000 }),
    foto: {
      abiertas: 114,
      pipeline: 1_200_000_000,
      pipeline_ponderado: 300_000_000,
      sin_seguimiento: 69,
      sin_seguimiento_por_asesor: { "Andrés Rojas": 27, "Camilo Torres": 15 },
    },
    foto_anterior: null,
    ...campos,
  };
}

describe("armarReporte", () => {
  it("la semana de lunes a domingo, con la anterior al lado y sin porcentajes", () => {
    const correo = armarReporte(reporte(), CRM);
    expect(correo).toMatchObject({ id: "2026-10-12", para: "laura@solarandes.test", quien: "Laura Méndez" });
    expect(correo.asunto).toBe("Reporte semanal SolarAndes: 12 de oct al 18 de oct");
    expect(correo.texto).toContain("del lunes 12 de octubre al domingo 18 de octubre");
    expect(correo.texto).toContain("LEADS NUEVOS: 5 (antes 3)");
    expect(correo.texto).toContain("- Anuncios: 0 (antes 2)");
    expect(correo.texto).toContain("- Ganadas: 2 por $30 M (antes 1 por $10 M). De ellas, 1 es ampliación.");
    expect(correo.texto).toContain("Motivos: le pareció caro 2, dejó de responder 1.");
    expect(correo.texto).not.toContain("%");
  });

  it("lo de hoy se compara con el reporte anterior, y sin él dice 'sin dato'", () => {
    expect(armarReporte(reporte(), CRM).texto).toContain("Con 7+ días sin actividad: 69 (antes: sin dato)");
    const conAnterior = armarReporte(
      reporte({ foto_anterior: { ...reporte().foto, sin_seguimiento: 72, abiertas: 110 } }),
      CRM,
    );
    expect(conAnterior.texto).toContain("Con 7+ días sin actividad: 69 (antes 72)");
    expect(conAnterior.texto).toContain("114 ventas abiertas por $1.200 M (antes 110 por $1.200 M)");
  });

  it("cada asesor aparece aunque no haya tenido movimiento en la semana", () => {
    const { texto } = armarReporte(reporte(), CRM);
    expect(texto).toContain("- Andrés Rojas: 3 leads, 1 ganada por $20 M; hoy 27 con 7+ días sin actividad");
    expect(texto).toContain("- Camilo Torres: 0 leads, 0 ganadas; hoy 15 con 7+ días sin actividad");
  });

  it("si sale después del lunes, lo dice", () => {
    const correo = armarReporte(reporte({ llega_tarde: true }), CRM);
    expect(correo.asunto).toContain("(llega tarde)");
    expect(correo.texto).toContain("Llega tarde");
  });

  it("una semana en ceros sale igual", () => {
    const vacia = reporte({ semana: movimiento(), anterior: movimiento() });
    expect(armarReporte(vacia, CRM).texto).toContain("LEADS NUEVOS: 0 (antes 0)");
  });
});
