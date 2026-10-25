"""Comprueba en la base de datos real el seguimiento de ventas (migraciones 016 y 017, flujo 3 de la fase 3).

La regla única de "días sin actividad" (la vista seguimiento_ventas), el registro de qué se avisó y la
reserva de los resúmenes de cada día. El diseño, con lo que puede fallar, está en docs/plan-fase-3.md,
sección 4c. Cada prueba corre dentro de una transacción que al final se deshace, salvo la de dos
ejecuciones simultáneas, que necesita guardar de verdad y borra lo suyo al terminar.

Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
import threading

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

MIGRACIONES = ["016_seguimiento.sql", "017_ajustes_del_seguimiento.sql"]
CELULARES = [f"+57300999{n:04d}" for n in range(1, 9)]


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
            # Cada prueba empieza sin resúmenes ni avisos: si el flujo ya mandó los de hoy, cada persona
            # no recibiría otro. Se deshace al final, como todo lo de la prueba
            conexion.execute("delete from avisos_seguimiento")
            conexion.execute("delete from resumenes_seguimiento")
            yield conexion


@pytest.fixture
def equipo(con):
    return dict(con.execute("select codigo, id from perfiles").fetchall())


def uno(con, consulta, *parametros):
    return con.execute(consulta, parametros).fetchone()[0]


def contacto(con, asesor_id, n=0):
    return uno(
        con,
        """insert into contactos (tipo, nombre, telefono, ciudad, canal_origen, asesor_id)
           values ('hogar', 'Prueba Seguimiento', %s, 'Bogotá', 'web', %s) returning id""",
        CELULARES[n],
        asesor_id,
    )


def venta(con, contacto_id, asesor_id, hace_dias):
    """Una venta abierta creada hace tantos días, sin ninguna actividad."""
    return uno(
        con,
        """insert into oportunidades (contacto_id, asesor_id, nombre, creada_en)
           values (%s, %s, 'Venta de prueba', now() - make_interval(days => %s)) returning id""",
        contacto_id,
        asesor_id,
        hace_dias,
    )


def actividad(con, contacto_id, usuario_id, tipo, en_dias, completada, venta_id=None):
    """Una actividad con fecha de hoy + en_dias (negativo: en el pasado)."""
    return uno(
        con,
        """insert into actividades (contacto_id, oportunidad_id, usuario_id, tipo, descripcion, fecha, completada)
           values (%s, %s, %s, %s, 'Actividad de prueba', now() + make_interval(days => %s), %s) returning id""",
        contacto_id,
        venta_id,
        usuario_id,
        tipo,
        en_dias,
        completada,
    )


def seguimiento(con, venta_id):
    return con.execute("select dias, nivel from seguimiento_ventas where oportunidad_id = %s", (venta_id,)).fetchone()


def como_servicio(con, consulta, *parametros):
    """Corre la consulta con el rol de la llave de servicio (como lo hará la ventanilla del CRM)."""
    con.execute("set local role service_role")
    try:
        return uno(con, consulta, *parametros)
    finally:
        con.execute("reset role")


def tomar(con, ejecucion):
    return como_servicio(con, "select tomar_resumenes_seguimiento(%s)", ejecucion)["resumenes"]


def de(resumenes, nombre):
    return next(x for x in resumenes if x["destinatario"]["nombre"] == nombre)


def items(resumenes, nombre, ventas):
    """Las ventas de la prueba (por id) que trae el resumen de esa persona, con su nivel."""
    de = [r for r in resumenes if r["destinatario"]["nombre"] == nombre]
    return {(i["oportunidad_id"], i["nivel"]) for r in de for i in r["items"] if i["oportunidad_id"] in ventas}


def confirmar_todos(con, resumenes, ejecucion):
    for r in resumenes:
        assert como_servicio(con, "select confirmar_resumen(%s, %s)", r["id"], ejecucion) is True


def pasar_al_dia_siguiente(con):
    con.execute("update resumenes_seguimiento set dia = dia - 1")


# ---------------------------------------------------------------------------
# Cuándo se completó cada actividad
# ---------------------------------------------------------------------------


def test_completada_en_dice_cuando_se_hizo(con, equipo):
    c = contacto(con, equipo["U02"])
    ahora = uno(con, "select now()")
    # Una nota vieja anotada ya hecha (como las de la migración del Excel): cuenta su propia fecha
    vieja = actividad(con, c, equipo["U02"], "nota", -100, True)
    assert uno(con, "select completada_en = fecha from actividades where id = %s", vieja)
    # Algo anotado como hecho con fecha futura: nunca cuenta en el futuro
    futura = actividad(con, c, equipo["U02"], "llamada", 5, True)
    assert uno(con, "select completada_en from actividades where id = %s", futura) == ahora
    # Una tarea pendiente no tiene fecha de completada; al marcarla hecha, es ahora; al desmarcarla, vacía
    tarea = actividad(con, c, equipo["U02"], "tarea", -5, False)
    assert uno(con, "select completada_en from actividades where id = %s", tarea) is None
    con.execute("update actividades set completada = true where id = %s", (tarea,))
    assert uno(con, "select completada_en from actividades where id = %s", tarea) == ahora
    con.execute("update actividades set completada = false where id = %s", (tarea,))
    assert uno(con, "select completada_en from actividades where id = %s", tarea) is None


# ---------------------------------------------------------------------------
# La regla única: días sin actividad
# ---------------------------------------------------------------------------


def test_una_venta_sin_actividad_cuenta_desde_que_se_creo(con, equipo):
    c = contacto(con, equipo["U02"])
    assert seguimiento(con, venta(con, c, equipo["U02"], 2)) == (2, "al_dia")
    assert seguimiento(con, venta(con, c, equipo["U02"], 3)) == (3, "sin_seguimiento")
    assert seguimiento(con, venta(con, c, equipo["U02"], 7)) == (7, "aviso_gerente")


def test_la_venta_nueva_de_un_cliente_antiguo_no_nace_vieja(con, equipo):
    c = contacto(con, equipo["U02"])
    actividad(con, c, equipo["U02"], "nota", -300, True)  # una nota del contacto de hace casi un año
    assert seguimiento(con, venta(con, c, equipo["U02"], 0)) == (0, "al_dia")


def test_cuenta_la_actividad_del_contacto_sin_venta_elegida(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 10)
    actividad(con, c, equipo["U02"], "llamada", -1, True)  # anotada en el contacto, sin elegir la venta
    assert seguimiento(con, v) == (1, "al_dia")
    # Lo de otra venta del mismo contacto no cuenta para esta
    otra = venta(con, c, equipo["U02"], 10)
    actividad(con, c, equipo["U02"], "llamada", 0, True, venta_id=otra)
    assert seguimiento(con, v) == (1, "al_dia")


def test_una_tarea_completada_hoy_cuenta_hoy(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 10)
    tarea = actividad(con, c, equipo["U02"], "tarea", -5, False, venta_id=v)
    assert seguimiento(con, v) == (10, "aviso_gerente")  # pendiente: no cuenta
    con.execute("update actividades set completada = true where id = %s", (tarea,))
    assert seguimiento(con, v) == (0, "al_dia")


def test_las_visitas_agendadas(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 10)
    lejana = actividad(con, c, equipo["U05"], "visita", 40, False, venta_id=v)
    assert seguimiento(con, v) == (10, "aviso_gerente")  # a más de 30 días no esconde la venta
    con.execute("delete from actividades where id = %s", (lejana,))
    proxima = actividad(con, c, equipo["U05"], "visita", 5, False, venta_id=v)
    assert seguimiento(con, v) == (0, "al_dia")  # la venta espera su visita
    # La visita pasó hace 4 días y nadie la marcó: cuenta su fecha
    con.execute("update actividades set fecha = now() - interval '4 days' where id = %s", (proxima,))
    assert seguimiento(con, v) == (4, "sin_seguimiento")


def test_el_panel_usa_la_misma_regla(con, equipo):
    siete = uno(con, "select count(*) from seguimiento_ventas where dias >= 7")
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(equipo["U01"]), "role": "authenticated"}),),
    )
    panel = uno(con, "select panel_gerente()")
    con.execute("reset role")
    assert panel["kpis"]["sin_seguimiento"] == siete


def test_cada_asesor_ve_solo_sus_ventas_en_la_vista(con, equipo):
    suyas = uno(con, "select count(*) from seguimiento_ventas where asesor_id = %s", equipo["U02"])
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(equipo["U02"]), "role": "authenticated"}),),
    )
    vistas = con.execute(
        "select count(*), count(*) filter (where asesor_id <> %s) from seguimiento_ventas", (equipo["U02"],)
    ).fetchone()
    con.execute("reset role")
    assert vistas == (suyas, 0)


# ---------------------------------------------------------------------------
# Los resúmenes de cada día
# ---------------------------------------------------------------------------


def test_el_asesor_recibe_las_de_3_dias_y_la_gerente_las_de_7(con, equipo):
    c = contacto(con, equipo["U02"])
    tres, siete = venta(con, c, equipo["U02"], 4), venta(con, c, equipo["U02"], 8)
    al_dia = venta(con, c, equipo["U02"], 1)
    ventas = {str(tres), str(siete), str(al_dia)}

    r = tomar(con, "prueba-1")
    assert items(r, "Andrés Rojas", ventas) == {(str(tres), 3), (str(siete), 3)}
    assert items(r, "Laura Méndez", ventas) == {(str(siete), 7)}
    laura = next(x for x in r if x["destinatario"]["nombre"] == "Laura Méndez")
    assert laura["es_gerente"] is True and "Andrés Rojas" in laura["total_7_por_asesor"]
    # Sin datos de contacto del cliente: ni celular ni correo
    assert "+573" not in json.dumps(r)


def test_cada_resumen_lo_toma_una_sola_ejecucion(con, equipo):
    c = contacto(con, equipo["U02"])
    ventas = {str(venta(con, c, equipo["U02"], 4))}
    assert items(tomar(con, "prueba-1"), "Andrés Rojas", ventas)
    assert not items(tomar(con, "prueba-2"), "Andrés Rojas", ventas)  # otra ejecución: ya está reservado
    assert items(tomar(con, "prueba-1"), "Andrés Rojas", ventas)  # la misma (se perdió la respuesta): es suyo


def test_solo_la_ejecucion_que_reservo_confirma_o_suelta(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], 4)
    r = next(x for x in tomar(con, "prueba-1") if x["destinatario"]["nombre"] == "Andrés Rojas")
    assert como_servicio(con, "select confirmar_resumen(%s, 'otra')", r["id"]) is False
    assert como_servicio(con, "select soltar_resumen(%s, 'otra')", r["id"]) is False
    assert como_servicio(con, "select confirmar_resumen(%s, 'prueba-1')", r["id"]) is True
    assert como_servicio(con, "select confirmar_resumen(%s, 'prueba-1')", r["id"]) is True  # repetir no daña
    # Confirmado: el detalle con nombres se borra; queda la cantidad
    assert set(uno(con, "select contenido from resumenes_seguimiento where id = %s", r["id"])) == {"cantidad"}


def test_un_resumen_que_fallo_o_quedo_abandonado_lo_toma_la_siguiente(con, equipo):
    c = contacto(con, equipo["U02"])
    ventas = {str(venta(con, c, equipo["U02"], 4))}
    r = next(x for x in tomar(con, "prueba-1") if x["destinatario"]["nombre"] == "Andrés Rojas")
    # El correo falló: se suelta y lo toma la siguiente ejecución
    assert como_servicio(con, "select soltar_resumen(%s, 'prueba-1')", r["id"]) is True
    assert items(tomar(con, "prueba-2"), "Andrés Rojas", ventas)
    # n8n se detuvo sin confirmar: a los 30 minutos se da por abandonado
    assert not items(tomar(con, "prueba-3"), "Andrés Rojas", ventas)
    con.execute(
        "update resumenes_seguimiento set reservado_en = now() - interval '31 minutes' where id = %s", (r["id"],)
    )
    assert items(tomar(con, "prueba-3"), "Andrés Rojas", ventas)


def test_un_resumen_por_dia_y_lo_avisado_no_se_repite(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 4)
    r = tomar(con, "prueba-1")
    confirmar_todos(con, r, "prueba-1")

    # Mismo día, algo nuevo: espera a mañana (un resumen al día)
    nueva = venta(con, c, equipo["U02"], 5)
    assert not items(tomar(con, "prueba-2"), "Andrés Rojas", {str(v), str(nueva)})

    # Al día siguiente sale solo lo nuevo; lo ya avisado no se repite
    pasar_al_dia_siguiente(con)
    assert items(tomar(con, "prueba-3"), "Andrés Rojas", {str(v), str(nueva)}) == {(str(nueva), 3)}


def test_un_dia_sin_correr_no_se_pierde(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 6)  # cruzó los 3 días hace 3 días, y nadie corrió el flujo
    assert items(tomar(con, "prueba-1"), "Andrés Rojas", {str(v)}) == {(str(v), 3)}


def test_una_venta_que_revive_y_se_vuelve_a_enfriar_se_avisa_otra_vez(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 6)
    confirmar_todos(con, tomar(con, "prueba-1"), "prueba-1")
    pasar_al_dia_siguiente(con)

    llamada = actividad(con, c, equipo["U02"], "llamada", 0, True, venta_id=v)  # el asesor llamó
    assert not items(tomar(con, "prueba-2"), "Andrés Rojas", {str(v)})
    # ... y pasaron otros 4 días sin nada
    con.execute("update actividades set completada_en = now() - interval '4 days' where id = %s", (llamada,))
    con.execute("delete from resumenes_seguimiento where ejecucion = 'prueba-2'")
    assert items(tomar(con, "prueba-3"), "Andrés Rojas", {str(v)}) == {(str(v), 3)}


def test_una_venta_que_pasa_a_otro_asesor_se_le_avisa_al_nuevo(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 8)
    confirmar_todos(con, tomar(con, "prueba-1"), "prueba-1")
    pasar_al_dia_siguiente(con)

    con.execute("update oportunidades set asesor_id = %s where id = %s", (equipo["U03"], v))
    r = tomar(con, "prueba-2")
    assert items(r, "Valentina Ospina", {str(v)}) == {(str(v), 3)}
    assert not items(r, "Laura Méndez", {str(v)})  # a Laura ya se le había avisado


def test_lo_de_un_asesor_inactivo_va_a_la_gerente(con, equipo):
    c = contacto(con, equipo["U04"])
    v = venta(con, c, equipo["U04"], 4)
    con.execute("update perfiles set activo = false where id = %s", (equipo["U04"],))
    r = tomar(con, "prueba-1")
    assert not [x for x in r if x["destinatario"]["nombre"] == "Camilo Torres"]
    laura = next(x for x in r if x["destinatario"]["nombre"] == "Laura Méndez")
    mia = [i for i in laura["items"] if i["oportunidad_id"] == str(v)]
    assert [(i["nivel"], i["asesor_activo"]) for i in mia] == [(3, False)]


def test_las_tareas_sin_venta_vencidas_tambien_se_recuerdan(con, equipo):
    c = contacto(con, equipo["U02"])
    vencida = actividad(con, c, equipo["U02"], "tarea", -4, False)  # "el cliente volvió a escribir"
    reciente = actividad(con, c, equipo["U02"], "tarea", -1, False)
    r = next(x for x in tomar(con, "prueba-1") if x["destinatario"]["nombre"] == "Andrés Rojas")
    tareas = {i["actividad_id"] for i in r["items"] if i["tipo"] == "tarea"}
    assert str(vencida) in tareas and str(reciente) not in tareas


def test_solo_la_llave_de_servicio_toma_los_resumenes(con, equipo):
    for rol in ("anon", "authenticated"):
        with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
            con.execute(f"set local role {rol}")
            con.execute("select tomar_resumenes_seguimiento('intruso')")
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("set local role anon")
        con.execute("select count(*) from seguimiento_ventas")
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("set local role authenticated")
        con.execute("select count(*) from avisos_seguimiento")


def test_dos_ejecuciones_a_la_vez_no_toman_el_mismo_resumen():
    """Guarda de verdad (dos conexiones deben ver lo mismo) y al final borra sus reservas."""
    from conexion import conectar

    with conectar() as con:
        aplicadas = con.execute(
            "select count(*) from control.migraciones where nombre = any(%s)", (MIGRACIONES,)
        ).fetchone()[0]
        con.rollback()
    if aplicadas < len(MIGRACIONES):
        pytest.skip("las migraciones del seguimiento todavía no están aplicadas")

    ejecuciones = ["prueba-simultanea-1", "prueba-simultanea-2"]
    tomados: dict[str, list[str]] = {}
    salida = threading.Barrier(len(ejecuciones))

    def correr(ejecucion):
        with conectar() as c:
            salida.wait()
            c.execute("set role service_role")
            r = c.execute("select tomar_resumenes_seguimiento(%s)", (ejecucion,)).fetchone()[0]
            c.commit()
            tomados[ejecucion] = [x["destinatario"]["nombre"] for x in r["resumenes"]]

    hilos = [threading.Thread(target=correr, args=(e,)) for e in ejecuciones]
    try:
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
    finally:
        with conectar() as c:
            c.execute("delete from resumenes_seguimiento where ejecucion = any(%s)", (ejecuciones,))
            c.commit()

    primero, segundo = (set(tomados[e]) for e in ejecuciones)
    if not primero | segundo:
        pytest.skip("hoy ya salieron todos los resúmenes: no había nada que disputar")
    assert not primero & segundo  # nadie recibe dos resúmenes


# ---------------------------------------------------------------------------
# Ajustes de la migración 017
# ---------------------------------------------------------------------------


def test_sin_gerente_activa_se_informa_en_vez_de_perderse(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 8)
    con.execute("update perfiles set activo = false where rol = 'gerente'")
    r = como_servicio(con, "select tomar_resumenes_seguimiento('prueba-1')")
    assert r["sin_gerente"] is True
    assert items(r["resumenes"], "Andrés Rojas", {str(v)}) == {(str(v), 3)}  # al asesor le sigue llegando


def test_con_gerente_activa_no_hay_aviso_de_falta(con, equipo):
    assert como_servicio(con, "select tomar_resumenes_seguimiento('prueba-1')")["sin_gerente"] is False


def test_una_tarea_del_tecnico_sin_venta_va_al_asesor_del_contacto(con, equipo):
    c = contacto(con, equipo["U02"])
    tarea = actividad(con, c, equipo["U05"], "tarea", -4, False)  # el técnico no puede abrir la ficha
    r = tomar(con, "prueba-1")
    assert not [x for x in r if x["destinatario"]["rol"] == "tecnico"]
    assert str(tarea) in {i["actividad_id"] for i in de(r, "Andrés Rojas")["items"]}


def test_un_resumen_viejo_que_nunca_salio_se_borra(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 4)
    r = de(tomar(con, "prueba-1"), "Andrés Rojas")
    como_servicio(con, "select soltar_resumen(%s, 'prueba-1')", r["id"])
    pasar_al_dia_siguiente(con)
    assert items(tomar(con, "prueba-2"), "Andrés Rojas", {str(v)}) == {(str(v), 3)}  # lo suyo sale hoy
    assert uno(con, "select count(*) from resumenes_seguimiento where id = %s", r["id"]) == 0


def test_no_confirma_quien_perdio_la_reserva(con, equipo):
    c = contacto(con, equipo["U02"])
    venta(con, c, equipo["U02"], 4)
    r = de(tomar(con, "prueba-1"), "Andrés Rojas")
    con.execute(
        "update resumenes_seguimiento set reservado_en = now() - interval '31 minutes' where id = %s", (r["id"],)
    )
    tomar(con, "prueba-2")  # la retoma otra ejecución
    assert como_servicio(con, "select confirmar_resumen(%s, 'prueba-1')", r["id"]) is False
    assert como_servicio(con, "select confirmar_resumen(%s, 'prueba-2')", r["id"]) is True


def test_una_venta_borrada_antes_de_confirmar_no_rompe_la_confirmacion(con, equipo):
    c = contacto(con, equipo["U02"])
    v = venta(con, c, equipo["U02"], 4)
    r = de(tomar(con, "prueba-1"), "Andrés Rojas")
    con.execute("delete from oportunidades where id = %s", (v,))
    assert como_servicio(con, "select confirmar_resumen(%s, 'prueba-1')", r["id"]) is True
    assert uno(con, "select count(*) from avisos_seguimiento where oportunidad_id = %s", v) == 0
