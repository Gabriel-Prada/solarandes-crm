"""Comprueba en la base de datos real la captura de leads de la fase 3 (migraciones 009 y 010).

Cada prueba corre dentro de una transacción que al final se deshace: no queda nada guardado.
Si alguna de esas migraciones todavía no está aplicada, la prueba la carga dentro de esa misma
transacción, así que se puede probar antes de aplicarla.

Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

MIGRACIONES = ["009_capturar_leads.sql", "010_corrige_captura_de_leads.sql"]
# Celulares inventados que no existen en el set de datos (se comprueba en cada prueba)
CELULAR_NUEVO = "+573009990001"
OTRO_CELULAR_NUEVO = "+573009990002"


@pytest.fixture
def con():
    from conexion import conectar

    with conectar() as conexion:
        with conexion.transaction(force_rollback=True):
            aplicadas = {n for (n,) in conexion.execute("select nombre from control.migraciones")}
            for nombre in MIGRACIONES:
                if nombre not in aplicadas:
                    conexion.execute((RAIZ / "supabase" / "migraciones" / nombre).read_text(encoding="utf-8"))
            for celular in (CELULAR_NUEVO, OTRO_CELULAR_NUEVO):
                usado = conexion.execute("select count(*) from contactos where telefono = %s", (celular,)).fetchone()[0]
                assert usado == 0, f"{celular} ya existe en el CRM: cambia el celular de la prueba"
            yield conexion


def lead(**campos) -> dict:
    datos = {
        "tipo": "hogar",
        "nombre": "Prueba Automatización",
        "empresa": "",
        "telefono": CELULAR_NUEVO,
        "email": "",
        "ciudad": "Medellín",
        "consumo_kwh_mes": 300,
    }
    return {**datos, **campos}


def capturar(con, clave, contacto, mensaje=None, existente=None, duda=None) -> dict:
    """Llama a capturar_lead como lo hará la puerta del CRM: con el rol de la llave de servicio."""
    con.execute("set local role service_role")
    fila = con.execute(
        "select capturar_lead(%s, 'web', %s::jsonb, %s, %s, %s)",
        (clave, json.dumps(contacto), mensaje, existente, duda),
    ).fetchone()
    con.execute("reset role")
    return fila[0]


def uno(con, consulta, *parametros):
    return con.execute(consulta, parametros).fetchone()


def test_lead_nuevo_queda_creado_y_asignado_al_asesor_de_su_ciudad(con):
    r = capturar(con, "envio-prueba-0001", lead(), mensaje="Quiero paneles para mi casa")

    assert r["resultado"] == "creado" and r["nuevo"] is True
    assert r["asesor"]["codigo"] == "U03"  # Valentina, la asesora de Medellín
    assert r["fuera_de_ciudad"] is False

    contacto = uno(
        con, "select id, canal_origen, ciudad, consumo_kwh_mes from contactos where codigo = %s", r["codigo"]
    )
    assert contacto[1:] == ("web", "Medellín", 300)
    venta = uno(con, "select id, etapa, nombre, valor_cop from oportunidades where contacto_id = %s", contacto[0])
    assert venta[1] == "nuevo" and "kWp" in venta[2] and venta[3] > 0
    # El primer paso lo hizo el sistema: cambiado_por vacío
    assert uno(con, "select cambiado_por from historial_etapas where oportunidad_id = %s", venta[0]) == (None,)

    actividades = con.execute(
        "select tipo, completada, descripcion from actividades where contacto_id = %s order by tipo", (contacto[0],)
    ).fetchall()
    assert [(t, c) for t, c, _ in actividades] == [("nota", False), ("tarea", False)]
    assert "Quiero paneles" in actividades[0][2]
    assert "Contactar al lead nuevo" in actividades[1][2]


def test_el_mismo_envio_dos_veces_no_duplica_nada(con):
    antes = uno(con, "select count(*) from contactos")[0]
    primera = capturar(con, "envio-prueba-0002", lead(), mensaje="Hola")
    segunda = capturar(con, "envio-prueba-0002", lead(), mensaje="Hola")

    assert segunda["resultado"] == "ya_procesado"
    assert segunda["resultado_original"] == "creado"
    assert segunda["codigo"] == primera["codigo"]
    assert uno(con, "select count(*) from contactos")[0] == antes + 1
    id_contacto = uno(con, "select id from contactos where codigo = %s", primera["codigo"])[0]
    assert uno(con, "select count(*) from actividades where contacto_id = %s", id_contacto)[0] == 2


def test_un_cliente_que_ya_existe_no_se_duplica(con):
    codigo, id_contacto, asesor = uno(con, "select codigo, id, asesor_id from contactos order by codigo limit 1")
    antes = uno(con, "select count(*) from contactos")[0]

    r = capturar(con, "envio-prueba-0003", lead(), mensaje="Otra vez yo", existente=codigo)

    assert r["resultado"] == "existente" and r["nuevo"] is False and r["codigo"] == codigo
    assert r["fuera_de_ciudad"] is False  # conserva su asesor, sea de donde sea
    assert uno(con, "select count(*) from contactos")[0] == antes
    # En una transacción todas las actividades tienen la misma hora: se buscan por su texto
    tareas = con.execute(
        "select usuario_id from actividades where contacto_id = %s and tipo = 'tarea' and descripcion like %s",
        (id_contacto, "%volvió a escribir%"),
    ).fetchall()
    assert tareas == [(asesor,)]


def test_duda_con_el_celular_de_otro_no_crea_ni_mezcla_datos(con):
    # La familia que comparte celular: no se une a nadie, se anota para que una persona decida
    codigo, id_contacto, nombre, telefono = uno(
        con, "select codigo, id, nombre, telefono from contactos order by codigo limit 1"
    )
    antes = uno(con, "select count(*) from contactos")[0]

    r = capturar(
        con, "envio-prueba-0004", lead(nombre="Otra Persona Distinta", telefono=telefono), duda="mismo celular"
    )

    assert r["resultado"] == "revision" and r["nuevo"] is False and r["codigo"] == codigo
    assert uno(con, "select count(*) from contactos")[0] == antes
    assert uno(con, "select nombre from contactos where id = %s", id_contacto) == (nombre,)  # sin tocar
    # Tampoco le abre una venta nueva (now() es la hora de inicio de esta transacción)
    assert uno(con, "select count(*) from oportunidades where contacto_id = %s and creada_en = now()", id_contacto) == (
        0,
    )
    notas = uno(
        con,
        "select count(*) from actividades where contacto_id = %s and tipo = 'nota' and descripcion like %s",
        id_contacto,
        "%Otra Persona Distinta%",
    )
    assert notas == (1,)


def test_duda_sin_choque_de_celular_se_crea_y_queda_marcada(con):
    r = capturar(con, "envio-prueba-0005", lead(), duda="se parece a C0001 Juan Pérez")

    assert r["resultado"] == "revision" and r["nuevo"] is True and r["duda"] == "se parece a C0001 Juan Pérez"
    id_contacto = uno(con, "select id from contactos where codigo = %s", r["codigo"])[0]
    notas = con.execute("select descripcion from actividades where contacto_id = %s and tipo = 'nota'", (id_contacto,))
    assert any("Posible duplicado" in d for (d,) in notas.fetchall())


def test_rotacion_entre_dos_asesores_de_la_misma_ciudad(con):
    # Valentina se pasa a Bogotá: ahora Bogotá tiene dos asesores y los leads se turnan
    con.execute("update perfiles set ciudad = 'Bogotá' where codigo = 'U03'")
    primero = capturar(con, "envio-prueba-0006", lead(ciudad="Bogotá"))
    segundo = capturar(con, "envio-prueba-0007", lead(ciudad="Bogotá", telefono=OTRO_CELULAR_NUEVO))

    assert {primero["asesor"]["codigo"], segundo["asesor"]["codigo"]} == {"U02", "U03"}


def test_ciudad_sin_asesor_activo_rota_entre_todos_y_lo_marca(con):
    con.execute("update perfiles set activo = false where codigo = 'U04'")  # Camilo (Cali) se fue
    r = capturar(con, "envio-prueba-0008", lead(ciudad="Cali"))

    assert r["asesor"]["codigo"] in ("U02", "U03")
    assert r["fuera_de_ciudad"] is True


def test_sin_consumo_la_venta_queda_por_definir(con):
    r = capturar(con, "envio-prueba-0009", lead(consumo_kwh_mes=None))

    id_contacto = uno(con, "select id from contactos where codigo = %s", r["codigo"])[0]
    venta = uno(con, "select nombre, valor_cop from oportunidades where contacto_id = %s", id_contacto)
    assert venta[0].startswith("Sistema por definir") and venta[1] is None


def test_solo_la_puerta_del_crm_puede_registrar_leads(con):
    # Ni siquiera la gerente con sesión iniciada: la función es solo para la llave de servicio
    gerente = uno(con, "select id from perfiles where codigo = 'U01'")[0]
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(gerente), "role": "authenticated"}),),
    )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("select capturar_lead('envio-prueba-0010', 'web', %s::jsonb)", (json.dumps(lead()),))


def test_una_clave_demasiado_corta_se_rechaza(con):
    with pytest.raises(psycopg.errors.CheckViolation):
        capturar(con, "corta", lead())


# --- Casos que encontró la revisión de código (corregidos en la migración 010) ---


def test_un_asesor_sin_ciudad_no_se_lleva_los_leads_de_todos(con):
    # Si alguien registra un asesor sin ciudad, no debe quedar primero en la fila
    con.execute("update perfiles set ciudad = null where codigo = 'U02'")
    r = capturar(con, "envio-prueba-0011", lead(ciudad="Medellín"))

    assert r["asesor"]["codigo"] == "U03"


def test_si_el_asesor_del_cliente_ya_no_esta_la_tarea_va_a_la_gerente(con):
    codigo, id_contacto, asesor = uno(
        con, "select c.codigo, c.id, c.asesor_id from contactos c join perfiles p on p.id = c.asesor_id limit 1"
    )
    con.execute("update perfiles set activo = false where id = %s", (asesor,))
    r = capturar(con, "envio-prueba-0012", lead(), existente=codigo)

    assert r["asesor_inactivo"] is True and r["asesor"]["codigo"] == "U01"
    tareas = con.execute(
        "select p.codigo from actividades a join perfiles p on p.id = a.usuario_id "
        "where a.contacto_id = %s and a.tipo = 'tarea' and a.descripcion like 'Reasignar%%'",
        (id_contacto,),
    ).fetchall()
    assert tareas == [("U01",)]


def test_un_negocio_usa_el_nombre_de_la_empresa_en_la_venta(con):
    # Llega como "hogar" pero trae empresa: con empresa es negocio (regla de la importación)
    r = capturar(con, "envio-prueba-0013", lead(nombre="Rosa Gómez", empresa="Panadería La Espiga"))

    tipo, id_contacto = uno(con, "select tipo, id from contactos where codigo = %s", r["codigo"])
    assert tipo == "negocio"
    venta = uno(con, "select nombre from oportunidades where contacto_id = %s", id_contacto)[0]
    assert venta.endswith("Panadería La Espiga")


def test_un_consumo_fuera_de_rango_no_pierde_el_lead(con):
    r = capturar(con, "envio-prueba-0014", lead(consumo_kwh_mes=150000))

    assert r["resultado"] == "creado"
    id_contacto = uno(con, "select id from contactos where codigo = %s", r["codigo"])[0]
    venta = uno(con, "select nombre, valor_cop from oportunidades where contacto_id = %s", id_contacto)
    assert venta[0].startswith("Sistema por definir") and venta[1] is None


def test_un_consumo_con_decimales_se_redondea(con):
    r = capturar(con, "envio-prueba-0015", lead(consumo_kwh_mes="300.6"))

    assert uno(con, "select consumo_kwh_mes from contactos where codigo = %s", r["codigo"]) == (301,)


def test_sin_nombre_ni_empresa_es_un_dato_invalido(con):
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        capturar(con, "envio-prueba-0016", lead(nombre="", empresa=""))


def test_celular_de_otro_sin_duda_tambien_va_a_revision(con):
    # Aunque la revisión de duplicados no lo haya marcado, la base de datos no deja repetir celulares
    codigo, telefono = uno(con, "select codigo, telefono from contactos order by codigo limit 1")
    r = capturar(con, "envio-prueba-0017", lead(nombre="Alguien Más", telefono=telefono))

    assert r["resultado"] == "revision" and r["codigo"] == codigo and r["nuevo"] is False


def test_un_envio_repetido_recuerda_que_fue_un_cliente_existente(con):
    codigo = uno(con, "select codigo from contactos order by codigo limit 1")[0]
    capturar(con, "envio-prueba-0018", lead(), existente=codigo)
    r = capturar(con, "envio-prueba-0018", lead(), existente=codigo)

    assert r["resultado"] == "ya_procesado" and r["resultado_original"] == "existente" and r["codigo"] == codigo


def test_los_visitantes_anonimos_no_pueden_nada(con):
    con.execute("set local role anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("select capturar_lead('envio-prueba-0019', 'web', %s::jsonb)", (json.dumps(lead()),))


def test_con_sesion_no_se_puede_elegir_asesor_ni_leer_los_radicados(con):
    gerente = uno(con, "select id from perfiles where codigo = 'U01'")[0]
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(gerente), "role": "authenticated"}),),
    )
    # El primer intento va en un punto de guardado: tras un error, Postgres no deja seguir sin deshacerlo
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with con.transaction():
            con.execute("select asesor_para_lead('Bogotá')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("select count(*) from envios_recibidos")
