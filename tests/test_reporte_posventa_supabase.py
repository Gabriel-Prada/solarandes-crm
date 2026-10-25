"""Comprueba en la base de datos real el reporte semanal y la posventa (migraciones 018 y 019, flujos 5 y 6).

También la corrección de la fecha de cierre. El diseño, con lo que puede fallar, está en
docs/plan-fase-3.md, sección 4d. Cada prueba corre dentro de una transacción que al final se deshace.

Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
from datetime import date

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

MIGRACIONES = [
    "016_seguimiento.sql",
    "017_ajustes_del_seguimiento.sql",
    "018_reporte_y_posventa.sql",
    "019_posventa_solo_ventas_ganadas.sql",
]
CELULARES = [f"+57300998{n:04d}" for n in range(1, 9)]
LUNES = date(2026, 10, 19)  # un lunes con datos: el reporte resume la semana del 12 al 18 de octubre


@pytest.fixture
def con():
    from conexion import conectar

    with conectar() as conexion:
        with conexion.transaction(force_rollback=True):
            aplicadas = {n for (n,) in conexion.execute("select nombre from control.migraciones")}
            for nombre in MIGRACIONES:
                if nombre not in aplicadas:
                    conexion.execute((RAIZ / "supabase" / "migraciones" / nombre).read_text(encoding="utf-8"))
            usados = conexion.execute(
                "select count(*) from contactos where telefono = any(%s)", (CELULARES,)
            ).fetchone()
            assert usados[0] == 0, "algún celular de la prueba ya existe en el CRM: cámbialo"
            # Cada prueba empieza sin reportes ni avisos de posventa (se deshace al final)
            conexion.execute("delete from reportes_semanales")
            conexion.execute("delete from avisos_posventa")
            yield conexion


@pytest.fixture
def equipo(con):
    return dict(con.execute("select codigo, id from perfiles").fetchall())


def uno(con, consulta, *parametros):
    return con.execute(consulta, parametros).fetchone()[0]


def como_servicio(con, consulta, *parametros):
    con.execute("set local role service_role")
    try:
        return uno(con, consulta, *parametros)
    finally:
        con.execute("reset role")


def contacto(con, asesor_id, n=0, email="cliente@ejemplo.test", empresa=None):
    return uno(
        con,
        """insert into contactos (tipo, nombre, empresa, telefono, email, ciudad, canal_origen, asesor_id)
           values (%s, 'Prueba Posventa', %s, %s, %s, 'Bogotá', 'web', %s) returning id""",
        "negocio" if empresa else "hogar",
        empresa,
        CELULARES[n],
        email,
        asesor_id,
    )


def venta(con, contacto_id, asesor_id, etapa="nuevo", creada=None, cierre=None, tipo="nueva", valor=10_000_000):
    """Una venta. creada y cierre son textos con hora de Bogotá, por ejemplo '2026-04-20 10:00'."""
    return uno(
        con,
        """insert into oportunidades (contacto_id, asesor_id, nombre, etapa, tipo, valor_cop, creada_en, fecha_cierre,
             motivo_perdida)
           values (%s, %s, 'Venta de prueba', %s, %s, %s,
             coalesce(%s::timestamp at time zone 'America/Bogota', now()),
             %s::timestamp at time zone 'America/Bogota',
             case when %s = 'perdido' then 'precio'::motivo_perdida end)
           returning id""",
        contacto_id,
        asesor_id,
        etapa,
        tipo,
        valor,
        creada,
        cierre,
        etapa,
    )


# ---------------------------------------------------------------------------
# La fecha de cierre
# ---------------------------------------------------------------------------


def test_una_venta_que_pasa_de_perdida_a_ganada_se_cierra_hoy(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], etapa="perdido", creada="2026-03-01 10:00", cierre="2026-03-10 10:00")
    con.execute("update oportunidades set etapa = 'ganado', motivo_perdida = null where id = %s", (v,))
    assert uno(con, "select fecha_cierre = now() from oportunidades where id = %s", v)
    # Y de ganada a perdida, igual
    con.execute("update oportunidades set fecha_cierre = now() - interval '5 days' where id = %s", (v,))
    con.execute("update oportunidades set etapa = 'perdido', motivo_perdida = 'precio' where id = %s", (v,))
    assert uno(con, "select fecha_cierre = now() from oportunidades where id = %s", v)


def test_reabrir_una_venta_le_quita_la_fecha_de_cierre(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-03-10 10:00")
    con.execute("update oportunidades set etapa = 'negociacion' where id = %s", (v,))
    assert uno(con, "select fecha_cierre from oportunidades where id = %s", v) is None


# ---------------------------------------------------------------------------
# El reporte semanal
# ---------------------------------------------------------------------------


def tomar_reporte(con, ejecucion, hoy=LUNES):
    return como_servicio(con, "select tomar_reporte_semanal(%s, %s)", ejecucion, hoy)


def test_el_reporte_resume_la_semana_que_acaba_de_terminar(con, equipo):
    antes = como_servicio(con, "select movimiento_de_semana(%s)", date(2026, 10, 12))
    c = contacto(con, equipo["U02"])
    # Domingo 18 a las 11 p. m. en Bogotá (ya es lunes en UTC): cuenta en la semana del 12
    venta(con, c, equipo["U02"], creada="2026-10-18 23:00")
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-09-01 10:00", cierre="2026-10-14 10:00", valor=20_000_000)
    venta(
        con,
        c,
        equipo["U02"],
        etapa="ganado",
        creada="2026-09-01 10:00",
        cierre="2026-10-15 10:00",
        tipo="ampliacion",
        valor=None,
    )
    venta(con, c, equipo["U02"], etapa="perdido", creada="2026-09-01 10:00", cierre="2026-10-16 10:00")
    # El lunes 19 a las 12:30 a. m. ya es la semana siguiente
    venta(con, c, equipo["U02"], creada="2026-10-19 00:30")

    r = tomar_reporte(con, "prueba-1")["reporte"]
    assert r["lunes"] == "2026-10-12" and r["llega_tarde"] is False
    mov = como_servicio(con, "select movimiento_de_semana(%s)", date(2026, 10, 12))
    assert mov["leads"] == antes["leads"] + 1
    assert mov["ganadas"] == antes["ganadas"] + 2
    assert mov["valor_ganado"] == antes["valor_ganado"] + 20_000_000
    assert mov["ampliaciones"] == antes["ampliaciones"] + 1
    assert mov["ganadas_sin_valor"] == antes["ganadas_sin_valor"] + 1
    assert mov["perdidas"] == antes["perdidas"] + 1
    assert mov["motivos"]["precio"] == antes["motivos"].get("precio", 0) + 1
    assert mov["leads_por_canal"]["web"] == antes["leads_por_canal"].get("web", 0) + 1
    assert mov["por_asesor"]["Andrés Rojas"]["leads"] == antes["por_asesor"]["Andrés Rojas"]["leads"] + 1


def test_el_reporte_trae_la_semana_anterior_y_la_foto_de_hoy(con, equipo):
    r = tomar_reporte(con, "prueba-1")["reporte"]
    assert r["destinatario"]["nombre"] == "Laura Méndez"
    assert set(r) >= {"lunes", "semana", "anterior", "foto", "foto_anterior", "llega_tarde", "destinatario"}
    assert r["anterior"] == como_servicio(con, "select movimiento_de_semana(%s)", date(2026, 10, 5))
    assert r["foto_anterior"] is None  # no hay reporte de la semana anterior
    # Sin nombres de clientes: solo cifras y nombres del equipo
    assert "Prueba" not in json.dumps(r) and "+573" not in json.dumps(r)


def test_la_foto_cuadra_con_el_panel(con, equipo):
    foto = como_servicio(con, "select foto_del_negocio()")
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(equipo["U01"]), "role": "authenticated"}),),
    )
    kpis = uno(con, "select panel_gerente()")["kpis"]
    con.execute("reset role")
    assert (foto["abiertas"], foto["pipeline"], foto["pipeline_ponderado"], foto["sin_seguimiento"]) == (
        kpis["abiertas"],
        kpis["pipeline"],
        kpis["pipeline_ponderado"],
        kpis["sin_seguimiento"],
    )


def test_el_reporte_sale_una_sola_vez(con, equipo):
    assert tomar_reporte(con, "prueba-1")["reporte"]
    assert tomar_reporte(con, "prueba-2")["reporte"] is None  # otra ejecución: ya está reservado
    assert tomar_reporte(con, "prueba-1")["reporte"]  # la misma: es suyo
    assert como_servicio(con, "select confirmar_reporte(%s, 'prueba-2')", date(2026, 10, 12)) is False
    assert como_servicio(con, "select confirmar_reporte(%s, 'prueba-1')", date(2026, 10, 12)) is True
    assert tomar_reporte(con, "prueba-3", date(2026, 10, 21))["reporte"] is None  # el miércoles ya salió


def test_un_reporte_que_fallo_o_quedo_abandonado_lo_toma_la_siguiente(con, equipo):
    tomar_reporte(con, "prueba-1")
    assert como_servicio(con, "select soltar_reporte(%s, 'prueba-1')", date(2026, 10, 12)) is True
    assert tomar_reporte(con, "prueba-2")["reporte"]
    con.execute("update reportes_semanales set reservado_en = now() - interval '31 minutes'")
    assert tomar_reporte(con, "prueba-3")["reporte"]


def test_si_sale_despues_del_lunes_dice_que_llega_tarde(con, equipo):
    r = tomar_reporte(con, "prueba-1", date(2026, 10, 22))["reporte"]
    assert r["lunes"] == "2026-10-12" and r["llega_tarde"] is True


def test_el_fin_de_semana_no_sale(con, equipo):
    for dia in (date(2026, 10, 24), date(2026, 10, 25)):
        r = tomar_reporte(con, "prueba-1", dia)
        assert r["reporte"] is None and r["sin_gerente"] is False


def test_sin_gerente_activa_se_informa(con, equipo):
    con.execute("update perfiles set activo = false where rol = 'gerente'")
    assert tomar_reporte(con, "prueba-1") == {"reporte": None, "sin_gerente": True}


def test_la_foto_se_compara_con_la_del_reporte_anterior(con, equipo):
    tomar_reporte(con, "prueba-1")
    como_servicio(con, "select confirmar_reporte(%s, 'prueba-1')", date(2026, 10, 12))
    guardada = uno(con, "select cifras->'foto' from reportes_semanales where semana = %s", date(2026, 10, 12))
    r = tomar_reporte(con, "prueba-2", date(2026, 10, 26))["reporte"]
    assert r["lunes"] == "2026-10-19" and r["foto_anterior"] == guardada


# ---------------------------------------------------------------------------
# La posventa
# ---------------------------------------------------------------------------


def tomar_posventa(con, ejecucion, hoy):
    return como_servicio(con, "select tomar_posventa(%s, %s)", ejecucion, hoy)


def avisos_de(con, contacto_id):
    return con.execute(
        "select aniversario, meses, tarea_id, correo from avisos_posventa where contacto_id = %s order by aniversario",
        (contacto_id,),
    ).fetchall()


def test_a_los_6_meses_hay_tarea_para_el_asesor_y_correo_para_el_cliente(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    r = tomar_posventa(con, "prueba-1", date(2026, 10, 24))

    [(aniversario, meses, tarea, correo)] = avisos_de(con, c)
    assert (aniversario, meses) == (date(2026, 10, 20), 6)
    descripcion, usuario, oportunidad, completada = con.execute(
        "select descripcion, usuario_id, oportunidad_id, completada from actividades where id = %s", (tarea,)
    ).fetchone()
    assert "mantenimiento de los 6 meses" in descripcion
    assert (usuario, oportunidad, completada) == (equipo["U02"], None, False)  # sin venta: la vigila el flujo 3
    mio = [x for x in r["correos"] if x["para"] == "cliente@ejemplo.test"]
    assert mio and mio[0]["responsable"] == "Andrés Rojas" and mio[0]["meses"] == 6


def test_el_mismo_aniversario_no_se_avisa_dos_veces(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    segunda = tomar_posventa(con, "prueba-2", date(2026, 10, 24))
    assert len(avisos_de(con, c)) == 1
    assert uno(con, "select count(*) from actividades where contacto_id = %s and tipo = 'tarea'", c) == 1
    assert not [x for x in segunda["correos"] if x["para"] == "cliente@ejemplo.test"]  # el correo es de prueba-1


def test_los_aniversarios_viejos_no_se_avisan(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-01-01 10:00", cierre="2026-03-01 10:00")
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))  # el de los 6 meses fue el 1 de septiembre
    assert avisos_de(con, c) == []


def test_cada_6_meses_y_el_31_de_agosto_pasa_al_28_de_febrero(con, equipo):
    c = contacto(con, equipo["U02"])
    # 31 de agosto a las 8 p. m. en Bogotá (ya es 1 de septiembre en UTC)
    venta(con, c, equipo["U02"], etapa="ganado", creada="2025-08-01 10:00", cierre="2025-08-31 20:00")
    tomar_posventa(con, "prueba-1", date(2026, 3, 1))
    tomar_posventa(con, "prueba-2", date(2026, 8, 31))
    assert [(a, m) for a, m, _, _ in avisos_de(con, c)] == [(date(2026, 2, 28), 6), (date(2026, 8, 31), 12)]


def test_una_ampliacion_no_abre_otra_cadena_de_avisos(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    venta(
        con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-07-10 10:00", tipo="ampliacion"
    )
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    tomar_posventa(con, "prueba-2", date(2027, 1, 12))  # 6 meses de la ampliación: no
    assert [a for a, _, _, _ in avisos_de(con, c)] == [date(2026, 10, 20)]


def test_una_venta_que_ya_no_esta_ganada_no_se_recuerda(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    con.execute("update oportunidades set etapa = 'negociacion' where id = %s", (v,))
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    assert avisos_de(con, c) == []


def test_sin_correo_del_cliente_igual_hay_tarea(con, equipo):
    c = contacto(con, equipo["U02"], email=None)
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    [(_, _, tarea, correo)] = avisos_de(con, c)
    assert tarea is not None and correo is None


def test_si_el_asesor_no_esta_la_tarea_va_a_la_gerente(con, equipo):
    c = contacto(con, equipo["U04"])
    venta(con, c, equipo["U04"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    con.execute("update perfiles set activo = false where id = %s", (equipo["U04"],))
    r = tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    [(_, _, tarea, correo)] = avisos_de(con, c)
    assert uno(con, "select usuario_id from actividades where id = %s", tarea) == equipo["U01"]
    assert correo["responsable"] == "Laura Méndez" and r["sin_gerente"] is False


def test_sin_gerente_activa_se_informa_y_se_reintenta(con, equipo):
    c = contacto(con, equipo["U04"])
    venta(con, c, equipo["U04"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    con.execute("update perfiles set activo = false where id = %s or rol = 'gerente'", (equipo["U04"],))
    assert tomar_posventa(con, "prueba-1", date(2026, 10, 24))["sin_gerente"] is True
    assert avisos_de(con, c) == []


def test_confirmar_borra_el_correo_y_soltar_lo_deja_para_la_siguiente(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    [mio] = [
        x for x in tomar_posventa(con, "prueba-1", date(2026, 10, 24))["correos"] if x["para"] == "cliente@ejemplo.test"
    ]
    assert como_servicio(con, "select soltar_posventa(%s, 'prueba-1')", mio["id"]) is True
    [otra] = [x for x in tomar_posventa(con, "prueba-2", date(2026, 10, 24))["correos"] if x["id"] == mio["id"]]
    assert como_servicio(con, "select confirmar_posventa(%s, 'prueba-1')", otra["id"]) is False
    assert como_servicio(con, "select confirmar_posventa(%s, 'prueba-2')", otra["id"]) is True
    assert uno(con, "select correo from avisos_posventa where id = %s", mio["id"]) is None


def test_un_correo_que_no_sale_en_7_dias_se_vence(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    con.execute("update avisos_posventa set creado_en = now() - interval '8 days' where contacto_id = %s", (c,))
    r = tomar_posventa(con, "prueba-2", date(2026, 10, 24))
    assert r["vencidos"] >= 1
    assert uno(con, "select correo is null and vencido_en is not null from avisos_posventa where contacto_id = %s", c)


def test_la_tarea_de_posventa_vencida_entra_al_seguimiento(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    tomar_posventa(con, "prueba-1", date(2026, 10, 24))
    tarea = uno(con, "select tarea_id from avisos_posventa where contacto_id = %s", c)
    con.execute("update actividades set fecha = now() - interval '4 days' where id = %s", (tarea,))
    con.execute("delete from avisos_seguimiento")
    con.execute("delete from resumenes_seguimiento")
    resumenes = como_servicio(con, "select tomar_resumenes_seguimiento('prueba-seguimiento')")["resumenes"]
    andres = next(x for x in resumenes if x["destinatario"]["nombre"] == "Andrés Rojas")
    assert str(tarea) in {i["actividad_id"] for i in andres["items"]}


def test_solo_la_llave_de_servicio_toma_reportes_y_posventa(con):
    for rol in ("anon", "authenticated"):
        for consulta in ("select tomar_reporte_semanal('x')", "select tomar_posventa('x')"):
            with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
                con.execute(f"set local role {rol}")
                con.execute(consulta)


def test_un_recordatorio_pendiente_no_sale_si_la_venta_ya_no_esta_ganada(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], etapa="ganado", creada="2026-03-01 10:00", cierre="2026-04-20 10:00")
    [mio] = [
        x for x in tomar_posventa(con, "prueba-1", date(2026, 10, 24))["correos"] if x["para"] == "cliente@ejemplo.test"
    ]
    como_servicio(con, "select soltar_posventa(%s, 'prueba-1')", mio["id"])  # Gmail falló
    con.execute("update oportunidades set etapa = 'negociacion' where id = %s", (v,))  # el cliente canceló
    r = tomar_posventa(con, "prueba-2", date(2026, 10, 24))
    assert not [x for x in r["correos"] if x["id"] == mio["id"]]
    assert uno(con, "select correo is null and vencido_en is not null from avisos_posventa where id = %s", mio["id"])
