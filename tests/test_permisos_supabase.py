"""Comprueba en la base de datos real de Supabase que cada rol ve solo lo que le corresponde.

La base de datos se hace pasar por cada usuario (como si hubiera iniciado sesión) dentro de una
transacción que al final se deshace: la prueba no cambia nada.

Necesita el .env con las llaves y los datos cargados con scripts/supabase/cargar_datos.py.
Si no hay .env, la prueba se salta.
"""

import csv
import json
from collections import Counter

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

TABLAS = ["contactos", "oportunidades", "actividades", "cotizaciones", "historial_etapas", "visitas_tecnico"]


@pytest.fixture(scope="module")
def con():
    from conexion import conectar

    with conectar() as conexion:
        yield conexion


@pytest.fixture(scope="module")
def equipo(con):
    filas = con.execute("select codigo, id from perfiles").fetchall()
    con.rollback()
    return dict(filas)


def como(con, usuario_id):
    """Abre una transacción en la que la base de datos cree que este usuario inició sesión."""
    con.execute("set local role authenticated")
    claims = json.dumps({"sub": str(usuario_id), "role": "authenticated"})
    con.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def contar(con, usuario_id) -> dict[str, int]:
    with con.transaction(force_rollback=True):
        como(con, usuario_id)
        return {t: con.execute(f"select count(*) from {t}").fetchone()[0] for t in TABLAS}


def contactos_por_asesor() -> Counter:
    with (RAIZ / "data" / "generados" / "contactos.csv").open(encoding="utf-8") as f:
        return Counter(c["asesor_id"] for c in csv.DictReader(f))


def test_gerente_ve_todo(con, equipo):
    vistos = contar(con, equipo["U01"])
    assert vistos["contactos"] == 1000
    assert vistos["oportunidades"] == 1006


def test_cada_asesor_ve_solo_sus_contactos(con, equipo):
    esperados = contactos_por_asesor()
    for codigo in ("U02", "U03", "U04"):
        assert contar(con, equipo[codigo])["contactos"] == esperados[codigo], codigo


def test_tecnico_solo_ve_sus_visitas_por_la_vista(con, equipo):
    vistos = contar(con, equipo["U05"])
    assert vistos["contactos"] == 0
    assert vistos["oportunidades"] == 0
    assert vistos["cotizaciones"] == 0
    assert vistos["visitas_tecnico"] > 0
    # La vista no tiene columnas de dinero, consumo ni correo
    with con.transaction(force_rollback=True):
        como(con, equipo["U05"])
        columnas = {d.name for d in con.execute("select * from visitas_tecnico limit 1").description}
    assert not columnas & {"valor_cop", "consumo_kwh_mes", "email", "estrato"}


def test_contadora_no_ve_datos_comerciales(con, equipo):
    vistos = contar(con, equipo["U06"])
    assert all(n == 0 for n in vistos.values()), vistos


def test_visitante_sin_sesion_no_ve_nada(con):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("set local role anon")
        con.execute("select count(*) from contactos")


def test_asesor_no_puede_editar_clientes_de_otro(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U02"])  # Andrés, Bogotá
        cambiadas = con.execute(
            "update contactos set nombre = 'hackeado' where asesor_id = %s", (equipo["U03"],)
        ).rowcount
    assert cambiadas == 0


def test_nadie_puede_escribir_el_historial_a_mano(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U01"])  # ni siquiera la gerente
        con.execute(
            "insert into historial_etapas (oportunidad_id, etapa_nueva) select id, 'ganado' from oportunidades limit 1"
        )


def test_mover_una_venta_deja_rastro_en_el_historial(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U02"])
        opp_id = con.execute("select id from oportunidades where etapa = 'contactado' limit 1").fetchone()[0]
        con.execute("update oportunidades set etapa = 'visita_agendada' where id = %s", (opp_id,))
        ultimo = con.execute(
            """select etapa_anterior, etapa_nueva, cambiado_por from historial_etapas
               where oportunidad_id = %s order by fecha desc limit 1""",
            (opp_id,),
        ).fetchone()
        probabilidad = con.execute("select probabilidad from oportunidades where id = %s", (opp_id,)).fetchone()[0]
    assert ultimo == ("contactado", "visita_agendada", equipo["U02"])
    assert probabilidad == 35


def test_busqueda_ignora_tildes_y_mayusculas(con, equipo):
    # Migración 002: la columna busqueda guarda todo en minúsculas y sin tildes
    with con.transaction(force_rollback=True):
        como(con, equipo["U01"])
        con_tilde = con.execute("select count(*) from contactos where empresa ilike 'Panadería%'").fetchone()[0]
        sin_tilde = con.execute("select count(*) from contactos where busqueda like '%panaderia%'").fetchone()[0]
    assert con_tilde > 0
    assert sin_tilde == con_tilde


def test_panel_solo_para_la_gerente(con, equipo):
    for codigo in ("U02", "U05", "U06"):  # asesor, técnico y contadora
        with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
            como(con, equipo[codigo])
            con.execute("select panel_gerente()")


def test_panel_cuadra_con_los_datos(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U01"])
        panel = con.execute("select panel_gerente()").fetchone()[0]
        ganadas = con.execute("select count(*) from oportunidades where etapa = 'ganado'").fetchone()[0]
        total = con.execute("select count(*) from oportunidades").fetchone()[0]

    embudo = {e["etapa"]: e["ventas"] for e in panel["embudo"]}
    assert embudo["nuevo"] == total  # todas las ventas entran por "nuevo"
    assert embudo["ganado"] == ganadas
    # El embudo nunca crece de una etapa a la siguiente
    orden = ["nuevo", "contactado", "visita_agendada", "cotizado", "negociacion", "ganado"]
    assert all(embudo[a] >= embudo[b] for a, b in zip(orden, orden[1:], strict=False))
    assert len(panel["por_mes"]) == 12
    assert sum(a["ganadas"] for a in panel["asesores"]) == ganadas
    assert panel["kpis"]["pipeline_ponderado"] <= panel["kpis"]["pipeline"]


def test_embudo_cuenta_las_ventas_que_se_saltan_etapas(con, equipo):
    # Una venta nueva que pasa directo a "ganado" debe contar en todas las etapas del embudo
    with con.transaction(force_rollback=True):
        como(con, equipo["U01"])
        antes = {e["etapa"]: e["ventas"] for e in con.execute("select panel_gerente()").fetchone()[0]["embudo"]}
        opp_id = con.execute("select id from oportunidades where etapa = 'nuevo' limit 1").fetchone()[0]
        con.execute("update oportunidades set etapa = 'ganado' where id = %s", (opp_id,))
        despues = {e["etapa"]: e["ventas"] for e in con.execute("select panel_gerente()").fetchone()[0]["embudo"]}

    assert despues["nuevo"] == antes["nuevo"]  # ya estaba contada en "nuevo"
    for etapa in ("contactado", "visita_agendada", "cotizado", "negociacion", "ganado"):
        assert despues[etapa] == antes[etapa] + 1, etapa


def test_no_se_puede_perder_una_venta_sin_motivo(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.CheckViolation):
        como(con, equipo["U01"])
        con.execute("update oportunidades set etapa = 'perdido' where etapa = 'cotizado'")
