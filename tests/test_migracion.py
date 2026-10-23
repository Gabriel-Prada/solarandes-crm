"""Pruebas de la migración del Excel heredado (fase 2).

respuestas_migracion.csv dice qué hay detrás de cada fila del Excel; con él se califica la
migración. Las reglas de limpieza no se sacan de ahí: solo se usa para medir.
"""

import csv
from datetime import date, datetime
from pathlib import Path

import pytest
from leer_excel import FilaHeredada, columnas_de_encabezado, es_fila_de_total, leer_excel, simplificar
from normalizar import (
    normalizar,
    normalizar_asesor,
    normalizar_ciudad,
    normalizar_consumo,
    normalizar_correo,
    normalizar_etapa,
    normalizar_fecha,
    normalizar_telefono,
    normalizar_tipo,
    separar_nombre,
)

DATOS = Path(__file__).resolve().parents[1] / "data"
RESPUESTAS = DATOS / "heredado" / "respuestas_migracion.csv"


@pytest.fixture(scope="module")
def respuestas() -> list[dict]:
    with RESPUESTAS.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def filas():
    return leer_excel()


@pytest.fixture(scope="module")
def calificadas(filas, respuestas):
    """Cada fila normalizada junto a la respuesta correcta y el contacto verdadero."""
    por_fila = {(r["hoja"], int(r["fila"])): r for r in respuestas}
    with (DATOS / "generados" / "contactos.csv").open(encoding="utf-8") as f:
        verdad = {c["id"]: c for c in csv.DictReader(f)}
    with (DATOS / "generados" / "oportunidades.csv").open(encoding="utf-8") as f:
        for o in csv.DictReader(f):
            if o["tipo"] == "nueva":  # la primera venta del contacto, la que llevaba el Excel
                verdad[o["contacto_id"]]["etapa"] = o["etapa"]
    resultado = []
    for fila in filas:
        respuesta = por_fila[(fila.hoja, fila.fila)]
        resultado.append((normalizar(fila), respuesta, verdad[respuesta["contacto_id"]]))
    return resultado


def test_conserva_exactamente_las_filas_de_personas(filas, respuestas):
    leidas = {(f.hoja, f.fila) for f in filas}
    esperadas = {(r["hoja"], int(r["fila"])) for r in respuestas if r["tipo_fila"] == "dato"}
    assert leidas == esperadas
    assert len(filas) == 327


def test_las_dos_hojas_quedan_con_las_mismas_columnas(filas):
    columnas_por_hoja = {}
    for f in filas:
        columnas_por_hoja.setdefault(f.hoja, set()).update(f.valores)
    assert len(columnas_por_hoja) == 2
    for columnas in columnas_por_hoja.values():
        assert {"nombre", "telefono", "correo", "consumo", "tipo", "fecha", "estado", "notas"} <= columnas


def test_ninguna_fila_conservada_es_un_encabezado_o_un_total(filas):
    for f in filas:
        nombre = simplificar(f.valores["nombre"] or "")
        assert nombre not in {"nombre completo", "cliente"}
        assert not nombre.startswith("total")


def test_simplificar_quita_tildes_mayusculas_y_espacios():
    assert simplificar("  Teléfono   MÓVIL ") == "telefono movil"


def test_un_dato_suelto_que_parece_encabezado_no_se_confunde():
    # Una sola celda conocida ("Cliente") no basta para ser encabezado
    assert columnas_de_encabezado(("Cliente", "Pedro", None)) is None
    assert columnas_de_encabezado(("FECHA", "CLIENTE", "TELEFONO")) == {0: "fecha", 1: "nombre", 2: "telefono"}


