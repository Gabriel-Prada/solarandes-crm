import { describe, expect, it } from "vitest";

import type { Panel } from "@/lib/panel";
import type { FilaPrioridad } from "@/lib/prioridad";

import {
  agendaTecnica,
  elegirAsesor,
  ficha,
  listaDeVentas,
  normalizarCiudad,
  normalizarCodigo,
  panelParaClaude,
  recortar,
  resumenSeguimiento,
  type DatosFicha,
  type FilaAgenda,
  type FilaSeguimiento,
  type FilaVenta,
  type Miembro,
} from "./consultas";

const EQUIPO: Miembro[] = [
  { id: "u1", nombre: "Laura Méndez", rol: "gerente" },
  { id: "u2", nombre: "Andrés Rojas", rol: "asesor" },
  { id: "u3", nombre: "Valentina Ospina", rol: "asesor" },
  { id: "u4", nombre: "Camilo Torres", rol: "asesor" },
  { id: "u5", nombre: "Jhon Fredy Muñoz", rol: "tecnico" },
  { id: "u6", nombre: "Marcela Díaz", rol: "contadora" },
];

describe("elegirAsesor", () => {
  it("encuentra al asesor sin importar tildes ni mayúsculas", () => {
    expect(elegirAsesor("andres", EQUIPO)).toMatchObject({ ok: true, miembro: { id: "u2" } });
    expect(elegirAsesor("VALENTINA ospina", EQUIPO)).toMatchObject({ ok: true, miembro: { id: "u3" } });
    expect(elegirAsesor("Laura", EQUIPO)).toMatchObject({ ok: true, miembro: { id: "u1" } });
  });

  it("no busca fuera del equipo comercial", () => {
    expect(elegirAsesor("Marcela", EQUIPO).ok).toBe(false);
    expect(elegirAsesor("Jhon", EQUIPO).ok).toBe(false);
  });

  it("si coincide con dos, pregunta en vez de adivinar", () => {
    const conDosCamilos = [...EQUIPO, { id: "u7", nombre: "Camilo Pérez", rol: "asesor" as const }];
    const eleccion = elegirAsesor("camilo", conDosCamilos);
    expect(eleccion).toEqual({ ok: false, error: "«camilo» coincide con: Camilo Torres, Camilo Pérez. ¿Cuál?" });
  });
});

describe("normalizarCodigo", () => {
  it("entiende el código aunque esté en minúsculas o sin ceros", () => {
    expect(normalizarCodigo("c153")).toBe("C0153");
    expect(normalizarCodigo(" C0153 ")).toBe("C0153");
    expect(normalizarCodigo("C12345")).toBe("C12345");
  });

  it("rechaza lo que no es un código de cliente", () => {
    expect(normalizarCodigo("O0153")).toBeNull();
    expect(normalizarCodigo("C01;53")).toBeNull();
    expect(normalizarCodigo("panadería")).toBeNull();
  });
});

describe("normalizarCiudad", () => {
  it("convierte a los nombres exactos de la base", () => {
    expect(normalizarCiudad("bogota")).toBe("Bogotá");
    expect(normalizarCiudad(" MEDELLÍN ")).toBe("Medellín");
    expect(normalizarCiudad("Barranquilla")).toBeNull();
  });
});

const venta = (id: string, cambios: Partial<FilaVenta> = {}): FilaVenta => ({
  id,
  codigo: `O${id}`,
  nombre: `Sistema ${id}`,
  etapa: "nuevo",
  valor_cop: 10_000_000,
  probabilidad: 10,
  asesor: { nombre: "Andrés Rojas" },
  contacto: { codigo: `C${id}`, nombre: "Cliente", empresa: null, ciudad: "Bogotá" },
  ...cambios,
});

const calificacion = (oportunidad: string | null, prioridad: FilaPrioridad["prioridad"], creada_en: string): FilaPrioridad => ({
  id: `${oportunidad}-${creada_en}`,
  oportunidad_id: oportunidad,
  estado: "calificada",
  prioridad,
  prioridad_asesor: null,
  creada_en,
});

