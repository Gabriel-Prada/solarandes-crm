"""Arma el informe gerencial mensual de SolarAndes en PDF (skill "Informe gerencial", fase 5, pieza 7).

Uso: python informe.py datos.json salida.pdf

Las cifras salen tal cual de panel_del_negocio y ventas_sin_seguimiento del CRM. El script solo hace la
comparación del mes con el anterior (con esas mismas cifras), dibuja los gráficos y arma el PDF.
"""

import io
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # sin ventana: solo dibuja a un archivo
import matplotlib.pyplot as plt  # noqa: E402
from reportlab.lib.colors import HexColor  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle  # noqa: E402

AMARILLO, AZUL, GRIS = "#F59E0B", "#1E293B", "#57534E"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
         "noviembre", "diciembre"]  # fmt: skip
MAXIMO_TEXTO = 700


def pesos_millones(valor: int) -> str:
    """143130000 → "$143,1 M"."""
    return f"${valor / 1_000_000:,.1f} M".replace(",", "X").replace(".", ",").replace("X", ".")


def nombre_mes(mes: str) -> str:
    anio, numero = mes.split("-")
    return f"{MESES[int(numero) - 1]} de {anio}"


def mes_anterior(mes: str) -> str:
    anio, numero = (int(x) for x in mes.split("-"))
    return f"{anio - 1}-12" if numero == 1 else f"{anio}-{numero - 1:02d}"


def comparar_meses(por_mes: list[dict], mes: str) -> dict:
    """Ventas y valor del mes contra el anterior, con las cifras del panel. Error si el mes no está."""
    por_clave = {m["mes"]: m for m in por_mes}
    if mes not in por_clave:
        raise ValueError(f"El panel no trae ventas de {mes}: el informe solo cubre los últimos 12 meses.")
    actual, anterior = por_clave[mes], por_clave.get(mes_anterior(mes))
    variacion = None
    if anterior and anterior["valor"]:
        variacion = round((actual["valor"] - anterior["valor"]) / anterior["valor"] * 100)
    return {"actual": actual, "anterior": anterior, "variacion_valor_pct": variacion}


def validar(datos: dict) -> list[str]:
    errores = []
    if not isinstance(datos.get("mes"), str) or len(datos["mes"]) != 7:
        errores.append("Falta el mes, como AAAA-MM.")
    panel = datos.get("panel") or {}
    for clave in ("indicadores", "ventas_por_mes", "embudo", "motivos_de_perdida"):
        if clave not in panel:
            errores.append(f"El panel no trae «{clave}»: pásalo completo, como lo devolvió panel_del_negocio.")
    if "por_asesor" not in (datos.get("seguimiento") or {}):
        errores.append("Falta el seguimiento por asesor (ventas_sin_seguimiento).")
    textos = datos.get("textos") or {}
    for clave, valor in textos.items():
        lista = valor if isinstance(valor, list) else [valor]
        if any(not isinstance(t, str) or len(t) > MAXIMO_TEXTO for t in lista):
            errores.append(f"Los textos de «{clave}» deben tener máximo {MAXIMO_TEXTO} letras.")
    return errores


def grafico(dibujar, alto=2.4) -> Image:
    """Dibuja con matplotlib y lo devuelve como imagen para el PDF."""
    figura, eje = plt.subplots(figsize=(6.6, alto), dpi=150)
    dibujar(eje)
    for lado in ("top", "right"):
        eje.spines[lado].set_visible(False)
    eje.tick_params(colors=GRIS, labelsize=8)
    figura.tight_layout()
    memoria = io.BytesIO()
    figura.savefig(memoria, format="png")
    plt.close(figura)
    memoria.seek(0)
    return Image(memoria, width=165 * mm, height=165 * mm * alto / 6.6)


