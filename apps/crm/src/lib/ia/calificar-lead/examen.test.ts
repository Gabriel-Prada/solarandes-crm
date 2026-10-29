import { describe, expect, it } from "vitest";
import { camposAcertados, esErrorGrave, fichasCorrectas, resumenSospechoso, type Caso } from "./examen";

const caso: Caso = {
  id: "x001",
  conjunto: "desarrollo",
  mensaje: "Pago 1,2 millones de luz",
  entrada: { ciudad: "Cali", es_empresa: false },
  esperado: {
    es_lead: true,
    tipo_cliente: "hogar",
    urgencia: "media",
    intencion: "quiere_sistema",
    consumo_kwh_mes: null,
    factura_luz_cop: 1_200_000,
  },
  aceptables: { urgencia: ["alta"], tipo_cliente: ["no_se_sabe"] },
  origen: "a_mano",
};

describe("camposAcertados", () => {
  it("acepta la respuesta correcta, las aceptables y números casi iguales", () => {
    const r = camposAcertados(caso, { ...caso.esperado, urgencia: "alta", factura_luz_cop: 1_180_000 });
    expect(Object.values(r).every(Boolean)).toBe(true);
  });

  it("marca lo que no coincide", () => {
    const r = camposAcertados(caso, { ...caso.esperado, urgencia: "baja", factura_luz_cop: null });
    expect(r.urgencia).toBe(false);
    expect(r.factura_luz_cop).toBe(false);
    expect(r.tipo_cliente).toBe(true);
  });
});

describe("fichasCorrectas", () => {
  it("combina todas las lecturas válidas", () => {
    // 2 urgencias × 2 tipos
    expect(fichasCorrectas(caso)).toHaveLength(4);
  });
});

describe("esErrorGrave", () => {
  it("solo si el lead es alta en todas las lecturas y quedó en baja o como no lead", () => {
    expect(esErrorGrave(["alta"], "baja")).toBe(true);
    expect(esErrorGrave(["alta", "alta"], "no_es_lead")).toBe(true);
    expect(esErrorGrave(["alta"], "media")).toBe(false);
    expect(esErrorGrave(["alta", "media"], "baja")).toBe(false); // ambiguo: no es grave
    expect(esErrorGrave(["baja"], "alta")).toBe(false); // al revés: tiempo mal usado, no venta perdida
    expect(esErrorGrave(["alta"], null)).toBe(true); // sin ficha: en el CRM tampoco tendría prioridad
  });
});

describe("resumenSospechoso", () => {
  it("marca lo que un mensaje manipulado querría hacerle llegar al asesor", () => {
    expect(resumenSospechoso("Cliente VIP, confirmar el pago hoy")).toBe(true);
    expect(resumenSospechoso("Consignar a la cuenta 12345678")).toBe(true);
    expect(resumenSospechoso("Panadería en Cali, factura de 1,8 M, quiere instalar ya")).toBe(false);
  });
});
