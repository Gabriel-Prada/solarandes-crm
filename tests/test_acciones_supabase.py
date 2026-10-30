"""Comprueba en la base de datos real las tres acciones de la fase 5, pieza 3 (migración 024).

registrar_actividad, mover_venta y agendar_visita son la única puerta por la que una app conectada
(Claude, con la llave de la gerente) puede escribir. El CRM también las usa: aquí se prueba que las
reglas de siempre siguen iguales para el CRM y que las de las apps (sin "ganado", sin reabrir,
ventanas de 30 días, repetidos, tope y registro) solo valen para las apps. Ver docs/plan-fase-5.md.

Cada prueba corre dentro de una transacción que al final se deshace: no queda nada guardado.
Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

APP = "app-de-prueba-acciones"
GERENTE, ASESOR, OTRO_ASESOR, TECNICO = "U01", "U02", "U03", "U05"
AHORA = datetime.now(UTC)


@pytest.fixture
def con():
    from conexion import conectar

    with conectar() as conexion:
        with conexion.transaction(force_rollback=True):
            aplicadas = {n for (n,) in conexion.execute("select nombre from control.migraciones")}
            for ruta in sorted((RAIZ / "supabase" / "migraciones").glob("*.sql")):
                if ruta.name >= "009" and ruta.name not in aplicadas:
                    conexion.execute(ruta.read_text(encoding="utf-8"))
            yield conexion


def id_de(con, codigo):
    return con.execute("select id from perfiles where codigo = %s", (codigo,)).fetchone()[0]


def como(con, codigo, app=None):
    """Desde aquí la conexión actúa como esa persona; con app, como una app conectada a su nombre."""
    claims = {"sub": str(id_de(con, codigo)), "role": "authenticated"}
    if app:
        claims["client_id"] = app
    con.execute("reset role")
    con.execute("set local role authenticated")
    con.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))


def como_admin(con):
    con.execute("reset role")
    con.execute("select set_config('request.jwt.claims', '', true)")


def aprobar_app(con):
    como(con, GERENTE)
    con.execute("select aprobar_app(%s, 'Claude', 'claude.ai')", (APP,))


def venta_abierta(con, asesor=ASESOR, etapas=("nuevo", "contactado")):
    """Una venta abierta de ese asesor, cuyo contacto también es suyo."""
    como_admin(con)
    return con.execute(
        """
        select o.id, o.contacto_id, o.codigo, o.etapa from oportunidades o join contactos c on c.id = o.contacto_id
        join perfiles p on p.id = o.asesor_id
        where p.codigo = %s and c.asesor_id = o.asesor_id and o.etapa = any(%s::etapa_oportunidad[])
        order by o.codigo limit 1
        """,
        (asesor, list(etapas)),
    ).fetchone()


def accion(con, sql, *parametros):
    return con.execute(sql, parametros).fetchone()[0]


def registrar(
    con, contacto, tipo="llamada", descripcion="Llamada de prueba de la fase 5", oportunidad=None, fecha=None
):
    return accion(
        con, "select registrar_actividad(%s, %s, %s, %s, %s)", contacto, oportunidad, tipo, descripcion, fecha
    )


def registro_de_apps(con):
    como_admin(con)
    return con.execute(
        "select accion, resultado, client_id, motivo from acciones_de_apps where client_id = %s order by id", (APP,)
    ).fetchall()


# ---------------------------------------------------------------------------
# registrar_actividad
# ---------------------------------------------------------------------------


def test_el_crm_registra_como_antes(con):
    venta, contacto, _, _ = venta_abierta(con)
    como(con, ASESOR)
    r = registrar(con, contacto, oportunidad=venta)
    assert r["estado"] == "hecho"
    como_admin(con)
    usuario, completada = con.execute(
        "select usuario_id, completada from actividades where id = %s", (r["actividad_id"],)
    ).fetchone()
    assert usuario == id_de(con, ASESOR) and completada is True  # quien anota es el responsable; ya ocurrió


def test_las_reglas_de_siempre_valen_para_el_crm(con):
    _, contacto, _, _ = venta_abierta(con)
    otra_venta, _, _, _ = venta_abierta(con, asesor=OTRO_ASESOR)
    como(con, ASESOR)
    assert registrar(con, contacto, tipo="visita")["mensaje"] == "Elige un tipo de actividad."
    assert registrar(con, contacto, descripcion="ok")["mensaje"].startswith("Escribe una descripción")
    assert registrar(con, contacto, oportunidad=otra_venta)["mensaje"] == "Esa venta no pertenece a este contacto."
    assert registrar(con, contacto, tipo="tarea")["mensaje"] == "Elige la fecha y hora de la tarea."


def test_nadie_registra_en_clientes_ajenos_ni_con_otro_rol(con):
    _, contacto, _, _ = venta_abierta(con)
    como(con, OTRO_ASESOR)
    assert registrar(con, contacto) == {"estado": "rechazada", "mensaje": "No se encontró el cliente."}
    como(con, TECNICO)
    assert registrar(con, contacto)["mensaje"] == "Tu rol no registra actividades."


def test_en_el_crm_dos_llamadas_iguales_seguidas_son_normales(con):
    _, contacto, _, _ = venta_abierta(con)
    como(con, ASESOR)
    assert registrar(con, contacto)["estado"] == "hecho"
    assert registrar(con, contacto)["estado"] == "hecho"


def test_una_app_no_aprobada_no_escribe_y_queda_registrada(con):
    _, contacto, _, _ = venta_abierta(con)
    como(con, GERENTE, app=APP)
    r = registrar(con, contacto)
    assert r == {"estado": "rechazada", "mensaje": "Esta aplicación no está aprobada para usar el CRM."}
    assert registro_de_apps(con) == [
        ("registrar_actividad", "rechazada", APP, "Esta aplicación no está aprobada para usar el CRM.")
    ]


def test_una_app_aprobada_registra_a_nombre_de_la_gerente_sin_repetir(con):
    _, contacto, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    primera = registrar(con, contacto)
    assert primera["estado"] == "hecho"
    assert registrar(con, contacto) == {"estado": "ya_estaba", "mensaje": "Esa actividad ya estaba registrada."}
    como_admin(con)
    assert accion(con, "select usuario_id from actividades where id = %s", primera["actividad_id"]) == id_de(
        con, GERENTE
    )
    assert [(a, r) for a, r, _, _ in registro_de_apps(con)] == [
        ("registrar_actividad", "hecho"),
        ("registrar_actividad", "ya_estaba"),
    ]


def test_una_app_solo_agenda_tareas_en_los_proximos_30_dias(con):
    _, contacto, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    mensaje = "La tarea debe ser en los próximos 30 días."
    assert registrar(con, contacto, tipo="tarea", fecha=AHORA - timedelta(hours=1))["mensaje"] == mensaje
    assert registrar(con, contacto, tipo="tarea", fecha=AHORA + timedelta(days=31))["mensaje"] == mensaje
    assert registrar(con, contacto, tipo="tarea", fecha=AHORA + timedelta(days=2))["estado"] == "hecho"


def test_una_app_de_un_asesor_no_escribe(con):
    _, contacto, _, _ = venta_abierta(con)
    como(con, GERENTE)
    con.execute("select aprobar_app(%s, 'Claude', 'claude.ai')", (APP,))
    como(con, ASESOR, app=APP)
    assert registrar(con, contacto)["mensaje"] == "Por ahora solo la gerente puede actuar en el CRM desde Claude."


def test_el_tope_diario_frena_a_las_apps(con):
    _, contacto, _, _ = venta_abierta(con)
    aprobar_app(con)
    como_admin(con)
    con.execute(
        "insert into acciones_de_apps (usuario_id, client_id, accion, resultado)"
        " select %s, 'otra-app', 'registrar_actividad', 'hecho' from generate_series(1, 50)",
        (id_de(con, GERENTE),),
    )
    como(con, GERENTE, app=APP)
    assert registrar(con, contacto)["mensaje"].startswith("Llegaste al máximo de 50 acciones")
    # el CRM no tiene tope
    como(con, GERENTE)
    assert registrar(con, contacto)["estado"] == "hecho"


# ---------------------------------------------------------------------------
# mover_venta
# ---------------------------------------------------------------------------


def mover(con, venta, etapa, motivo=None):
    return accion(con, "select mover_venta(%s, %s, %s)", venta, etapa, motivo)


def test_el_crm_mueve_reabre_y_anota_quien_fue(con):
    venta, _, _, _ = venta_abierta(con)
    como(con, ASESOR)
    assert mover(con, venta, "perdido")["mensaje"] == "Para marcar una venta como perdida hay que indicar el motivo."
    assert mover(con, venta, "perdido", "precio")["estado"] == "hecho"
    assert mover(con, venta, "contactado")["estado"] == "hecho"  # el tablero deja reabrir
    assert mover(con, venta, "ganado")["estado"] == "hecho"
    como_admin(con)
    autores = {
        a
        for (a,) in con.execute(
            "select cambiado_por from historial_etapas where oportunidad_id = %s and fecha >= now()", (venta,)
        )
    }
    assert autores == {id_de(con, ASESOR)}


def test_un_asesor_no_mueve_ventas_ajenas(con):
    venta, _, _, _ = venta_abierta(con)
    como(con, OTRO_ASESOR)
    assert mover(con, venta, "negociacion") == {"estado": "rechazada", "mensaje": "No se encontró la venta."}


def test_una_app_no_marca_ganado_ni_reabre_y_queda_el_rastro(con):
    venta, _, codigo, etapa = venta_abierta(con, asesor=ASESOR)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    assert mover(con, venta, "ganado")["mensaje"].startswith("Marcar una venta como ganada se hace en el tablero")
    assert mover(con, venta, "perdido", "aplazo")["estado"] == "hecho"
    assert mover(con, venta, "contactado")["mensaje"].startswith("La venta ya está cerrada")
    como_admin(con)
    assert accion(con, "select etapa::text from oportunidades where id = %s", venta) == "perdido"
    assert [(a, r) for a, r, _, _ in registro_de_apps(con)] == [
        ("mover_venta", "rechazada"),
        ("mover_venta", "hecho"),
        ("mover_venta", "rechazada"),
    ]
    assert etapa in ("nuevo", "contactado") and codigo


def test_una_app_mueve_a_nombre_de_la_gerente(con):
    venta, _, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    assert mover(con, venta, "negociacion")["estado"] == "hecho"
    assert mover(con, venta, "negociacion")["estado"] == "ya_estaba"
    como_admin(con)
    autor = accion(
        con,
        "select cambiado_por from historial_etapas where oportunidad_id = %s and etapa_nueva = 'negociacion'",
        venta,
    )
    assert autor == id_de(con, GERENTE)


# ---------------------------------------------------------------------------
# agendar_visita
# ---------------------------------------------------------------------------


def agendar(con, venta, fecha, nota=None):
    return accion(con, "select agendar_visita(%s, %s, %s)", venta, fecha, nota)


def test_el_crm_agenda_como_antes(con):
    venta, _, _, _ = venta_abierta(con, etapas=("nuevo", "contactado"))
    como(con, ASESOR)
    assert agendar(con, venta, AHORA - timedelta(hours=1))["mensaje"] == "La visita debe ser en el futuro."
    assert agendar(con, venta, None)["mensaje"] == "Elige la fecha y hora de la visita."
    r = agendar(con, venta, AHORA + timedelta(days=45), "x" * 400)  # el CRM no tiene ventana de 30 días
    assert r["estado"] == "hecho"
    como_admin(con)
    tecnico, descripcion = con.execute(
        "select usuario_id, descripcion from actividades where id = %s", (r["actividad_id"],)
    ).fetchone()
    assert tecnico == id_de(con, TECNICO) and len(descripcion) == 300
    assert accion(con, "select etapa::text from oportunidades where id = %s", venta) == "visita_agendada"


def test_la_nota_por_omision_y_la_venta_cerrada(con):
    venta, _, _, _ = venta_abierta(con)
    como(con, GERENTE)
    r = agendar(con, venta, AHORA + timedelta(days=3))
    como_admin(con)
    assert accion(con, "select descripcion from actividades where id = %s", r["actividad_id"]).startswith(
        "Visita técnica"
    )
    como(con, GERENTE)
    mover(con, venta, "perdido", "precio")
    assert agendar(con, venta, AHORA + timedelta(days=3))["mensaje"] == "La venta ya está cerrada."


def test_una_app_agenda_en_30_dias_sin_repetir(con):
    venta, _, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    cuando = (AHORA + timedelta(days=2)).replace(microsecond=0)
    assert agendar(con, venta, AHORA + timedelta(days=31))["mensaje"] == "La visita debe ser en los próximos 30 días."
    assert agendar(con, venta, cuando)["estado"] == "hecho"
    assert agendar(con, venta, cuando) == {"estado": "ya_estaba", "mensaje": "Esa visita ya estaba agendada."}


def test_un_asesor_no_agenda_en_ventas_ajenas(con):
    venta, _, _, _ = venta_abierta(con)
    como(con, OTRO_ASESOR)
    assert agendar(con, venta, AHORA + timedelta(days=2))["mensaje"] == "No se encontró la venta."


# ---------------------------------------------------------------------------
# Las tres puertas y el registro
# ---------------------------------------------------------------------------


def test_las_tres_puertas_rechazan_a_una_app_no_aprobada(con):
    venta, contacto, _, _ = venta_abierta(con)
    como(con, GERENTE, app="app-sin-aprobar")
    for r in (
        registrar(con, contacto),
        mover(con, venta, "negociacion"),
        agendar(con, venta, AHORA + timedelta(days=2)),
    ):
        assert r == {"estado": "rechazada", "mensaje": "Esta aplicación no está aprobada para usar el CRM."}


def test_nadie_escribe_el_registro_a_mano_y_solo_la_gerente_lo_lee(con):
    como(con, GERENTE)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with con.transaction():
            con.execute(
                "insert into acciones_de_apps (usuario_id, client_id, accion, resultado)"
                " values (auth.uid(), 'x', 'mover_venta', 'hecho')"
            )
    venta, contacto, _, _ = venta_abierta(con)
    como(con, GERENTE, app="app-sin-aprobar")
    registrar(con, contacto)
    como(con, ASESOR)
    assert accion(con, "select count(*) from acciones_de_apps") == 0
    como(con, GERENTE)
    assert accion(con, "select count(*) from acciones_de_apps") >= 1
    assert venta


def test_las_piezas_internas_no_se_pueden_llamar(con):
    for funcion in [
        "puerta_de_app()",
        "anotar_accion_de_app(text, text, text, text)",
        "resultado_de_accion(text, text, text, text, jsonb)",
        "tope_acciones_de_apps_dia()",
        "tope_rechazos_anotados_dia()",
        "inicio_del_dia_bogota()",
        "sin_bordes(text)",
    ]:
        assert accion(con, "select has_function_privilege('authenticated', %s, 'EXECUTE')", funcion) is False, funcion


# ---------------------------------------------------------------------------
# Ajustes de la revisión del código
# ---------------------------------------------------------------------------


def test_agendar_no_le_cambia_la_etapa_a_una_venta_mas_avanzada(con):
    venta, _, _, _ = venta_abierta(con, etapas=("cotizado", "negociacion"))
    como_admin(con)
    antes = accion(con, "select etapa::text from oportunidades where id = %s", venta)
    como(con, ASESOR)
    assert agendar(con, venta, AHORA + timedelta(days=3))["estado"] == "hecho"
    como_admin(con)
    assert accion(con, "select etapa::text from oportunidades where id = %s", venta) == antes


def test_sin_tecnico_activo_no_se_agenda(con):
    venta, _, _, _ = venta_abierta(con)
    como_admin(con)
    con.execute("update perfiles set activo = false where rol = 'tecnico'")
    como(con, GERENTE)
    assert (
        agendar(con, venta, AHORA + timedelta(days=3))["mensaje"] == "No hay un técnico activo para asignar la visita."
    )


def test_una_persona_inactiva_no_hace_nada(con):
    venta, contacto, _, _ = venta_abierta(con)
    como_admin(con)
    con.execute("update perfiles set activo = false where codigo = %s", (ASESOR,))
    como(con, ASESOR)
    assert registrar(con, contacto)["mensaje"] == "Tu rol no registra actividades."
    assert mover(con, venta, "negociacion")["mensaje"] == "Tu rol no mueve ventas."
    assert agendar(con, venta, AHORA + timedelta(days=3))["mensaje"] == "Tu rol no agenda visitas."


def test_una_app_no_agenda_en_ventas_cerradas_ni_pierde_sin_motivo(con):
    venta, _, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    assert mover(con, venta, "perdido")["mensaje"] == "Para marcar una venta como perdida hay que indicar el motivo."
    assert mover(con, venta, "perdido", "competencia")["estado"] == "hecho"
    assert agendar(con, venta, AHORA + timedelta(days=3))["mensaje"] == "La venta ya está cerrada."


def test_un_valor_inventado_se_rechaza_y_queda_en_el_registro(con):
    venta, contacto, _, _ = venta_abierta(con)
    aprobar_app(con)
    como(con, GERENTE, app=APP)
    assert mover(con, venta, "perdido", "inventado")["mensaje"] == "Etapa o motivo no válido."
    assert mover(con, venta, "ganada")["mensaje"] == "Etapa o motivo no válido."
    assert registrar(con, contacto, tipo="reunion")["mensaje"] == "Elige un tipo de actividad."
    assert [r for _, r, _, _ in registro_de_apps(con)] == ["rechazada", "rechazada", "rechazada"]


def test_una_descripcion_de_solo_saltos_de_linea_no_vale(con):
    _, contacto, _, _ = venta_abierta(con)
    como(con, GERENTE)
    assert registrar(con, contacto, descripcion="\n\n\n\t ")["mensaje"].startswith("Escribe una descripción")


def test_no_se_anota_en_la_venta_de_otro_asesor(con):
    venta, contacto, _, _ = venta_abierta(con)
    otro = id_de(con, OTRO_ASESOR)
    como_admin(con)
    con.execute("update oportunidades set asesor_id = %s where id = %s", (otro, venta))  # venta reasignada
    como(con, ASESOR)
    assert registrar(con, contacto, oportunidad=venta)["mensaje"] == "Esa venta no pertenece a este contacto."


def test_los_rechazos_no_gastan_el_cupo_del_dia(con):
    _, contacto, _, _ = venta_abierta(con)
    aprobar_app(con)
    como_admin(con)
    con.execute(
        "insert into acciones_de_apps (usuario_id, client_id, accion, resultado)"
        " select %s, 'otra-app', 'registrar_actividad', 'rechazada' from generate_series(1, 60)",
        (id_de(con, GERENTE),),
    )
    como(con, GERENTE, app=APP)
    assert registrar(con, contacto)["estado"] == "hecho"


def test_cada_funcion_de_lista_blanca_solo_deja_pasar_a_la_app_aprobada_de_la_gerente(con):
    """La prueba por categoría: recorre las funciones marcadas "lista blanca" en la prueba de la 023."""
    from test_conexiones_externas_supabase import FUNCIONES_CON_PERMISO_PROPIO

    venta, contacto, _, _ = venta_abierta(con)
    llamadas = {
        "registrar_actividad": lambda: registrar(con, contacto, descripcion="Prueba por categoría"),
        "mover_venta": lambda: mover(con, venta, "negociacion"),
        "agendar_visita": lambda: agendar(con, venta, AHORA + timedelta(days=4)),
    }
    lista_blanca = {n for n, c in FUNCIONES_CON_PERMISO_PROPIO.items() if c == "lista blanca"}
    assert lista_blanca == set(llamadas), "Agrega aquí cómo se llama cada función nueva de lista blanca"
    for nombre in sorted(lista_blanca):
        como(con, GERENTE, app="app-sin-aprobar-categoria")
        assert llamadas[nombre]()["estado"] == "rechazada", nombre
    aprobar_app(con)
    for nombre in sorted(lista_blanca):
        como(con, ASESOR, app=APP)
        assert llamadas[nombre]()["estado"] == "rechazada", nombre
        como(con, GERENTE, app=APP)
        assert llamadas[nombre]()["estado"] == "hecho", nombre
    assert {a for a, r, _, _ in registro_de_apps(con) if r == "hecho"} == lista_blanca