describe("listaDeVentas", () => {
  it("usa la calificación más reciente de cada venta, como el tablero", () => {
    const prioridades = [calificacion("1", "alta", "2026-10-01"), calificacion("1", "baja", "2026-10-20")];
    const lista = listaDeVentas([venta("1")], prioridades, "alta");
    expect(lista.total).toBe(0); // la vieja decía alta; la última dice baja
    expect(listaDeVentas([venta("1")], prioridades, "baja").total).toBe(1);
  });

  it("si la IA todavía está calificando, dice calificando (como el tablero)", () => {
    const enCurso = { ...calificacion("1", null, "2026-10-20"), estado: "en_curso" as const };
    expect(listaDeVentas([venta("1")], [enCurso]).ventas[0].prioridad).toBe("calificando");
    expect(listaDeVentas([venta("1")], [], "calificando").total).toBe(0);
  });

  it("las ventas sin calificar no aparecen al pedir media", () => {
    const lista = listaDeVentas([venta("1"), venta("2")], [calificacion("2", "media", "2026-10-20")], "media");
    expect(lista.ventas.map((v) => v.venta)).toEqual(["O2"]);
    expect(listaDeVentas([venta("1")], [], "sin_calificar").total).toBe(1);
  });

  it("cuenta el total después del filtro y muestra máximo 25", () => {
    const filas = Array.from({ length: 30 }, (_, i) => venta(String(i)));
    const lista = listaDeVentas(filas, []);
    expect(lista).toMatchObject({ total: 30, mostrando: 25 });
    expect(lista.aviso).toContain("30 ventas");
  });

  it("no trae datos de contacto", () => {
    const conDatosDeMas = venta("1", {
      contacto: { codigo: "C1", nombre: "X", empresa: null, ciudad: "Cali", telefono: "+573001234567" } as FilaVenta["contacto"],
    });
    expect(JSON.stringify(listaDeVentas([conDatosDeMas], []))).not.toContain("573001234567");
  });
});

describe("resumenSeguimiento", () => {
  const fila = (codigo: string, asesor: string | null, dias: number): FilaSeguimiento => ({
    codigo,
    contacto_id: `c-${codigo}`,
    asesor_id: asesor,
    etapa: "contactado",
    dias,
  });
  const filas = [fila("O1", "u2", 3), fila("O2", "u2", 6), fila("O3", "u2", 9), fila("O4", "u3", 12), fila("O5", "u3", 1), fila("O6", "u1", 8)];

  it("cuenta por días: de 3 en adelante y de 7 en adelante", () => {
    const resumen = resumenSeguimiento(filas, EQUIPO, new Map(), "2026-10-29");
    expect(resumen.total_sin_seguimiento_3_dias).toBe(5);
    expect(resumen.total_aviso_gerente_7_dias).toBe(3);
  });

  it("por asesor solo cuenta a los asesores, ordenados del que más tiene al que menos", () => {
    const resumen = resumenSeguimiento(filas, EQUIPO, new Map(), "2026-10-29");
    expect(resumen.por_asesor).toEqual([
      { asesor: "Andrés Rojas", sin_seguimiento_3_dias: 3, aviso_gerente_7_dias: 1 },
      { asesor: "Valentina Ospina", sin_seguimiento_3_dias: 1, aviso_gerente_7_dias: 1 },
      { asesor: "Camilo Torres", sin_seguimiento_3_dias: 0, aviso_gerente_7_dias: 0 },
    ]);
  });

  it("con filtro de asesor, el conteo trae solo a esa persona (los demás no salen en cero)", () => {
    const deAndres = filas.filter((f) => f.asesor_id === "u2");
    const resumen = resumenSeguimiento(deAndres, EQUIPO, new Map(), "2026-10-29", EQUIPO[1]);
    expect(resumen.por_asesor).toEqual([{ asesor: "Andrés Rojas", sin_seguimiento_3_dias: 3, aviso_gerente_7_dias: 1 }]);
    expect(resumen.solo_de).toBe("Andrés Rojas");
  });

  it("cuenta también a un asesor inactivo, como el panel", () => {
    const conRetirado = [...EQUIPO, { id: "u9", nombre: "Pedro Retirado", rol: "asesor" as const, activo: false }];
    const resumen = resumenSeguimiento([...filas, fila("O9", "u9", 10)], conRetirado, new Map(), "2026-10-29");
    expect(resumen.por_asesor.find((a) => a.asesor === "Pedro Retirado")).toEqual({
      asesor: "Pedro Retirado",
      sin_seguimiento_3_dias: 1,
      aviso_gerente_7_dias: 1,
    });
    // pero no se le puede elegir por nombre
    expect(elegirAsesor("Pedro", conRetirado).ok).toBe(false);
  });

  it("no trae teléfonos ni correos", () => {
    const clientes = new Map([["c-O4", { codigo: "C4", nombre: "X", empresa: null, ciudad: "Cali", telefono: "+573001234567" }]]);
    const texto = JSON.stringify(resumenSeguimiento(filas, EQUIPO, clientes, "2026-10-29"));
    expect(texto).not.toContain("573001234567");
  });

  it("lista primero las más olvidadas y dice qué cuenta el panel", () => {
    const resumen = resumenSeguimiento(filas, EQUIPO, new Map(), "2026-10-29");
    expect(resumen.ventas_mas_olvidadas.map((v) => v.venta)).toEqual(["O4", "O3", "O6", "O2", "O1"]);
    expect(resumen.regla).toContain("7+ días");
    expect(resumen.hoy).toBe("2026-10-29");
  });
});

