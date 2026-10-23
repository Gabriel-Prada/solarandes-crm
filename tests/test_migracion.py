"""Pruebas de la migración del Excel heredado (fase 2).

respuestas_migracion.csv dice qué hay detrás de cada fila del Excel; con él se califica la
migración. Las reglas de limpieza no se sacan de ahí: solo se usa para medir.
"""

import csv
from dataclasses import fields
from datetime import date, datetime
from pathlib import Path

import pytest
from duplicados import REVISION, SEGURO, agrupar, comparar, deduplicar, unificar
from leer_excel import FilaHeredada, columnas_de_encabezado, es_fila_de_total, leer_excel, simplificar
from normalizar import (
    ContactoLimpio,
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


# --- Paso 3: duplicados ---


def contacto(**campos) -> ContactoLimpio:
    """Un contacto inventado para las pruebas: solo se llenan los campos que importan."""
    base = {f.name: None for f in fields(ContactoLimpio)} | {"hoja": "Prueba", "fila": 1, "problemas": []}
    return ContactoLimpio(**(base | campos))


def test_mismo_telefono_y_nombre_compatible_es_seguro():
    a = contacto(nombre="Aldair Mosquera", telefono="+573002439576")
    b = contacto(nombre="MOSQUERA ALDAIR", telefono="+573002439576", correo="aldair@example.org")
    assert comparar(a, b).nivel == SEGURO


def test_mismo_nombre_y_misma_ciudad_es_seguro():
    a = contacto(nombre="Mauricio Hernández", telefono="+573138586020", ciudad="Medellín")
    b = contacto(nombre="Mauricio  Hernandez", correo="mauricio.hernandez@example.net", ciudad="Medellín")
    assert comparar(a, b).nivel == SEGURO


def test_mismo_nombre_sin_nada_mas_que_lo_confirme_va_a_revision():
    # "Juan Pérez" hay muchos: sin teléfono, correo ni ciudad en común, decide una persona
    a = contacto(nombre="Juan Pérez", telefono="+573001111111")
    b = contacto(nombre="Juan Perez", correo="juan.perez@example.com")
    assert comparar(a, b).nivel == REVISION


def test_nombre_parecido_sin_confirmacion_va_a_revision():
    a = contacto(nombre="David Sánchez", ciudad="Cali")
    b = contacto(nombre="David Sánchez Gómez", ciudad="Cali")
    assert comparar(a, b).nivel == REVISION


def test_telefonos_distintos_no_se_unen_aunque_el_nombre_se_parezca():
    a = contacto(nombre="David Sánchez", telefono="+573114302048")
    b = contacto(nombre="David Sánchez Gómez", telefono="+573108631648")
    assert comparar(a, b) is None


def test_mismo_nombre_con_telefonos_distintos_va_a_revision():
    a = contacto(nombre="Ana Ruiz", telefono="+573001111111")
    b = contacto(nombre="Ana Ruiz", telefono="+573002222222")
    assert comparar(a, b).nivel == REVISION


def test_mismo_telefono_con_nombres_distintos_va_a_revision():
    # Puede ser una familia que comparte el celular: no se une sola
    a = contacto(nombre="Ana Ruiz", telefono="+573001111111")
    b = contacto(nombre="Pedro Ruiz", telefono="+573001111111")
    assert comparar(a, b).nivel == REVISION


def test_la_misma_empresa_con_y_sin_sas_es_la_misma():
    a = contacto(empresa="Panadería Torres S.A.S.", ciudad="Bogotá")
    b = contacto(empresa="PANADERIA TORRES", nombre="Astrid Monroy", ciudad="Bogotá")
    assert comparar(a, b).nivel == SEGURO


def test_dos_personas_de_la_misma_empresa_no_son_la_misma():
    a = contacto(empresa="Hotel López", nombre="Milena Correa", ciudad="Bogotá")
    b = contacto(empresa="Hotel López", nombre="Juan Pérez", ciudad="Bogotá")
    assert comparar(a, b) is None


def test_una_cadena_que_junta_contradicciones_no_se_une_sola():
    # A y B comparten teléfono; B y C, correo; pero A es de Bogotá y C de Cali
    a = contacto(fila=1, nombre="Ana Ruiz", telefono="+573001111111", ciudad="Bogotá")
    b = contacto(fila=2, telefono="+573001111111", correo="ana@example.com")
    c = contacto(fila=3, nombre="Ana Ruiz", correo="ana@example.com", ciudad="Cali")
    grupos, revision = agrupar([a, b, c])
    assert [len(g) for g in grupos] == [1, 1, 1]  # el grupo entero queda sin unir
    assert any("ciudad" in r.razon for r in revision)  # y alguien tiene que decidir


@pytest.mark.parametrize(
    "filas",
    [
        # Una familia que comparte celular, más una fila sin nombre con ese celular
        [
            {"nombre": "Ana Ruiz", "telefono": "+573001111111"},
            {"nombre": "Pedro Ruiz", "telefono": "+573001111111"},
            {"telefono": "+573001111111"},
        ],
        # Dos personas del mismo hotel, más una fila con solo el nombre del hotel
        [
            {"empresa": "Hotel López", "nombre": "Milena Correa", "ciudad": "Bogotá"},
            {"empresa": "Hotel López", "ciudad": "Bogotá"},
            {"empresa": "Hotel López", "nombre": "Juan Pérez", "ciudad": "Bogotá"},
        ],
        # Dos David distintos, unidos por una fila sin nombre con el teléfono de uno y el correo del otro
        [
            {"nombre": "David Sánchez", "telefono": "+573114302048"},
            {"telefono": "+573114302048", "correo": "david.sanchez@example.com"},
            {"nombre": "David Sánchez Gómez", "correo": "david.sanchez@example.com"},
        ],
    ],
)
def test_una_fila_sin_nombre_no_sirve_de_puente_entre_dos_personas(filas):
    contactos = [contacto(fila=n, **campos) for n, campos in enumerate(filas, start=1)]
    grupos, revision = agrupar(contactos)
    assert [len(g) for g in grupos] == [1, 1, 1]
    assert revision


def test_una_pareja_en_revision_nunca_queda_unida():
    contactos = [
        contacto(fila=1, nombre="Ana Ruiz", telefono="+573001111111"),
        contacto(fila=2, nombre="Pedro Ruiz", telefono="+573001111111"),
        contacto(fila=3, nombre="Ana Ruiz", correo="ana@example.com", ciudad="Cali"),
    ]
    grupos, revision = agrupar(contactos)
    for pareja in revision:
        assert not any(pareja.a in g and pareja.b in g for g in grupos)


def test_el_orden_de_las_filas_no_cambia_los_grupos():
    contactos = [
        contacto(fila=1, nombre="Ana Ruiz", telefono="+573001111111"),
        contacto(fila=2, telefono="+573001111111", correo="ana@example.com"),
        contacto(fila=3, nombre="Ana Ruiz", telefono="+573002222222", correo="ana@example.com"),
        contacto(fila=4, nombre="Luis Mora", telefono="+573003333333"),
        contacto(fila=5, nombre="LUIS MORA", telefono="+573003333333"),
    ]

    def filas_por_grupo(lista):
        return sorted(tuple(sorted(c.fila for c in g)) for g in agrupar(lista)[0])

    assert filas_por_grupo(contactos) == filas_por_grupo(list(reversed(contactos)))


def test_unificar_toma_lo_mejor_de_cada_fila():
    vieja = contacto(
        fila=1, nombre="Mosquera Aldair", telefono="+573002439576", fecha_contacto=date(2025, 11, 1), etapa="contactado"
    )
    nueva = contacto(
        fila=2, nombre="Aldair Mosquera Ríos", correo="aldair@example.org", fecha_contacto=date(2026, 1, 5),
        etapa="perdido", notas="Pidió financiación",
    )  # fmt: skip
    persona = unificar([vieja, nueva])
    assert persona.nombre == "Aldair Mosquera Ríos"  # la forma más completa
    assert (persona.telefono, persona.correo) == ("+573002439576", "aldair@example.org")  # se completan
    assert persona.fecha_contacto == date(2025, 11, 1)  # la primera vez que apareció
    assert persona.etapa == "perdido"  # lo último que se supo
    assert persona.notas == ["Pidió financiación"]
    assert persona.filas == [("Prueba", 1), ("Prueba", 2)]


def test_si_las_filas_dicen_cosas_distintas_gana_la_reciente_y_se_anota():
    vieja = contacto(fila=1, nombre="Ana Ruiz", consumo_kwh_mes=300, fecha_contacto=date(2025, 11, 1))
    nueva = contacto(fila=2, nombre="Ana Ruiz", consumo_kwh_mes=350, fecha_contacto=date(2026, 1, 5))
    persona = unificar([vieja, nueva])
    assert persona.consumo_kwh_mes == 350
    assert "consumo_kwh_mes_distinto_entre_filas" in persona.problemas


@pytest.fixture(scope="module")
def deduplicado(filas):
    return deduplicar([normalizar(f) for f in filas])


def test_cada_persona_real_queda_una_sola_vez(deduplicado, respuestas):
    personas, _ = deduplicado
    contacto_de = {(r["hoja"], int(r["fila"])): r["contacto_id"] for r in respuestas}
    for persona in personas:  # ningún grupo mezcla a dos personas reales
        assert len({contacto_de[f] for f in persona.filas}) == 1, persona.filas
    reales = [contacto_de[p.filas[0]] for p in personas]
    assert len(reales) == len(set(reales)) == 280  # y ninguna persona quedó partida en dos


def test_este_excel_no_deja_nada_en_revision(deduplicado):
    _, revision = deduplicado
    assert revision == []


def test_unir_duplicados_recupera_datos(deduplicado):
    """Una foto, como test_cuanto_se_recupera.

    Antes de unir faltaban 24 teléfonos y 51 correos, contados por fila; después de unir faltan
    16 y 34, contados por persona, porque una fila repetida completa lo que a otra le faltaba.
    """
    personas, _ = deduplicado
    assert sum(p.telefono is None for p in personas) == 16
    assert sum(p.correo is None for p in personas) == 34


def test_unificar_conserva_si_un_dato_no_se_escribio_o_no_se_entendio():
    ilegible = contacto(fila=1, nombre="Ana Ruiz", problemas=["telefono_ilegible"])
    sin_escribir = contacto(fila=2, nombre="Ana Ruiz", problemas=["telefono_vacio"])
    assert "telefono_ilegible" in unificar([ilegible, sin_escribir]).problemas
    assert "telefono_vacio" in unificar([sin_escribir]).problemas
    dudoso = contacto(fila=3, problemas=["nombre_dudoso"])
    assert "nombre_dudoso" in unificar([dudoso]).problemas


def test_las_fichas_en_duda_quedan_marcadas_para_no_cargarlas():
    ana = contacto(fila=1, nombre="Ana Ruiz", telefono="+573001111111")
    pedro = contacto(fila=2, nombre="Pedro Ruiz", telefono="+573001111111")
    luis = contacto(fila=3, nombre="Luis Mora", telefono="+573003333333")
    personas, _ = deduplicar([ana, pedro, luis])
    pendientes = {p.nombre for p in personas if "pendiente_de_revision" in p.problemas}
    assert pendientes == {"Ana Ruiz", "Pedro Ruiz"}
