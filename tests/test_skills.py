"""Comprueba los scripts de las dos skills de la fase 5 (piezas 6 y 7): la propuesta comercial y el informe
gerencial. La regla de las dos: las cifras salen del CRM tal cual; el script se niega si faltan datos."""

import copy
import importlib.util
import json

import pytest
from conexion import RAIZ
from pypdf import PdfReader

SKILLS = RAIZ / "skills"


def cargar(nombre, archivo):
    spec = importlib.util.spec_from_file_location(nombre, SKILLS / archivo)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


propuesta = cargar("propuesta", "propuesta-comercial-solarandes/scripts/propuesta.py")
informe = cargar("informe", "informe-gerencial-solarandes/scripts/informe.py")


def ejemplo(carpeta):
    return json.loads((SKILLS / carpeta / "ejemplo.json").read_text(encoding="utf-8"))


def texto_del_pdf(ruta):
    """El texto del PDF en una sola línea: el PDF parte las frases donde se acaba el renglón."""
    return " ".join(" ".join(pagina.extract_text() for pagina in PdfReader(ruta).pages).split())


# ---------------------------------------------------------------------------
# Propuesta comercial
# ---------------------------------------------------------------------------


def test_la_propuesta_presenta_los_numeros_de_la_cotizacion_tal_cual(tmp_path):
    salida = tmp_path / "propuesta.pdf"
    propuesta.armar(ejemplo("propuesta-comercial-solarandes"), salida)
    texto = texto_del_pdf(salida)
    for esperado in ["COT-2026-0005", "$14.850.000", "3,3 kWp", "Alirio Mesa", "Valentina Ospina", "empresa ficticia"]:
        assert esperado in texto


def test_sin_cotizacion_vigente_no_hay_propuesta():
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["cotizacion"] = None
    assert propuesta.validar(datos) == ["La venta no tiene cotización vigente: hay que cotizar primero en el CRM."]


@pytest.mark.parametrize(
    ("campo", "valor", "error"),
    [
        ("num_paneles", 0, "número de paneles"),
        ("valor_total_cop", 14850000.5, "valor total"),
        ("descuento_pct", 45, "descuento"),
        ("numero", "", "Falta numero"),
    ],
)
def test_la_propuesta_se_niega_con_numeros_sin_sentido(campo, valor, error):
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["cotizacion"][campo] = valor
    assert any(error in e for e in propuesta.validar(datos))


def test_un_texto_con_etiquetas_se_muestra_como_texto_y_no_se_interpreta(tmp_path):
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["textos"]["introduccion"] = "<b>Hola</b> & bienvenida"
    salida = tmp_path / "propuesta.pdf"
    propuesta.armar(datos, salida)
    assert "<b>Hola</b> & bienvenida" in texto_del_pdf(salida)


@pytest.mark.parametrize("estado", ["rechazada", "reemplazada", None])
def test_no_se_presenta_una_cotizacion_rechazada_ni_reemplazada(estado):
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["cotizacion"]["estado"] = estado
    [error] = propuesta.validar(datos)
    assert "solo se presentan las enviadas o aceptadas" in error


@pytest.mark.parametrize(
    ("campo", "valor"),
    [("descuento_pct", None), ("potencia_kwp", -3.3), ("potencia_kwp", "3,3"), ("num_paneles", True)],
)
def test_la_propuesta_rechaza_numeros_mal_escritos_sin_caerse(campo, valor):
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["cotizacion"][campo] = valor
    assert propuesta.validar(datos)


def test_el_consumo_sale_de_la_cotizacion(tmp_path):
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["consumo_kwh_mes"] = 999  # un consumo del contacto que cambió después: no se usa
    salida = tmp_path / "propuesta.pdf"
    propuesta.armar(datos, salida)
    texto = texto_del_pdf(salida)
    assert "307 kWh" in texto and "999" not in texto


def test_los_textos_largos_se_rechazan():
    datos = ejemplo("propuesta-comercial-solarandes")
    datos["textos"]["por_que"] = "x" * 901
    assert propuesta.validar(datos)


def test_los_pesos_se_escriben_como_en_colombia():
    assert propuesta.pesos(14850000) == "$14.850.000"
    assert propuesta.numero(3.3) == "3,3"


# ---------------------------------------------------------------------------
# Informe gerencial
# ---------------------------------------------------------------------------


def test_el_informe_compara_el_mes_con_el_anterior_con_las_cifras_del_panel(tmp_path):
    salida = tmp_path / "informe.pdf"
    informe.armar(ejemplo("informe-gerencial-solarandes"), salida)
    texto = texto_del_pdf(salida)
    assert "Informe de septiembre de 2026" in texto
    assert "se ganaron 8 ventas por $329,7 M" in texto
    assert "17 por $598,1 M; el valor bajó 45 %" in texto
    assert len(PdfReader(salida).pages) == 2


def test_la_comparacion_de_meses():
    por_mes = [{"mes": "2026-08", "valor": 200, "ventas": 2}, {"mes": "2026-09", "valor": 300, "ventas": 3}]
    assert informe.comparar_meses(por_mes, "2026-09")["variacion_valor_pct"] == 50
    assert informe.comparar_meses(por_mes, "2026-08")["anterior"] is None
    assert informe.mes_anterior("2026-01") == "2025-12"
    with pytest.raises(ValueError, match="no trae ventas de 2025-01"):
        informe.comparar_meses(por_mes, "2025-01")


def test_sin_cambio_dice_que_se_mantuvo_y_redondea_como_el_panel():
    igual = [{"mes": "2026-08", "valor": 200, "ventas": 2}, {"mes": "2026-09", "valor": 200, "ventas": 3}]
    assert informe.comparar_meses(igual, "2026-09")["variacion_valor_pct"] == 0
    # 2,5 % → 3 (como Math.round), no 2 (como round de Python, que redondea al par)
    medio = [{"mes": "2026-08", "valor": 200, "ventas": 2}, {"mes": "2026-09", "valor": 205, "ventas": 3}]
    assert informe.comparar_meses(medio, "2026-09")["variacion_valor_pct"] == 3


def test_los_hallazgos_van_como_lista():
    datos = ejemplo("informe-gerencial-solarandes")
    datos["textos"]["hallazgos"] = "Un solo texto"
    assert any("lista de frases" in e for e in informe.validar(datos))


def test_el_informe_se_niega_si_el_panel_viene_incompleto():
    datos = ejemplo("informe-gerencial-solarandes")
    del datos["panel"]["embudo"]
    datos["seguimiento"] = {}
    errores = informe.validar(datos)
    assert any("embudo" in e for e in errores) and any("seguimiento" in e for e in errores)


def test_el_ejemplo_del_informe_no_se_modifica(tmp_path):
    datos = ejemplo("informe-gerencial-solarandes")
    copia = copy.deepcopy(datos)
    informe.armar(datos, tmp_path / "informe.pdf")
    assert datos == copia