const datosFicha = (): DatosFicha => ({
  contacto: {
    id: "c1",
    codigo: "C0153",
    tipo: "negocio",
    nombre: "Paola Torres",
    empresa: "Panadería Gómez",
    telefono: "+573204989513",
    email: "paola@example.net",
    ciudad: "Cali",
    direccion: "Cl. 110 # 26-5",
    estrato: null,
    consumo_kwh_mes: 1200,
    canal_origen: "web",
    asesor: { nombre: "Camilo Torres" },
  },
  ventas: [
    { id: "v1", codigo: "O0001", nombre: "Sistema", etapa: "cotizado", valor_cop: 40_000_000, potencia_kwp: 10, probabilidad: 50, motivo_perdida: null },
  ],
  cotizaciones: [
    { numero: "COT-2026-0001", oportunidad_id: "v1", version: 1, fecha: "2026-10-01T15:00:00Z", potencia_kwp: 9, num_paneles: 17, descuento_pct: 0, valor_total: 38_000_000, estado: "reemplazada" },
    { numero: "COT-2026-0002", oportunidad_id: "v1", version: 2, fecha: "2026-10-10T15:00:00Z", potencia_kwp: 10, num_paneles: 19, descuento_pct: 5, valor_total: 40_000_000, estado: "enviada" },
  ],
  prioridades: [
    { ...calificacion("v1", "alta", "2026-10-02"), resumen: "Panadería que quiere instalar ya" },
    { ...calificacion(null, "media", "2026-10-25"), resumen: "Pregunta por mantenimiento" },
  ],
  actividades: [
    ...Array.from({ length: 12 }, (_, i) => ({
      tipo: "nota",
      descripcion: `Nota ${i}`,
      fecha: `2026-09-${String(i + 10).padStart(2, "0")}T15:00:00Z`,
      completada: true,
      oportunidad: null,
      usuario: null,
    })),
    { tipo: "tarea", descripcion: "x".repeat(500), fecha: "2026-11-02T15:00:00Z", completada: false, oportunidad: { codigo: "O0001" }, usuario: { nombre: "Camilo Torres" } },
  ],
});

describe("ficha", () => {
  it("la de la herramienta no trae teléfono, correo ni dirección", () => {
    const texto = JSON.stringify(ficha(datosFicha(), { conContacto: false }));
    expect(texto).not.toMatch(/573204989513|example\.net|26-5/);
  });

  it("tapa los teléfonos y correos que el cliente escribió dentro de un registro", () => {
    const datos = datosFicha();
    datos.actividades[0] = { ...datos.actividades[0], descripcion: "Lead web: llámenme al 3001234567 o a ana@correo.com", fecha: "2026-10-28T15:00:00Z" };
    const sinContacto = JSON.stringify(ficha(datos, { conContacto: false }));
    expect(sinContacto).not.toMatch(/3001234567|ana@correo\.com/);
    // el resource, que la gerente adjunta a mano, sí trae el texto tal cual
    expect(JSON.stringify(ficha(datos, { conContacto: true }))).toContain("3001234567");
  });

  it("una venta sin calificación dice sin_calificar, igual que ver_ventas", () => {
    const datos = { ...datosFicha(), prioridades: [] };
    expect(ficha(datos, { conContacto: false }).ventas[0].prioridad).toBe("sin_calificar");
  });

  it("la del resource sí los trae (la adjunta la gerente a mano)", () => {
    const resultado = ficha(datosFicha(), { conContacto: true });
    expect(resultado.cliente).toMatchObject({ telefono: "+573204989513", email: "paola@example.net", direccion: "Cl. 110 # 26-5" });
  });

  it("la cotización vigente es la última versión no reemplazada", () => {
    const [v] = ficha(datosFicha(), { conContacto: false }).ventas;
    expect(v.cotizacion_vigente).toMatchObject({ numero: "COT-2026-0002", version: 2, valor_total_cop: 40_000_000 });
    expect(v.prioridad).toBe("alta");
  });

  it("primero lo pendiente, después lo último hecho, máximo 10 y recortado", () => {
    const resultado = ficha(datosFicha(), { conContacto: false });
    expect(resultado.actividades).toHaveLength(10);
    expect(resultado.actividades_total).toBe(13);
    expect(resultado.actividades[0]).toMatchObject({ tipo: "tarea", hecha: false, venta: "O0001" });
    expect(resultado.actividades[0].registro.length).toBe(300);
    expect(resultado.actividades[1].registro).toBe("Nota 11");
  });

  it("muestra los mensajes de un cliente que volvió a escribir sin venta nueva", () => {
    expect(ficha(datosFicha(), { conContacto: false }).mensajes_sin_venta).toEqual([
      { fecha: "2026-10-24 19:00", prioridad: "media", resumen_ia: "Pregunta por mantenimiento" },
    ]);
  });
});

