"""Revisa los casos del examen de la calificación de leads (scripts/evals/casos_leads.py).

Un examen mal armado da cifras falsas: casos repetidos entre desarrollo y prueba inflan el acierto,
y una respuesta "correcta" que no cuadra con la regla de prioridad confunde el resultado.
"""

import hashlib
import json

import casos_leads as c
import pytest
from conexion import RAIZ, RUTA_ENV

VALORES = {
    "tipo_cliente": {"hogar", "negocio", "no_se_sabe"},
    "urgencia": {"alta", "media", "baja", "no_se_sabe"},
    "intencion": {"quiere_sistema", "solo_informacion", "otra"},
}


@pytest.fixture(scope="module")
def conjuntos():
    return c.generar()


def test_es_reproducible_y_coincide_con_los_archivos(conjuntos):
    assert c.generar() == conjuntos
    for nombre, casos in conjuntos.items():
        lineas = (c.CARPETA / f"{nombre}.jsonl").read_text(encoding="utf-8").splitlines()
        assert [json.loads(linea) for linea in lineas] == casos, f"Corre scripts/evals/casos_leads.py ({nombre})"


def test_tamanos_e_identificadores(conjuntos):
    # 40 + 4 que salieron de prueba porque el prompt los "conocía"; 50 - 4 en prueba
    assert len(conjuntos["desarrollo"]) == 44
    assert len(conjuntos["prueba"]) == 46
    ids = [caso["id"] for casos in conjuntos.values() for caso in casos]
    assert len(ids) == len(set(ids))


def test_desarrollo_y_prueba_no_se_mezclan(conjuntos):
    mensajes = {conjunto: {caso["mensaje"] for caso in casos} for conjunto, casos in conjuntos.items()}
    assert not mensajes["desarrollo"] & mensajes["prueba"]
    # Las frases de las plantillas tampoco se repiten entre los dos conjuntos
    for parte in c.FRASES["desarrollo"]:
        assert not set(c.FRASES["desarrollo"][parte]) & set(c.FRASES["prueba"][parte]), parte


def test_las_respuestas_tienen_la_forma_de_la_ficha(conjuntos):
    for casos in conjuntos.values():
        for caso in casos:
            e = caso["esperado"]
            assert isinstance(e["es_lead"], bool)
            for campo, validos in VALORES.items():
                assert e[campo] in validos, (caso["id"], campo)
                assert set(caso.get("aceptables", {}).get(campo, [])) <= validos, (caso["id"], campo)
            for campo in ("consumo_kwh_mes", "factura_luz_cop"):
                assert e[campo] is None or (isinstance(e[campo], int) and e[campo] > 0)
            assert caso["entrada"]["ciudad"] in c.CIUDADES


def test_hay_suficientes_leads_de_cada_prioridad_en_prueba(conjuntos):
    objetivos = [caso.get("prioridad_objetivo") for caso in conjuntos["prueba"]]
    assert objetivos.count("alta") >= 10
    assert objetivos.count("baja") >= 8
    assert sum(not caso["esperado"]["es_lead"] for caso in conjuntos["prueba"]) >= 2
    assert sum(caso["origen"] == "a_mano" for caso in conjuntos["prueba"]) >= 10


def test_el_examen_no_toca_los_datos_del_crm(conjuntos, tmp_path, monkeypatch):
    assert c.CARPETA.is_relative_to(RAIZ / "data" / "evals")
    assert c.SEMILLA != 2026  # la semilla del generador de datos del CRM

    def huella():
        return {r.name: hashlib.sha256(r.read_bytes()).hexdigest() for r in (RAIZ / "data" / "generados").glob("*.csv")}

    antes = huella()
    monkeypatch.setattr(c, "CARPETA", tmp_path)
    c.guardar(c.generar())
    assert huella() == antes


def test_los_casos_externos_tienen_la_forma_de_la_ficha():
    # Los escribió un examinador que nunca vio el prompt ni los demás casos; no se leen antes de correrlos
    casos = [
        json.loads(linea) for linea in (c.CARPETA / "prueba_externa.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(casos) >= 12
    for caso in casos:
        assert caso["conjunto"] == "prueba_externa" and caso["origen"] == "externo"
        e = caso["esperado"]
        assert isinstance(e["es_lead"], bool)
        for campo, validos in VALORES.items():
            assert e[campo] in validos
        assert caso["entrada"]["ciudad"] in c.CIUDADES


@pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")
def test_la_prioridad_objetivo_es_la_que_calcula_la_base(conjuntos):
    from conexion import conectar

    with conectar() as con, con.transaction(force_rollback=True):
        aplicadas = {n for (n,) in con.execute("select nombre from control.migraciones")}
        if "020_calificacion_de_leads.sql" not in aplicadas:
            con.execute(
                (RAIZ / "supabase" / "migraciones" / "020_calificacion_de_leads.sql").read_text(encoding="utf-8")
            )
        for casos in conjuntos.values():
            for caso in casos:
                if "prioridad_objetivo" not in caso:
                    continue
                calculada = con.execute(
                    "select prioridad_regla(%s::jsonb, %s::jsonb)",
                    (json.dumps(caso["esperado"]), json.dumps(caso["entrada"])),
                ).fetchone()[0]
                assert calculada == caso["prioridad_objetivo"], caso["id"]
