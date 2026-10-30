"""Arma la propuesta comercial de SolarAndes en PDF (skill "Propuesta comercial", fase 5, pieza 6).

Uso: python propuesta.py datos.json salida.pdf

La IA redacta los textos; los números salen tal cual de la cotización vigente del CRM. Este script no
calcula precios: solo revisa que los datos tengan sentido y los presenta con la marca.
"""

import json
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.platypus.flowables import Flowable

AMARILLO = HexColor("#F59E0B")
AZUL = HexColor("#1E293B")
GRIS = HexColor("#57534E")
FONDO = HexColor("#FFFBEB")
MAXIMO_TEXTO = 900

INCLUYE = (
    "Llave en mano: paneles, inversor, estructura, cableado y protecciones; instalación por nuestro equipo "
    "técnico; y los trámites ante el operador de red."
)


def pesos(valor: int) -> str:
    """14850000 → "$14.850.000" (como en Colombia)."""
    return "$" + f"{int(valor):,}".replace(",", ".")


def numero(valor) -> str:
    """3.3 → "3,3"; 6 → "6"."""
    return f"{valor:g}".replace(".", ",")


ESTADOS_PRESENTABLES = ("enviada", "aceptada")


def es_numero(valor) -> bool:
    """Un número de verdad: True/False también son números en Python, pero aquí no valen."""
    return isinstance(valor, int | float) and not isinstance(valor, bool)


