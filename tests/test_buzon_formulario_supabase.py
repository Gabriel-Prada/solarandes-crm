"""Comprueba en la base de datos real el buzón del formulario web (migraciones 014 y 015).

Cada prueba corre dentro de una transacción que al final se deshace, salvo la de envíos simultáneos,
que necesita guardar de verdad (dos conexiones deben ver lo mismo) y borra lo suyo al terminar.
Si las migraciones 009 a 014 todavía no están aplicadas, se cargan dentro de la transacción.

Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
import threading

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

MIGRACIONES = [
    "009_capturar_leads.sql",
    "010_corrige_captura_de_leads.sql",
    "011_puerta_lee_contactos.sql",
    "012_reservar_avisos.sql",
    "013_respuesta_completa_y_dueno_de_la_reserva.sql",
    "014_buzon_del_formulario.sql",
    "015_ajustes_del_buzon.sql",
]
CELULAR = "+573009990011"
HUELLA = "huella-de-prueba-0001"


@pytest.fixture
def con():
    from conexion import conectar

    with conectar() as conexion:
        with conexion.transaction(force_rollback=True):
            aplicadas = {n for (n,) in conexion.execute("select nombre from control.migraciones")}
            for nombre in MIGRACIONES:
                if nombre not in aplicadas:
                    conexion.execute((RAIZ / "supabase" / "migraciones" / nombre).read_text(encoding="utf-8"))
            assert conexion.execute("select count(*) from contactos where telefono = %s", (CELULAR,)).fetchone()[0] == 0
            yield conexion


def como_servicio(con, consulta, *parametros):
    """Corre la consulta con el rol de la llave de servicio (como lo harán las puertas del CRM)."""
    con.execute("set local role service_role")
    fila = con.execute(consulta, parametros).fetchone()
    con.execute("reset role")
    return fila[0]


def capturar(con, clave, datos=None):
    contacto = {"tipo": "hogar", "nombre": "Prueba Buzón", "empresa": "", "telefono": CELULAR, "email": "",
                "ciudad": "Cali", "consumo_kwh_mes": 300}  # fmt: skip
    return como_servicio(
        con,
        "select capturar_lead(%s, 'web', %s::jsonb, null, null, null, %s::jsonb)",
        clave,
        json.dumps(contacto),
        json.dumps(datos) if datos is not None else None,
    )


def pendientes(con, limite=20):
    return como_servicio(con, "select avisos_pendientes(%s)", limite)


def test_la_captura_guarda_los_datos_del_envio_y_el_lead_queda_pendiente_de_aviso(con):
    datos = {"clave": "form:prueba-0001", "nombre": "prueba buzón", "correo": "x@example.com", "mensaje": "Hola"}
    capturar(con, "form:prueba-0001", datos)

    p = pendientes(con)
    mio = [x for x in p["pendientes"] if x["clave"] == "form:prueba-0001"]
    assert len(mio) == 1
    assert mio[0]["cuerpo"] == datos and mio[0]["respuesta"]["resultado"] == "creado"


def test_los_radicados_de_antes_no_quedan_pendientes(con):
    # La migración marcó todos los radicados viejos como ya avisados: ninguno aparece
    claves = {x["clave"] for x in pendientes(con, 50)["pendientes"]}
    viejos = {
        c for (c,) in con.execute("select clave from envios_recibidos where avisos_reservados_por = 'migracion-014'")
    }
    assert not (claves & viejos)


def test_un_lead_reservado_deja_de_estar_pendiente(con):
    capturar(con, "form:prueba-0002", {"clave": "form:prueba-0002"})
    assert como_servicio(con, "select reservar_avisos('form:prueba-0002', 'ejecucion-1')") is True
    assert "form:prueba-0002" not in {x["clave"] for x in pendientes(con)["pendientes"]}


def test_una_reserva_sin_confirmar_en_15_minutos_aparece_como_atascada(con):
    capturar(con, "form:prueba-0003", {"clave": "form:prueba-0003"})
    como_servicio(con, "select reservar_avisos('form:prueba-0003', 'ejecucion-1')")
    assert "form:prueba-0003" not in [x["clave"] for x in pendientes(con)["atascados"]]

    con.execute(
        "update envios_recibidos set avisos_reservados_en = now() - interval '20 minutes' "
        "where clave = 'form:prueba-0003'"
    )
    # Con la ejecución que lo reservó, para revisar si los avisos salieron antes de reenviarlos (015)
    assert {"clave": "form:prueba-0003", "ejecucion": "ejecucion-1"} in pendientes(con)["atascados"]


def test_confirmar_los_avisos_borra_los_datos_y_deja_la_autorizacion(con):
    autorizacion = {"aceptada_en": "2026-10-24T15:00:00Z", "version": "2026-10"}
    capturar(
        con, "form:prueba-0004", {"clave": "form:prueba-0004", "correo": "x@example.com", "autorizacion": autorizacion}
    )
    como_servicio(con, "select reservar_avisos('form:prueba-0004', 'ejecucion-1')")

    # Solo la ejecución que reservó puede confirmar
    assert como_servicio(con, "select confirmar_avisos('form:prueba-0004', 'otra-ejecucion')") is False
    assert como_servicio(con, "select confirmar_avisos('form:prueba-0004', 'ejecucion-1')") is True
    fila = con.execute(
        "select datos, avisos_enviados_en from envios_recibidos where clave = 'form:prueba-0004'"
    ).fetchone()
    assert fila[0] == {"autorizacion": autorizacion} and fila[1] is not None
    assert "form:prueba-0004" not in [x["clave"] for x in pendientes(con)["atascados"]]


def test_los_datos_de_mas_de_30_dias_se_borran(con):
    capturar(con, "form:prueba-0005", {"clave": "form:prueba-0005", "correo": "x@example.com"})
    con.execute("update envios_recibidos set recibido_en = now() - interval '31 days' where clave = 'form:prueba-0005'")
    pendientes(con)
    assert con.execute("select datos from envios_recibidos where clave = 'form:prueba-0005'").fetchone() == (None,)


def test_el_limite_por_conexion_deja_pasar_5_cada_10_minutos(con):
    resultados = [como_servicio(con, "select permitir_envio_formulario(%s)", HUELLA) for _ in range(6)]
    assert resultados == ["ok"] * 5 + ["huella"]
    # Otra conexión no se ve afectada
    assert como_servicio(con, "select permitir_envio_formulario('otra-huella-de-prueba')") == "ok"


def test_los_topes_por_hora_y_por_dia(con):
    con.execute("delete from intentos_formulario")
    con.execute(
        "insert into intentos_formulario (huella) select 'relleno-de-prueba-' || g from generate_series(1, 60) g"
    )
    assert como_servicio(con, "select permitir_envio_formulario(%s)", HUELLA) == "hora"

    con.execute("delete from intentos_formulario")
    con.execute(
        "insert into intentos_formulario (huella, en) "
        "select 'relleno-de-prueba-' || g, now() - interval '2 hours' from generate_series(1, 100) g"
    )
    assert como_servicio(con, "select permitir_envio_formulario(%s)", HUELLA) == "dia"
    estado = pendientes(con)["formulario"]
    assert estado["ultimo_dia"] == 100 and estado["tope_dia"] == 100


def test_los_intentos_de_mas_de_24_horas_se_borran(con):
    con.execute(
        "insert into intentos_formulario (huella, en) values ('vieja-de-prueba-0001', now() - interval '25 hours')"
    )
    como_servicio(con, "select permitir_envio_formulario(%s)", HUELLA)
    assert con.execute("select count(*) from intentos_formulario where huella = 'vieja-de-prueba-0001'").fetchone() == (
        0,
    )


def test_con_sesion_o_sin_ella_no_se_toca_el_buzon(con):
    con.execute("set local role authenticated")
    for consulta in (
        "select permitir_envio_formulario('x-de-prueba-0000001')",
        "select avisos_pendientes()",
        "select confirmar_avisos('form:x', 'y')",
        "select count(*) from intentos_formulario",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with con.transaction():
                con.execute(consulta)


def test_diez_envios_simultaneos_de_la_misma_conexion_solo_dejan_pasar_cinco():
    # El problema de "revisar y después actuar": si los diez cuentan "0" antes de anotarse, pasan todos.
    # Con el turno de la base de datos se atienden de a uno. Esta prueba guarda de verdad y borra lo suyo.
    from conexion import conectar

    huella = "huella-simultanea-de-prueba-0001"
    with conectar() as preparar:
        aplicadas = {n for (n,) in preparar.execute("select nombre from control.migraciones")}
        if "014_buzon_del_formulario.sql" not in aplicadas:
            pytest.skip("la migración 014 todavía no está aplicada")
    resultados, salida = [], threading.Barrier(10)

    def enviar():
        with conectar() as c:
            c.execute("set role service_role")
            salida.wait()
            resultados.append(c.execute("select permitir_envio_formulario(%s)", (huella,)).fetchone()[0])
            c.commit()

    try:
        hilos = [threading.Thread(target=enviar) for _ in range(10)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(timeout=60)
        assert sorted(resultados) == ["huella"] * 5 + ["ok"] * 5
    finally:
        with conectar() as limpiar:
            limpiar.execute("delete from intentos_formulario where huella = %s", (huella,))
            limpiar.commit()


def test_cada_envio_del_formulario_tambien_borra_los_datos_vencidos(con):
    # Migración 015: la limpieza de los 30 días no depende de que n8n esté prendido
    capturar(con, "form:prueba-0006", {"clave": "form:prueba-0006", "correo": "x@example.com"})
    con.execute("update envios_recibidos set recibido_en = now() - interval '31 days' where clave = 'form:prueba-0006'")
    como_servicio(con, "select permitir_envio_formulario(%s)", HUELLA)
    assert con.execute("select datos from envios_recibidos where clave = 'form:prueba-0006'").fetchone() == (None,)