def armar(datos: dict, salida: Path) -> None:
    errores = validar(datos)
    if errores:
        raise ValueError(" ".join(errores))
    panel, seguimiento, textos, mes = datos["panel"], datos["seguimiento"], datos.get("textos") or {}, datos["mes"]
    comparacion = comparar_meses(panel["ventas_por_mes"], mes)
    ind = panel["indicadores"]

    estilo = ParagraphStyle("texto", fontName="Helvetica", fontSize=10, leading=14, textColor=HexColor(AZUL))
    titulo = ParagraphStyle("titulo", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=HexColor(AZUL))
    seccion = ParagraphStyle(
        "seccion", fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=HexColor(AMARILLO)
    )
    pequeno = ParagraphStyle("pequeno", fontName="Helvetica", fontSize=8, leading=11, textColor=HexColor(GRIS))

    def parrafo(texto, est=estilo):
        seguro = str(texto).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return Paragraph(seguro, est)

    actual, anterior = comparacion["actual"], comparacion["anterior"]
    variacion = comparacion["variacion_valor_pct"]
    frase_mes = f"En {nombre_mes(mes)} se ganaron {actual['ventas']} ventas por {pesos_millones(actual['valor'])}"
    if anterior:
        frase_mes += f" (en {nombre_mes(anterior['mes'])}: {anterior['ventas']} por {pesos_millones(anterior['valor'])}"
        frase_mes += (
            f"; el valor {'subió' if variacion >= 0 else 'bajó'} {abs(variacion)} %)."
            if variacion is not None
            else ")."
        )
    else:
        frase_mes += "."

    izquierda = [
        ("Ganadas en 30 días", str(ind["ganadas_30_dias"])),
        ("Valor ganado en 30 días", pesos_millones(ind["valor_ganado_30_dias_cop"])),
        ("En proceso (ponderado)", pesos_millones(ind["en_proceso_ponderado_cop"])),
    ]
    derecha = [
        ("Tasa de cierre (90 días)", f"{ind['tasa_de_cierre_90_dias_pct']} %"),
        ("Ventas abiertas", str(ind["ventas_abiertas"])),
        ("Sin seguimiento (7+ días)", str(ind["sin_seguimiento_7_dias"])),
    ]
    filas = [[*i, *d] for i, d in zip(izquierda, derecha, strict=True)]
    indicadores = Table(filas, colWidths=[48 * mm, 30 * mm, 50 * mm, 30 * mm])
    indicadores.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
                ("FONTNAME", (3, 0), (3, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), HexColor(AZUL)),
                ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FFFBEB")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    meses = panel["ventas_por_mes"]

    def barras_mes(eje):
        colores = [AMARILLO if m["mes"] == mes else "#FCD34D" for m in meses]
        eje.bar([m["mes"][5:] for m in meses], [m["valor"] / 1_000_000 for m in meses], color=colores)
        eje.set_ylabel("Millones de pesos", color=GRIS, fontsize=8)
        eje.set_title("Valor ganado por mes (el mes del informe, resaltado)", color=AZUL, fontsize=9, loc="left")

    def embudo(eje):
        etapas = panel["embudo"]
        eje.barh([e["etapa"] for e in etapas][::-1], [e["ventas"] for e in etapas][::-1], color=AMARILLO)
        eje.set_title("Embudo: cuántas ventas llegaron a cada etapa (histórico)", color=AZUL, fontsize=9, loc="left")

    def motivos(eje):
        lista = panel["motivos_de_perdida"]
        eje.barh([m["motivo"].replace("_", " ") for m in lista][::-1], [m["ventas"] for m in lista][::-1], color=GRIS)
        eje.set_title("Por qué se pierden las ventas (histórico)", color=AZUL, fontsize=9, loc="left")

    def seguimiento_asesor(eje):
        lista = seguimiento["por_asesor"]
        nombres = [a["asesor"] for a in lista]
        eje.bar(nombres, [a["sin_seguimiento_3_dias"] for a in lista], color="#FCD34D", label="3+ días")
        eje.bar(nombres, [a["aviso_gerente_7_dias"] for a in lista], color=AMARILLO, label="7+ días")
        eje.legend(fontsize=7, frameon=False)
        eje.set_title("Ventas abiertas sin actividad, por asesor (hoy)", color=AZUL, fontsize=9, loc="left")

    historia = [
        parrafo("SolarAndes S.A.S. · Informe gerencial", seccion),
        parrafo(f"Informe de {nombre_mes(mes)}", titulo),
        parrafo(f"Cifras del CRM tomadas el {seguimiento.get('hoy', '')}.", pequeno),
        Spacer(1, 5 * mm),
        parrafo(frase_mes),
        Spacer(1, 4 * mm),
        indicadores,
        Spacer(1, 5 * mm),
    ]
    if textos.get("resumen"):
        historia += [parrafo("Resumen", seccion), parrafo(textos["resumen"]), Spacer(1, 4 * mm)]
    historia += [grafico(barras_mes), Spacer(1, 3 * mm), grafico(seguimiento_asesor)]
    historia += [PageBreak(), grafico(embudo, 2.6), Spacer(1, 3 * mm), grafico(motivos, 2.6), Spacer(1, 4 * mm)]
    for clave, nombre in (("hallazgos", "Hallazgos"), ("recomendaciones", "Recomendaciones")):
        if textos.get(clave):
            historia.append(parrafo(nombre, seccion))
            historia += [parrafo(f"• {t}") for t in textos[clave]]
            historia.append(Spacer(1, 3 * mm))
    historia += [
        Spacer(1, 5 * mm),
        parrafo(
            "Los motivos de pérdida, el embudo, los canales y los resultados por asesor del panel son del histórico "
            "completo. SolarAndes S.A.S. es una empresa ficticia: documento de un portafolio.",
            pequeno,
        ),
    ]

    documento = SimpleDocTemplate(
        str(salida), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Informe gerencial {mes}", author="SolarAndes S.A.S.",
    )  # fmt: skip
    documento.build(historia)


def main() -> int:
    if len(sys.argv) != 3:
        print("Uso: python informe.py datos.json salida.pdf")
        return 2
    datos = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    try:
        armar(datos, Path(sys.argv[2]))
    except ValueError as error:
        print(f"No armé el informe: {error}")
        return 1
    print(f"Informe listo: {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