def es_entero(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def validar(datos: dict) -> list[str]:
    """Lo que impide armar la propuesta. Vacía si todo está bien."""
    errores = []
    cotizacion = datos.get("cotizacion")
    if not isinstance(cotizacion, dict):
        return ["La venta no tiene cotización vigente: hay que cotizar primero en el CRM."]
    # Una cotización rechazada (o reemplazada) no se le vuelve a presentar al cliente
    if cotizacion.get("estado") not in ESTADOS_PRESENTABLES:
        estado = cotizacion.get("estado") or "sin estado"
        return [
            f"La cotización está «{estado}»: solo se presentan las enviadas o aceptadas. Cotiza de nuevo en el CRM."
        ]
    for campo in ("numero", "fecha", "num_paneles", "potencia_kwp", "valor_total_cop"):
        if cotizacion.get(campo) in (None, ""):
            errores.append(f"Falta {campo} en la cotización.")
    if not errores:
        if not (es_entero(cotizacion["num_paneles"]) and cotizacion["num_paneles"] > 0):
            errores.append("El número de paneles debe ser un entero mayor que cero.")
        if not (es_numero(cotizacion["potencia_kwp"]) and cotizacion["potencia_kwp"] > 0):
            errores.append("La potencia debe ser un número mayor que cero.")
        if not (es_entero(cotizacion["valor_total_cop"]) and cotizacion["valor_total_cop"] > 0):
            errores.append("El valor total debe ser un entero en pesos mayor que cero.")
        descuento = cotizacion.get("descuento_pct", 0)
        if not (es_numero(descuento) and 0 <= descuento <= 30):
            errores.append("El descuento debe ser un número entre 0 % y 30 %, como en el CRM.")
        consumo = cotizacion.get("consumo_kwh_mes")
        if consumo is not None and not (es_entero(consumo) and consumo > 0):
            errores.append("El consumo de la cotización debe ser un entero mayor que cero.")
    cliente = datos.get("cliente") or {}
    if not cliente.get("nombre") or not cliente.get("ciudad"):
        errores.append("Faltan el nombre o la ciudad del cliente.")
    for clave, texto in (datos.get("textos") or {}).items():
        if not isinstance(texto, str) or len(texto) > MAXIMO_TEXTO:
            errores.append(f"El texto «{clave}» debe tener máximo {MAXIMO_TEXTO} letras.")
    return errores


class Logo(Flowable):
    """El sol de SolarAndes: un círculo con rayos, dibujado (sin imágenes externas)."""

    def __init__(self, tamano=14 * mm):
        super().__init__()
        self.width = self.height = tamano

    def draw(self):
        import math

        c, r = self.width / 2, self.width / 5
        self.canv.setFillColor(AMARILLO)
        self.canv.setStrokeColor(AMARILLO)
        self.canv.circle(c, c, r, fill=1, stroke=0)
        self.canv.setLineWidth(1.6)
        for i in range(8):
            angulo = i * math.pi / 4
            self.canv.line(
                c + math.cos(angulo) * r * 1.5,
                c + math.sin(angulo) * r * 1.5,
                c + math.cos(angulo) * r * 2.3,
                c + math.sin(angulo) * r * 2.3,
            )


def armar(datos: dict, salida: Path) -> None:
    errores = validar(datos)
    if errores:
        raise ValueError(" ".join(errores))

    cliente, venta, cot = datos["cliente"], datos.get("venta") or {}, datos["cotizacion"]
    textos = datos.get("textos") or {}
    estilo = ParagraphStyle("texto", fontName="Helvetica", fontSize=10.5, leading=15, textColor=AZUL)
    titulo = ParagraphStyle("titulo", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=AZUL)
    seccion = ParagraphStyle("seccion", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=AMARILLO)
    pequeno = ParagraphStyle("pequeno", fontName="Helvetica", fontSize=8, leading=11, textColor=GRIS)

    def parrafo(texto, est=estilo):
        # El texto pudo escribirlo Claude a partir de datos del cliente: se escapa, nunca se interpreta
        seguro = str(texto).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return Paragraph(seguro, est)

    para_quien = cliente["nombre"] + (f" · {cliente['empresa']}" if cliente.get("empresa") else "")
    encabezado = Table(
        [[Logo(), Paragraph("<b>SolarAndes S.A.S.</b><br/>Energía solar en Bogotá, Medellín y Cali", estilo)]],
        colWidths=[18 * mm, None],
    )
    encabezado.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))

    filas = [
        ["Paneles solares de 550 W", numero(cot["num_paneles"])],
        ["Potencia instalada", f"{numero(cot['potencia_kwp'])} kWp"],
    ]
    # El consumo con el que se calculó la cotización (el del contacto pudo cambiar después)
    if cot.get("consumo_kwh_mes"):
        filas.append(["Consumo mensual de referencia", f"{numero(cot['consumo_kwh_mes'])} kWh"])
    if cot.get("descuento_pct"):
        filas.append(["Descuento", f"{numero(cot['descuento_pct'])} %"])
    filas.append(["Valor total (llave en mano)", pesos(cot["valor_total_cop"])])
    tabla = Table(filas, colWidths=[110 * mm, None])
    tabla.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 10.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), AZUL),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("BACKGROUND", (0, 0), (-1, -1), FONDO),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 1, AMARILLO),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    historia = [
        encabezado,
        Spacer(1, 8 * mm),
        parrafo("Propuesta comercial", titulo),
        parrafo(f"Para: {para_quien} · {cliente['ciudad']}"),
        parrafo(f"Cotización {cot['numero']} (versión {cot.get('version', 1)}) del {cot['fecha']}", pequeno),
        Spacer(1, 6 * mm),
    ]
    if textos.get("introduccion"):
        historia += [parrafo(textos["introduccion"]), Spacer(1, 5 * mm)]
    historia += [parrafo("Su sistema solar", seccion), Spacer(1, 2 * mm), tabla, Spacer(1, 5 * mm)]
    if textos.get("por_que"):
        historia += [parrafo("Por qué este sistema", seccion), parrafo(textos["por_que"]), Spacer(1, 4 * mm)]
    historia += [parrafo("Qué incluye", seccion), parrafo(INCLUYE), Spacer(1, 4 * mm)]
    if textos.get("siguientes_pasos"):
        historia += [parrafo("Siguientes pasos", seccion), parrafo(textos["siguientes_pasos"]), Spacer(1, 6 * mm)]
    if datos.get("asesor"):
        historia.append(parrafo(f"Su asesor: {datos['asesor']}"))
    historia += [
        Spacer(1, 8 * mm),
        parrafo(
            f"Los valores son los de la cotización {cot['numero']}"
            + (f" de la venta {venta['codigo']}" if venta.get("codigo") else "")
            + ". SolarAndes S.A.S. es una empresa ficticia: documento de un portafolio, sin validez comercial.",
            pequeno,
        ),
    ]

    documento = SimpleDocTemplate(
        str(salida), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Propuesta {cot['numero']}", author="SolarAndes S.A.S.",
    )  # fmt: skip
    documento.build(historia)


def main() -> int:
    if len(sys.argv) != 3:
        print("Uso: python propuesta.py datos.json salida.pdf")
        return 2
    datos = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    try:
        armar(datos, Path(sys.argv[2]))
    except ValueError as error:
        print(f"No armé la propuesta: {error}")
        return 1
    print(f"Propuesta lista: {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