# --- Paso 2: normalizar, regla por regla ---


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (3204989513, "+573204989513"),
        ("3056695760.0", "+573056695760"),
        ("(+57) 311-194-36-88", "+573111943688"),
        ("+57 350 2094429", "+573502094429"),
        ("573185859154", "+573185859154"),
        ("301-444-7009", "+573014447009"),
        ("318933597", None),  # le falta un dígito: no se adivina cuál
        ("6024541704", None),  # fijo, no celular
        (None, None),
    ],
)
def test_normalizar_telefono(valor, esperado):
    assert normalizar_telefono(valor) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (" Daniela.Trujillo@Example.COM ", "daniela.trujillo@example.com"),
        ("panaderia.torres@example", None),  # sin terminación: no se inventa .com ni .net
        (None, None),
    ],
)
def test_normalizar_correo(valor, esperado):
    assert normalizar_correo(valor) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("Bta", "Bogotá"),
        ("Bogotá D.C.", "Bogotá"),
        ("Cali - Valle", "Cali"),
        ("Santiago de Cali", "Cali"),
        ("Mde", "Medellín"),
        ("Medellín, Antioquia", "Medellín"),
        ("Pasto", None),
        ("Localidad de Suba", None),  # contiene "cali", pero no es Cali
        ("Calima", None),
        (None, None),
    ],
)
def test_normalizar_ciudad(valor, esperado):
    assert normalizar_ciudad(valor) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("Casa", "hogar"),
        ("RESIDENCIAL", "hogar"),
        ("Comercial", "negocio"),
        ("Empresa", "negocio"),
        ("Industrial", None),
    ],
)
def test_normalizar_tipo(valor, esperado):
    assert normalizar_tipo(valor) == esperado


def test_separar_nombre_de_empresa_y_persona():
    assert separar_nombre("HOTEL LÓPEZ - MILENA CORREA  ORDÓÑEZ ") == ("Milena Correa Ordóñez", "Hotel López", False)
    assert separar_nombre("Milena Correa - Hotel López") == ("Milena Correa", "Hotel López", False)  # al revés
    assert separar_nombre("carnicería vélez s.a.s. ") == (None, "Carnicería Vélez S.A.S.", False)
    assert separar_nombre("sandra  de la torre") == ("Sandra de la Torre", None, False)
    assert separar_nombre(None) == (None, None, False)


def test_un_guion_sin_negocio_no_se_adivina():
    assert separar_nombre("Pedro Gómez - Hijo") == (None, None, True)
    contacto = normalizar(FilaHeredada(hoja="Clientes BOG-CALI", fila=9, valores={"nombre": "Pedro Gómez - Hijo"}))
    assert "nombre_dudoso" in contacto.problemas
    assert contacto.tipo is None  # sin empresa no se deduce que sea un negocio


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (604, 604),
        (604.0, 604),
        ("2038kwh", 2038),
        ("604 kWh", 604),
        ("aprox 277", 277),
        ("-300", None),
        ("0", None),
        (None, None),
    ],
)
def test_normalizar_consumo(valor, esperado):
    assert normalizar_consumo(valor) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (datetime(2026, 1, 30), date(2026, 1, 30)),
        ("2025-12-06", date(2025, 12, 6)),
        ("02/12/2025", date(2025, 12, 2)),  # día/mes, no mes/día
        ("24-nov-25", date(2025, 11, 24)),
        ("4 de enero de 2026", date(2026, 1, 4)),
        ("31/02/2026", None),
        ("ayer", None),
    ],
)
def test_normalizar_fecha(valor, esperado):
    assert normalizar_fecha(valor) == esperado


def test_normalizar_asesor_y_etapa():
    escritos = ["ANDRÉS", "A. Rojas", "Cami", "C. Torres", "Vale", "Pedro", "Camila Ruiz", "valeria"]
    assert [normalizar_asesor(a) for a in escritos] == ["U02", "U02", "U04", "U04", "U03", None, None, None]
    assert [normalizar_etapa(e) for e in ["cerró!!", "Cotizado ✓", "no contesta", "VISITA", "???"]] == [
        "ganado", "cotizado", "perdido", "visita_agendada", None,
    ]  # fmt: skip