describe("agendaTecnica", () => {
  const fila = (tipo: string, rol: Miembro["rol"]): FilaAgenda => ({
    tipo,
    descripcion: "Revisar techo",
    fecha: "2026-10-30T14:00:00Z",
    completada: false,
    usuario: { nombre: "Jhon Fredy Muñoz", rol },
    contacto: { codigo: "C1", nombre: "Cliente", empresa: null, ciudad: "Cali" },
    oportunidad: { codigo: "O1" },
  });

  it("trae visitas y las tareas de los técnicos (instalaciones), no las tareas de los asesores", () => {
    const agenda = agendaTecnica([fila("visita", "tecnico"), fila("tarea", "tecnico"), fila("tarea", "asesor")], { desde: "2026-10-29", hasta: "2026-11-05" }, "2026-10-29");
    expect(agenda.total).toBe(2);
    expect(agenda.agenda.map((a) => a.tipo)).toEqual(["visita técnica", "instalación"]);
    expect(agenda.agenda[0].fecha).toBe("2026-10-30 09:00");
  });

  it("no trae teléfonos ni correos, ni siquiera escritos en la descripción", () => {
    const conTelefono = { ...fila("visita", "tecnico"), descripcion: "Revisar techo. Cel del cliente 3109876543" };
    const texto = JSON.stringify(agendaTecnica([conTelefono], { desde: "2026-10-29", hasta: "2026-11-05" }, "2026-10-29"));
    expect(texto).not.toContain("3109876543");
  });
});

describe("panelParaClaude", () => {
  it("usa los mismos porcentajes del panel del CRM", () => {
    const panel = {
      kpis: { ganadas_30: 10, valor_30: 143_130_000, valor_30_previo: 312_413_000, ganadas_90: 34, cerradas_90: 216, abiertas: 114, pipeline: 1, pipeline_ponderado: 1, sin_seguimiento: 104 },
      por_mes: [],
      embudo: [{ etapa: "nuevo", ventas: 1011 }, { etapa: "contactado", ventas: 828 }],
      perdidas_por_etapa: [],
      motivos: [],
      canales: [{ canal: "web", leads: 181, ganadas: 26, cerradas: 159, valor: 1 }],
      asesores: [],
    } as Panel;
    const resultado = panelParaClaude(panel, "2026-10-29");
    expect(resultado.indicadores).toMatchObject({
      tasa_de_cierre_90_dias_pct: 16,
      variacion_vs_30_dias_anteriores_pct: -54,
      sin_seguimiento_7_dias: 104,
      sin_seguimiento_pct_de_las_abiertas: 91,
    });
    expect(resultado.embudo[1]).toEqual({ etapa: "Contactado", ventas: 828, pct_de_las_que_entraron: 82 });
    expect(resultado.canales[0].tasa_de_cierre_pct).toBe(16);
  });
});

describe("recortar", () => {
  it("corta los textos largos y deja los cortos", () => {
    expect(recortar("hola")).toBe("hola");
    expect(recortar(null)).toBe("");
    expect(recortar("x".repeat(400))).toHaveLength(300);
  });
});