def test_la_hoja_de_medellin_aporta_ciudad_y_asesor():
    fila = FilaHeredada(hoja="Medellín (Vale)", fila=3, valores={"nombre": "Ana Ruiz", "telefono": "3001234567"})
    contacto = normalizar(fila)
    assert (contacto.ciudad, contacto.asesor) == ("Medellín", "U03")
    assert "correo_vacio" in contacto.problemas


# --- Paso 2: calificación contra las respuestas correctas ---


def test_recupera_exactamente_los_telefonos_recuperables(calificadas):
    for contacto, respuesta, verdad in calificadas:
        esperado = verdad["telefono"] if respuesta["telefono_recuperable"] == "true" else None
        assert contacto.telefono == esperado, (contacto.hoja, contacto.fila)


def test_recupera_exactamente_los_correos_recuperables(calificadas):
    for contacto, respuesta, verdad in calificadas:
        esperado = verdad["email"] if respuesta["correo_recuperable"] == "true" else None
        assert contacto.correo == esperado, (contacto.hoja, contacto.fila)


def test_nunca_inventa_un_valor_equivocado(calificadas):
    """Un valor puede quedar vacío si no se sabe, pero si se llena, tiene que ser el correcto."""
    for contacto, _, verdad in calificadas:
        donde = (contacto.hoja, contacto.fila)
        assert contacto.ciudad in (None, verdad["ciudad"]), donde
        assert contacto.tipo in (None, verdad["tipo"]), donde
        assert contacto.asesor in (None, verdad["asesor_id"]), donde
        assert contacto.consumo_kwh_mes in (None, int(verdad["consumo_kwh_mes"])), donde
        assert contacto.etapa in (None, verdad["etapa"]), donde
        assert contacto.fecha_contacto in (None, date.fromisoformat(verdad["creado_en"][:10])), donde
        if contacto.empresa:
            assert simplificar(contacto.empresa) == simplificar(verdad["empresa"]), donde
        if contacto.nombre:  # el orden puede venir al revés ("Mosquera Aldair"), las palabras no
            assert set(simplificar(contacto.nombre).split()) == set(simplificar(verdad["nombre"]).split()), donde


def test_entiende_todas_las_fechas_y_estados_escritos(calificadas):
    for contacto, _, _ in calificadas:
        assert "fecha_contacto_ilegible" not in contacto.problemas, (contacto.hoja, contacto.fila)
        assert "etapa_ilegible" not in contacto.problemas, (contacto.hoja, contacto.fila)


def test_cuanto_se_recupera(calificadas):
    """No es una regla sino una foto: si una mejora sube estas cifras, se actualizan aquí."""
    contactos = [c for c, _, _ in calificadas]
    assert sum(c.telefono is not None for c in contactos) == 303
    assert sum(c.correo is not None for c in contactos) == 276
    assert sum(c.ciudad is not None for c in contactos) == 314
    assert sum(c.asesor is not None for c in contactos) == 318


def test_celdas_con_solo_espacios_cuentan_como_vacias():
    fila = FilaHeredada(
        hoja="Clientes BOG-CALI", fila=9, valores={"nombre": "Ana Ruiz", "telefono": "  ", "notas": "   "}
    )
    contacto = normalizar(fila)
    assert contacto.notas is None
    assert "telefono_vacio" in contacto.problemas


def test_en_la_hoja_de_medellin_una_ciudad_ilegible_no_se_vuelve_medellin():
    fila = FilaHeredada(hoja="Medellín (Vale)", fila=9, valores={"nombre": "Ana Ruiz", "ciudad": "Pasto"})
    contacto = normalizar(fila)
    assert contacto.ciudad is None
    assert "ciudad_ilegible" in contacto.problemas


def test_un_cliente_que_empieza_por_total_no_es_la_fila_de_total():
    assert es_fila_de_total(("TOTAL CLIENTES", 239))
    assert es_fila_de_total(("Total:", 239))
    assert not es_fila_de_total(("Totalgas S.A.S.", "3001234567"))
