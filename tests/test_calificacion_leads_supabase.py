"""Comprueba en la base de datos real la calificación de leads de la fase 4 (migración 020).

Cada prueba corre dentro de una transacción que al final se deshace: no queda nada guardado.
Si la migración todavía no está aplicada, la prueba la carga dentro de esa misma transacción.
Aquí no se llama a Claude: la ficha la "responde" la prueba, como si Claude la hubiera llenado.

Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
import uuid

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

# Celulares inventados que no existen en el set de datos (se comprueba en cada prueba)
CELULAR = "+573009990101"
OTRO_CELULAR = "+573009990102"
MODELO = "claude-haiku-5-5"

FICHA = {
    "es_lead": True,
    "tipo_cliente": "hogar",
    "urgencia": "media",
    "intencion": "quiere_sistema",
    "consumo_kwh_mes": None,
    "factura_luz_cop": None,
    "resumen": "Hogar en Medellín que quiere bajar la factura",
}


@pytest.fixture
def con():
    from conexion import conectar

    with conectar() as conexion:
        with conexion.transaction(force_rollback=True):
            aplicadas = {n for (n,) in conexion.execute("select nombre from control.migraciones")}
            for ruta in sorted((RAIZ / "supabase" / "migraciones").glob("*.sql")):
                if ruta.name >= "009" and ruta.name not in aplicadas:
                    conexion.execute(ruta.read_text(encoding="utf-8"))
            for celular in (CELULAR, OTRO_CELULAR):
                usado = conexion.execute("select count(*) from contactos where telefono = %s", (celular,)).fetchone()[0]
                assert usado == 0, f"{celular} ya existe en el CRM: cambia el celular de la prueba"
            # Las calificaciones reales que estén esperando no deben cruzarse con las de la prueba
            conexion.execute("update calificaciones_lead set proximo_intento_en = now() + interval '1 day'")
            yield conexion


def como_servicio(con, consulta, *parametros):
    """Corre la consulta con el rol de la llave de servicio (como lo hará la ventanilla del CRM)."""
    con.execute("set local role service_role")
    fila = con.execute(consulta, parametros).fetchone()
    con.execute("reset role")
    return fila[0]


def como_usuario(con, codigo):
    """Desde aquí, la conexión actúa como esa persona del equipo con su sesión iniciada."""
    persona = con.execute("select id from perfiles where codigo = %s", (codigo,)).fetchone()[0]
    con.execute("set local role authenticated")
    con.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": str(persona), "role": "authenticated"}),),
    )


def capturar(con, clave, mensaje=None, existente=None, **campos):
    contacto = {"tipo": "hogar", "nombre": "Prueba Calificación", "empresa": "", "telefono": CELULAR,
                "email": "prueba@example.com", "ciudad": "Medellín", "consumo_kwh_mes": None, **campos}  # fmt: skip
    return como_servicio(
        con,
        "select capturar_lead(%s, 'web', %s::jsonb, %s, %s, null, null)",
        clave,
        json.dumps(contacto),
        mensaje,
        existente,
    )


def calificacion(con, clave):
    fila = con.execute(
        "select id, estado, captura, oportunidad_id, tarea_id, entrada, intentos"
        " from calificaciones_lead where clave = %s",
        (clave,),
    ).fetchone()
    if fila is None:
        return None
    nombres = ["id", "estado", "captura", "oportunidad_id", "tarea_id", "entrada", "intentos"]
    return dict(zip(nombres, fila, strict=True))


def tomar(con, pedido=None):
    return como_servicio(con, "select tomar_calificacion(%s, %s)", pedido or uuid.uuid4(), MODELO)


def guardar(con, tomada, pedido, resultado="ok", ficha=None):
    return como_servicio(
        con,
        "select guardar_calificacion(%s, %s, %s, %s, %s::jsonb, 'v1', 900, 120, 0.00015, 1800, null)",
        tomada["calificacion_id"],
        pedido,
        tomada["llamada_id"],
        resultado,
        json.dumps(FICHA if ficha is None and resultado == "ok" else ficha),
    )


def prioridad(con, clave):
    return con.execute(
        "select v.prioridad from prioridades_leads v join calificaciones_lead c using (id) where c.clave = %s", (clave,)
    ).fetchone()[0]


def regla(con, ficha, entrada=None):
    return con.execute(
        "select prioridad_regla(%s::jsonb, %s::jsonb)", (json.dumps(ficha), json.dumps(entrada or {}))
    ).fetchone()[0]


# --- La calificación nace con el lead ---------------------------------------------------------


def test_un_lead_nuevo_con_mensaje_queda_por_calificar_sin_datos_personales(con):
    r = capturar(con, "form:calif-0001", mensaje="Tengo una panadería y pago 1.800.000 de luz", empresa="Panadería X")
    assert r["resultado"] == "creado"

    c = calificacion(con, "form:calif-0001")
    assert c["estado"] == "por_calificar" and c["captura"] == "creado" and c["intentos"] == 0
    # Apunta a la venta y a la tarea que se acaban de crear
    venta = con.execute("select contacto_id from oportunidades where id = %s", (c["oportunidad_id"],)).fetchone()
    tarea = con.execute("select tipo, descripcion from actividades where id = %s", (c["tarea_id"],)).fetchone()
    assert venta is not None
    assert tarea[0] == "tarea" and "Contactar al lead nuevo" in tarea[1]
    # A Claude solo le llega lo necesario: ni nombre, ni empresa, ni celular, ni correo
    assert c["entrada"] == {
        "mensaje": "Tengo una panadería y pago 1.800.000 de luz",
        "ciudad": "Medellín",
        "es_empresa": True,
    }


def test_un_lead_sin_mensaje_o_solo_con_saludos_no_llama_a_claude_y_queda_en_media(con):
    capturar(con, "form:calif-0002", mensaje="¡Hola, buenas tardes! Info por favor")
    c = calificacion(con, "form:calif-0002")
    assert c["estado"] == "sin_mensaje" and "mensaje" not in c["entrada"]
    assert prioridad(con, "form:calif-0002") == "media"
    # Nada que tomar: no se gasta una llamada en un saludo
    assert tomar(con)["estado"] == "nada"


def test_sin_mensaje_la_prioridad_sale_del_formulario(con):
    # Quien llena "cotiza" quiere un sistema: una empresa o un consumo alto es alta aunque no escriba nada
    capturar(con, "form:calif-0030", mensaje="", empresa="Hotel Prueba", consumo_kwh_mes=3000)
    assert calificacion(con, "form:calif-0030")["estado"] == "sin_mensaje"
    assert prioridad(con, "form:calif-0030") == "alta"


def test_cuando_un_mensaje_aporta(con):
    casos = {
        None: False,
        "": False,
        "hola": False,
        "Buenos días, información": False,
        "ok gracias": False,
        "Quiero paneles": True,
        "300 kWh": True,
        "urgente": True,
        "x": False,
    }
    for mensaje, esperado in casos.items():
        assert con.execute("select mensaje_aporta(%s)", (mensaje,)).fetchone()[0] is esperado, mensaje


def test_un_cliente_que_vuelve_a_escribir_se_califica_en_su_tarea(con):
    codigo = capturar(con, "form:calif-0003", mensaje="Quiero cotizar")["codigo"]
    r = capturar(con, "form:calif-0004", mensaje="Se me dañó el inversor, es urgente", existente=codigo)
    assert r["resultado"] == "existente"

    c = calificacion(con, "form:calif-0004")
    assert c["estado"] == "por_calificar" and c["captura"] == "existente"
    assert c["oportunidad_id"] is None  # un cliente que vuelve no abre venta
    tarea = con.execute("select descripcion from actividades where id = %s", (c["tarea_id"],)).fetchone()[0]
    assert "volvió a escribir" in tarea


def test_un_cliente_que_vuelve_solo_a_saludar_no_crea_calificacion(con):
    codigo = capturar(con, "form:calif-0005", mensaje="Quiero cotizar")["codigo"]
    capturar(con, "form:calif-0006", mensaje="Hola", existente=codigo)
    assert calificacion(con, "form:calif-0006") is None


def test_con_el_celular_de_otra_persona_no_se_califica(con):
    # La nota queda en la ficha de quien ya tenía ese celular: calificarla le pegaría la prioridad a otro
    capturar(con, "form:calif-0007", mensaje="Quiero paneles")
    r = capturar(con, "form:calif-0008", mensaje="Quiero paneles urgente", nombre="Otra Persona")
    assert r["resultado"] == "revision" and r["nuevo"] is False
    assert calificacion(con, "form:calif-0008") is None


def test_el_mismo_envio_dos_veces_crea_una_sola_calificacion(con):
    capturar(con, "form:calif-0009", mensaje="Quiero paneles")
    assert capturar(con, "form:calif-0009", mensaje="Quiero paneles")["resultado"] == "ya_procesado"
    assert con.execute("select count(*) from calificaciones_lead where clave = 'form:calif-0009'").fetchone()[0] == 1


# --- La regla de prioridad --------------------------------------------------------------------


def test_la_regla_de_prioridad(con):
    base = dict(FICHA)
    assert regla(con, base) == "media"
    assert regla(con, {**base, "es_lead": False, "urgencia": "alta"}) == "no_es_lead"
    assert regla(con, {**base, "urgencia": "alta"}) == "alta"
    assert regla(con, {**base, "consumo_kwh_mes": 500}) == "alta"
    assert regla(con, {**base, "tipo_cliente": "negocio"}) == "alta"
    assert regla(con, base, {"es_empresa": True}) == "alta"  # con empresa en el formulario es negocio
    assert regla(con, {**base, "intencion": "solo_informacion", "urgencia": "alta"}) == "baja"
    assert regla(con, {**base, "urgencia": "baja", "consumo_kwh_mes": 120}) == "baja"
    assert regla(con, {**base, "urgencia": "baja"}) == "media"  # sin consumo no se sabe si es pequeño
    assert regla(con, {**base, "intencion": "otra", "urgencia": "alta"}) == "media"


def test_en_un_choque_gana_la_primera_regla(con):
    # Un negocio que quiere un sistema, sin afán y con poco consumo: cumple alta y baja; gana alta
    ficha = {**FICHA, "tipo_cliente": "negocio", "urgencia": "baja", "consumo_kwh_mes": 100}
    assert regla(con, ficha) == "alta"


def test_el_consumo_sale_del_formulario_del_mensaje_o_de_los_pesos(con):
    def consumo(ficha, entrada=None):
        return con.execute(
            "select consumo_estimado(%s::jsonb, %s::jsonb)", (json.dumps(ficha), json.dumps(entrada or {}))
        ).fetchone()[0]

    assert consumo({**FICHA, "factura_luz_cop": 450000}) == 500  # 450.000 ÷ 900
    assert consumo({**FICHA, "consumo_kwh_mes": 320, "factura_luz_cop": 450000}) == 320
    assert consumo({**FICHA, "consumo_kwh_mes": 320}, {"consumo_kwh_mes": 300}) == 300  # gana el formulario
    assert consumo({**FICHA, "consumo_kwh_mes": -5, "factura_luz_cop": 0}) is None  # absurdos no dicen nada
    # Con lo que paga de luz alcanza para subir la prioridad: 450.000 pesos ≈ 500 kWh
    assert regla(con, {**FICHA, "factura_luz_cop": 450000}) == "alta"


# --- Tomar y guardar ------------------------------------------------------------------------


def test_calificar_un_lead_de_punta_a_punta(con):
    capturar(con, "form:calif-0010", mensaje="Pago 600 mil de luz y quiero instalar ya")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    assert t["estado"] == "tomada" and t["intento"] == 1
    assert t["entrada"]["mensaje"].startswith("Pago 600 mil")
    # La llamada quedó anotada ANTES de llamar a Claude
    assert con.execute("select estado from llamadas_ia where id = %s", (t["llamada_id"],)).fetchone()[0] == "en_curso"
    # Mientras está reservada, nadie más la toma
    assert tomar(con)["estado"] == "nada"

    r = guardar(con, t, pedido, ficha={**FICHA, "urgencia": "alta", "factura_luz_cop": 600000})
    assert r == {"guardada": True, "estado": "calificada", "prioridad": "alta"}
    c = calificacion(con, "form:calif-0010")
    assert c["estado"] == "calificada" and "mensaje" not in c["entrada"]  # la copia del mensaje se borra
    llamada = con.execute(
        "select estado, tokens_entrada, tokens_salida, costo_usd from llamadas_ia where id = %s", (t["llamada_id"],)
    ).fetchone()
    assert llamada[0] == "ok" and llamada[1:3] == (900, 120) and float(llamada[3]) == 0.00015
    assert prioridad(con, "form:calif-0010") == "alta"
    fila = con.execute(
        "select modelo, version_prompt from calificaciones_lead where clave = 'form:calif-0010'"
    ).fetchone()
    assert fila == (MODELO, "v1")


def test_si_claude_no_responde_se_reintenta_con_espera(con):
    capturar(con, "form:calif-0011", mensaje="Quiero paneles")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    r = guardar(con, t, pedido, resultado="error")
    assert r["estado"] == "por_calificar"
    # Todavía no toca: hay una espera antes del siguiente intento
    assert tomar(con)["estado"] == "nada"
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0011'")
    assert tomar(con)["intento"] == 2


def test_tres_respuestas_que_no_cumplen_la_ficha_la_dan_por_fallida(con):
    capturar(con, "form:calif-0012", mensaje="Quiero paneles")
    for _ in range(3):
        con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0012'")
        pedido = uuid.uuid4()
        t = tomar(con, pedido)
        # Una ficha "ok" con un valor que no existe cuenta como inválida
        r = guardar(con, t, pedido, ficha={**FICHA, "urgencia": "urgentísima"})
    assert r["estado"] == "fallida"
    assert "mensaje" not in calificacion(con, "form:calif-0012")["entrada"]
    assert prioridad(con, "form:calif-0012") is None  # sin calificar, visible como tal


def test_si_claude_se_niega_no_se_reintenta(con):
    capturar(con, "form:calif-0013", mensaje="Quiero paneles")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    assert guardar(con, t, pedido, resultado="rechazo")["estado"] == "rechazada"
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0013'")
    assert tomar(con)["estado"] == "nada"


def test_un_pedido_que_ya_no_es_el_dueno_no_pisa_pero_su_llamada_si_se_anota(con):
    capturar(con, "form:calif-0014", mensaje="Quiero paneles")
    primero = uuid.uuid4()
    t1 = tomar(con, primero)
    # Vercel cortó el primer pedido: la reserva vence y otro pedido toma el lead
    con.execute(
        "update calificaciones_lead set reservada_hasta = now() - interval '1 second' where clave = 'form:calif-0014'"
    )
    assert tomar(con)["estado"] == "nada"  # vuelve a la fila con espera
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0014'")
    segundo = uuid.uuid4()
    t2 = tomar(con, segundo)
    assert t2["estado"] == "tomada" and t2["calificacion_id"] == t1["calificacion_id"]
    estado = con.execute("select estado from llamadas_ia where id = %s", (t1["llamada_id"],)).fetchone()[0]
    assert estado == "posiblemente_cobrada"

    # El primer pedido termina tarde: no guarda, pero su llamada (que sí se pagó) queda completa
    assert guardar(con, t1, primero, ficha={**FICHA, "urgencia": "alta"}) == {"guardada": False}
    assert con.execute("select estado from llamadas_ia where id = %s", (t1["llamada_id"],)).fetchone()[0] == "ok"
    assert guardar(con, t2, segundo)["estado"] == "calificada"
    assert prioridad(con, "form:calif-0014") == "media"  # vale la del dueño, no la del pedido tardío


def test_el_tope_diario_frena_las_llamadas(con):
    capturar(con, "form:calif-0015", mensaje="Quiero paneles")
    # Se cuenta con la misma función del tope: los rechazos de la API (no cobrados) no cuentan, y un día
    # con rechazos reales (como el http_401 del 2026-10-29) hacía que la prueba llenara una de menos
    usadas = con.execute("select llamadas_ia_de_hoy()").fetchone()[0]
    faltan = max(0, 300 - usadas)
    con.execute(
        "insert into llamadas_ia (pieza, modelo, estado) select 'calificacion', %s, 'ok' from generate_series(1, %s)",
        (MODELO, faltan),
    )
    r = tomar(con)
    assert r["estado"] == "sin_cupo"
    assert calificacion(con, "form:calif-0015")["estado"] == "por_calificar"  # sigue esperando, no se pierde


def test_a_los_7_dias_queda_vencida_y_visible(con):
    capturar(con, "form:calif-0016", mensaje="Quiero paneles")
    con.execute("update calificaciones_lead set creada_en = now() - interval '8 days' where clave = 'form:calif-0016'")
    assert tomar(con)["estado"] == "nada"
    c = calificacion(con, "form:calif-0016")
    assert c["estado"] == "vencida" and "mensaje" not in c["entrada"]


def test_los_leads_que_esperan_mas_de_30_minutos_cuentan_para_la_alarma(con):
    capturar(con, "form:calif-0017", mensaje="Quiero paneles")
    antes = tomar(con)["atrasadas"]
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0017'")
    # Migración 022: el atraso se mide desde el primer intento
    con.execute(
        "update calificaciones_lead set primer_intento_en = now() - interval '31 minutes'"
        " where clave = 'form:calif-0017'"
    )
    # (la tomó la llamada de arriba; ahora está en curso y atrasada)
    assert tomar(con)["atrasadas"] == antes + 1


# --- La prioridad del asesor ------------------------------------------------------------------


def calificar_rapido(con, clave, ficha=None):
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    guardar(con, t, pedido, ficha=ficha)
    return t["calificacion_id"]


def test_el_asesor_cambia_la_prioridad_y_la_regla_no_la_pisa(con):
    capturar(con, "form:calif-0018", mensaje="Quiero paneles")
    cid = calificar_rapido(con, "form:calif-0018")
    como_usuario(con, "U03")  # Valentina, la asesora de Medellín
    con.execute("select cambiar_prioridad(%s, 'alta')", (cid,))
    fila = con.execute(
        "select prioridad, prioridad_regla, prioridad_asesor, prioridad_asesor_por is not null"
        " from prioridades_leads where id = %s",
        (cid,),
    ).fetchone()
    assert fila == ("alta", "media", "alta", True)
    # Con null vuelve a la de la regla
    con.execute("select cambiar_prioridad(%s, null)", (cid,))
    assert con.execute("select prioridad from prioridades_leads where id = %s", (cid,)).fetchone()[0] == "media"


def test_otro_asesor_no_ve_ni_cambia_la_prioridad_y_la_gerente_si(con):
    capturar(con, "form:calif-0019", mensaje="Quiero paneles")
    cid = calificar_rapido(con, "form:calif-0019")
    como_usuario(con, "U02")  # Andrés, de Bogotá: no es su contacto
    assert con.execute("select count(*) from prioridades_leads where id = %s", (cid,)).fetchone()[0] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with con.transaction():
            con.execute("select cambiar_prioridad(%s, 'baja')", (cid,))
    con.execute("reset role")
    como_usuario(con, "U01")  # Laura, la gerente
    con.execute("select cambiar_prioridad(%s, 'baja')", (cid,))
    assert con.execute("select prioridad from prioridades_leads where id = %s", (cid,)).fetchone()[0] == "baja"


def test_con_sesion_no_se_puede_tomar_guardar_ni_escribir_directo(con):
    como_usuario(con, "U01")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with con.transaction():
            con.execute("select tomar_calificacion(gen_random_uuid(), 'x')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with con.transaction():
            con.execute("update calificaciones_lead set prioridad_asesor = 'alta'")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("insert into llamadas_ia (pieza, modelo) values ('calificacion', 'x')")


def test_los_costos_solo_los_ve_la_gerente_y_los_anonimos_nada(con):
    con.execute("insert into llamadas_ia (pieza, modelo, estado) values ('calificacion', %s, 'ok')", (MODELO,))
    como_usuario(con, "U03")
    assert con.execute("select count(*) from llamadas_ia").fetchone()[0] == 0
    con.execute("reset role")
    como_usuario(con, "U01")
    assert con.execute("select count(*) from llamadas_ia").fetchone()[0] >= 1
    con.execute("reset role")
    con.execute("set local role anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("select count(*) from prioridades_leads")


def test_la_llave_de_servicio_solo_usa_las_funciones(con):
    con.execute("set local role service_role")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        con.execute("select count(*) from calificaciones_lead")


# --- El aviso de "lead prioritario" ---------------------------------------------------------


def avisos(con):
    return como_servicio(con, "select avisos_prioritarios_pendientes()")


def test_el_aviso_de_prioritario_sale_una_vez_y_solo_al_equipo(con):
    capturar(con, "form:calif-0020", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    cid = calificar_rapido(con, "form:calif-0020", {**FICHA, "urgencia": "alta"})
    mios = [a for a in avisos(con)["pendientes"] if a["calificacion_id"] == cid]
    assert len(mios) == 1
    # Va a quien tiene la tarea (la asesora de Medellín), nunca al contacto
    assert mios[0]["destinatario"]["codigo"] == "U03"
    assert mios[0]["destinatario"]["email"].endswith("@solarandes.test")
    assert "prueba@example.com" not in json.dumps(mios[0])

    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-2')", cid) is False
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert all(a["calificacion_id"] != cid for a in avisos(con)["pendientes"])


def test_sin_prioridad_alta_o_de_hace_dias_no_hay_aviso(con):
    capturar(con, "form:calif-0021", mensaje="Solo quiero saber cuánto cuesta")
    cid = calificar_rapido(con, "form:calif-0021", {**FICHA, "intencion": "solo_informacion"})
    capturar(con, "form:calif-0022", mensaje="Quiero paneles ya", telefono=OTRO_CELULAR, nombre="Otra Prueba")
    vieja = calificar_rapido(con, "form:calif-0022", {**FICHA, "urgencia": "alta"})
    con.execute("update calificaciones_lead set calificada_en = now() - interval '2 days' where id = %s", (vieja,))
    ids = {a["calificacion_id"] for a in avisos(con)["pendientes"]}
    assert cid not in ids and vieja not in ids


# --- Lo que encontró la revisión del código ---------------------------------------------------


def test_un_lead_que_falla_siempre_se_da_por_fallido_y_no_se_paga_sin_fin(con):
    capturar(con, "form:calif-0031", mensaje="Quiero paneles")
    for _ in range(8):
        con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0031'")
        pedido = uuid.uuid4()
        r = guardar(con, tomar(con, pedido), pedido, resultado="error")
    assert r["estado"] == "fallida"
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0031'")
    assert tomar(con)["estado"] == "nada"


def test_una_reserva_vencida_vuelve_con_espera_y_al_final_se_da_por_fallida(con):
    capturar(con, "form:calif-0032", mensaje="Quiero paneles")
    tomar(con)
    con.execute(
        "update calificaciones_lead set reservada_hasta = now() - interval '1 second' where clave = 'form:calif-0032'"
    )
    assert tomar(con)["estado"] == "nada"  # volvió a la fila, pero con espera: no se toma de una vez
    # Agotó los intentos (por ejemplo, el CRM falla siempre con ese mensaje): ya no vuelve
    con.execute(
        "update calificaciones_lead set intentos = 8, estado = 'en_curso',"
        " reservada_hasta = now() - interval '1 second'"
        " where clave = 'form:calif-0032'"
    )
    tomar(con)
    assert calificacion(con, "form:calif-0032")["estado"] == "fallida"


def test_una_llamada_que_no_corresponde_no_guarda_nada(con):
    capturar(con, "form:calif-0033", mensaje="Quiero paneles")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    r = guardar(con, {**t, "llamada_id": str(uuid.uuid4())}, pedido)
    assert r == {"guardada": False, "motivo": "llamada_desconocida"}
    assert calificacion(con, "form:calif-0033")["estado"] == "en_curso"


def test_el_tope_no_cuenta_lo_que_la_api_rechazo_sin_cobrar(con):
    def hoy():
        return con.execute("select llamadas_ia_de_hoy()").fetchone()[0]

    antes = hoy()
    con.execute(
        "insert into llamadas_ia (pieza, modelo, estado, error) values"
        " ('calificacion', %s, 'error', 'http_529'), ('calificacion', %s, 'error', 'sin_conexion'),"
        " ('calificacion', %s, 'error', 'tiempo_agotado'), ('calificacion', %s, 'posiblemente_cobrada', null)",
        (MODELO, MODELO, MODELO, MODELO),
    )
    assert hoy() == antes + 2  # el tiempo agotado y la posiblemente cobrada sí cuentan


def test_la_copia_del_mensaje_se_borra_aunque_n8n_este_apagado(con):
    capturar(con, "form:calif-0034", mensaje="Quiero paneles")
    con.execute("update calificaciones_lead set creada_en = now() - interval '8 days' where clave = 'form:calif-0034'")
    # Un envío del formulario corre la limpieza, sin que n8n pregunte
    con.execute("select borrar_datos_vencidos()")
    c = calificacion(con, "form:calif-0034")
    assert c["estado"] == "vencida" and "mensaje" not in c["entrada"]


def test_el_aviso_va_a_alguien_activo(con):
    capturar(con, "form:calif-0035", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    cid = calificar_rapido(con, "form:calif-0035", {**FICHA, "urgencia": "alta"})
    # Valentina (la de Medellín, dueña de la tarea) se desactiva antes del aviso: le llega a la gerente
    con.execute("update perfiles set activo = false where codigo = 'U03'")
    mio = [a for a in avisos(con)["pendientes"] if a["calificacion_id"] == cid]
    assert mio[0]["destinatario"]["codigo"] == "U01"


def test_si_el_asesor_mismo_subio_la_prioridad_no_se_avisa_a_si_mismo(con):
    capturar(con, "form:calif-0036", mensaje="Quiero paneles")
    cid = calificar_rapido(con, "form:calif-0036")  # media
    como_usuario(con, "U03")
    con.execute("select cambiar_prioridad(%s, 'alta')", (cid,))
    con.execute("reset role")
    assert all(a["calificacion_id"] != cid for a in avisos(con)["pendientes"])


def test_un_posible_duplicado_se_califica_pero_no_se_avisa(con):
    # Duda por nombre o correo con un celular nuevo: se crea el lead (revision con venta) y se califica,
    # pero el aviso de prioritario no sale: lo revisa Laura
    contacto = {"nombre": "Prueba Duda", "telefono": CELULAR, "ciudad": "Medellín", "consumo_kwh_mes": 600}
    como_servicio(
        con,
        "select capturar_lead('form:calif-0037', 'web', %s::jsonb, 'Quiero paneles ya', null,"
        " 'Se parece a C0001', null)",
        json.dumps(contacto),
    )
    assert calificacion(con, "form:calif-0037")["captura"] == "revision"
    cid = calificar_rapido(con, "form:calif-0037", {**FICHA, "urgencia": "alta"})
    assert prioridad(con, "form:calif-0037") == "alta"
    assert all(a["calificacion_id"] != cid for a in avisos(con)["pendientes"])


def test_un_lead_que_llego_hace_dias_no_dispara_aviso_al_calificarse_tarde(con):
    capturar(con, "form:calif-0038", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    con.execute("update calificaciones_lead set creada_en = now() - interval '3 days' where clave = 'form:calif-0038'")
    cid = calificar_rapido(con, "form:calif-0038", {**FICHA, "urgencia": "alta"})
    assert all(a["calificacion_id"] != cid for a in avisos(con)["pendientes"])


def test_despues_de_confirmar_el_aviso_no_se_puede_volver_a_reservar(con):
    capturar(con, "form:calif-0039", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    cid = calificar_rapido(con, "form:calif-0039", {**FICHA, "urgencia": "alta"})
    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    # n8n reintenta el nodo después de confirmar: la misma ejecución ya no recibe "sí"
    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-1')", cid) is False


# Qué rol puede ejecutar cada función (True = puede). Si una migración futura cambia un permiso, esto avisa.
UUID = "gen_random_uuid()"
PERMISOS = {
    "prioridad_regla('{}'::jsonb, '{}'::jsonb)": (False, True, True),
    "mensaje_aporta('hola')": (False, True, True),
    "calificaciones_atrasadas()": (False, False, True),
    f"tomar_calificacion({UUID}, 'x')": (False, False, True),
    f"guardar_calificacion({UUID}, {UUID}, {UUID}, 'error', null, 'v', 0, 0, 0, 0)": (False, False, True),
    "avisos_prioritarios_pendientes()": (False, False, True),
    f"reservar_aviso_prioritario({UUID}, 'x')": (False, False, True),
    f"confirmar_aviso_prioritario({UUID}, 'x')": (False, False, True),
    "llamadas_ia_de_hoy()": (False, False, False),
    "vencer_calificaciones()": (False, False, False),
    "crear_calificacion('x', '{}'::jsonb, '{}'::jsonb, null, '{}')": (False, False, False),
    f"cambiar_prioridad({UUID}, 'alta')": (False, None, False),  # con sesión: lo decide la función
    # Migración 021
    "calificaciones_terminadas_mal()": (False, False, True),
    f"soltar_aviso_prioritario({UUID}, 'x')": (False, False, True),
}


def test_cada_funcion_solo_la_ejecuta_quien_debe(con):
    for llamada, permitidos in PERMISOS.items():
        for rol, puede in zip(("anon", "authenticated", "service_role"), permitidos, strict=True):
            if puede is None:
                continue
            con.execute(f"set local role {rol}")
            try:
                with con.transaction():
                    con.execute(f"select {llamada}")
                pudo = True
            except psycopg.errors.InsufficientPrivilege:
                pudo = False
            except psycopg.Error:
                pudo = True  # la ejecutó (y falló por los datos de mentira): el permiso sí lo tenía
            con.execute("reset role")
            assert pudo is puede, f"{rol} {'debería' if puede else 'no debería'} poder: {llamada}"


# --- Migración 021: ajustes para el flujo 08 ------------------------------------------------


def atrasadas(con):
    return como_servicio(con, "select calificaciones_atrasadas()")


def test_un_lead_que_nadie_ha_intentado_no_cuenta_como_atrasado(con):
    # Llegó de noche con el PC apagado: al prender, la primera vuelta no es una falla
    antes = atrasadas(con)
    capturar(con, "form:calif-0040", mensaje="Quiero paneles")
    con.execute("update calificaciones_lead set creada_en = now() - interval '9 hours' where clave = 'form:calif-0040'")
    assert atrasadas(con) == antes
    # Ya se intentó y Claude no respondió: ahí sí cuenta
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0040'")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    assert t["calificacion_id"] == str(calificacion(con, "form:calif-0040")["id"])
    guardar(con, t, pedido, resultado="error")
    # Un tropiezo recién ocurrido todavía no es un atraso (migración 022: se mide desde el primer intento)
    assert atrasadas(con) == antes
    con.execute(
        "update calificaciones_lead set primer_intento_en = now() - interval '31 minutes'"
        " where clave = 'form:calif-0040'"
    )
    assert atrasadas(con) == antes + 1


def terminadas_mal(con):
    return {t["calificacion_id"]: t for t in como_servicio(con, "select calificaciones_terminadas_mal()")}


def test_los_que_terminan_mal_se_listan_una_vez_con_su_codigo_de_error(con):
    capturar(con, "form:calif-0041", mensaje="Quiero paneles")
    pedido = uuid.uuid4()
    t = tomar(con, pedido)
    como_servicio(
        con,
        "select guardar_calificacion(%s, %s, %s, 'rechazo', null, 'v1', 900, 0, 0.0001, 900, 'cyber')",
        t["calificacion_id"],
        pedido,
        t["llamada_id"],
    )
    lista = terminadas_mal(con)
    assert lista[t["calificacion_id"]]["estado"] == "rechazada"
    assert lista[t["calificacion_id"]]["error"] == "cyber"
    # Una vencida también aparece; una que se cerró hace más de 24 horas, ya no
    capturar(con, "form:calif-0042", mensaje="Quiero paneles", telefono=OTRO_CELULAR, nombre="Otra Prueba")
    con.execute("update calificaciones_lead set creada_en = now() - interval '8 days' where clave = 'form:calif-0042'")
    con.execute("select vencer_calificaciones()")
    vencida = str(calificacion(con, "form:calif-0042")["id"])
    assert terminadas_mal(con)[vencida]["estado"] == "vencida"
    con.execute("update calificaciones_lead set cerrada_en = now() - interval '25 hours' where id = %s", (vencida,))
    assert vencida not in terminadas_mal(con)


def test_un_aviso_que_no_salio_se_suelta_y_vuelve_a_la_fila(con):
    capturar(con, "form:calif-0043", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    cid = calificar_rapido(con, "form:calif-0043", {**FICHA, "urgencia": "alta"})
    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert all(a["calificacion_id"] != cid for a in avisos(con)["pendientes"])
    # Otra ejecución no puede soltar lo que no reservó
    assert como_servicio(con, "select soltar_aviso_prioritario(%s, 'ejecucion-2')", cid) is False
    assert como_servicio(con, "select soltar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert any(a["calificacion_id"] == cid for a in avisos(con)["pendientes"])
    # Ya enviado, no se puede soltar
    assert como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-3')", cid) is True
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-3')", cid) is True
    assert como_servicio(con, "select soltar_aviso_prioritario(%s, 'ejecucion-3')", cid) is False


def test_confirmar_dos_veces_desde_la_misma_ejecucion_responde_si(con):
    capturar(con, "form:calif-0044", mensaje="Quiero paneles ya", consumo_kwh_mes=600)
    cid = calificar_rapido(con, "form:calif-0044", {**FICHA, "urgencia": "alta"})
    como_servicio(con, "select reservar_aviso_prioritario(%s, 'ejecucion-1')", cid)
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-1')", cid) is True
    assert como_servicio(con, "select confirmar_aviso_prioritario(%s, 'ejecucion-2')", cid) is False


# --- Migración 022: rechazos de configuración y primer intento -----------------------------


def guardar_con_error(con, tomada, pedido, codigo):
    return como_servicio(
        con,
        "select guardar_calificacion(%s, %s, %s, 'error', null, 'v1', 0, 0, 0, 300, %s)",
        tomada["calificacion_id"],
        pedido,
        tomada["llamada_id"],
        codigo,
    )


def test_un_rechazo_de_configuracion_no_gasta_los_intentos_del_lead(con):
    # Se acabó el saldo (o la llave está mala): esperar no lo arregla, lo arregla una persona
    capturar(con, "form:calif-0050", mensaje="Quiero paneles")
    for _ in range(12):  # más que los 8 intentos máximos
        con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0050'")
        pedido = uuid.uuid4()
        r = guardar_con_error(con, tomar(con, pedido), pedido, "http_400")
        assert r["estado"] == "por_calificar"
    c = calificacion(con, "form:calif-0050")
    assert c["estado"] == "por_calificar" and c["intentos"] == 0 and "mensaje" in c["entrada"]
    # Espera media hora antes del siguiente intento
    assert tomar(con)["estado"] == "nada"
    # Un 429 (demasiadas solicitudes) sí se arregla solo: cuenta como intento normal
    con.execute("update calificaciones_lead set proximo_intento_en = now() where clave = 'form:calif-0050'")
    pedido = uuid.uuid4()
    guardar_con_error(con, tomar(con, pedido), pedido, "http_429")
    assert calificacion(con, "form:calif-0050")["intentos"] == 1


def test_el_primer_intento_se_anota_una_sola_vez(con):
    capturar(con, "form:calif-0051", mensaje="Quiero paneles")
    pedido = uuid.uuid4()
    guardar(con, tomar(con, pedido), pedido, resultado="error")
    primero = con.execute(
        "select primer_intento_en from calificaciones_lead where clave = 'form:calif-0051'"
    ).fetchone()[0]
    assert primero is not None
    con.execute(
        "update calificaciones_lead set proximo_intento_en = now(), primer_intento_en = primer_intento_en"
        " - interval '1 hour' where clave = 'form:calif-0051'"
    )
    pedido = uuid.uuid4()
    guardar(con, tomar(con, pedido), pedido, resultado="error")
    segundo = con.execute(
        "select primer_intento_en from calificaciones_lead where clave = 'form:calif-0051'"
    ).fetchone()[0]
    assert segundo < primero  # no se movió con el segundo intento


# --- Dos pedidos a la vez --------------------------------------------------------------------


def test_dos_pedidos_a_la_vez_no_se_saltan_el_tope():
    # Con el cupo del día en 299, llegan dos pedidos al mismo tiempo y hay dos leads esperando: el turno
    # hace que uno tome el último cupo y el otro reciba "sin cupo". Sin el turno, los dos contarían 299.
    # Esta prueba sí guarda datos de verdad (las dos conexiones deben verlos) y los borra al final.
    import threading

    from conexion import conectar

    claves = ["form:calif-simultanea-0001", "form:calif-simultanea-0002"]
    relleno = []
    with conectar() as preparar:
        aplicadas = {n for (n,) in preparar.execute("select nombre from control.migraciones")}
        if "020_calificacion_de_leads.sql" not in aplicadas:
            pytest.skip("la migración 020 todavía no está aplicada")
        esperando = preparar.execute(
            "select count(*) from calificaciones_lead where estado in ('por_calificar', 'en_curso')"
        ).fetchone()[0]
        if esperando:
            pytest.skip("hay leads reales esperando su calificación: esta prueba se los quitaría")
        for celular in (CELULAR, OTRO_CELULAR):
            assert preparar.execute("select count(*) from contactos where telefono = %s", (celular,)).fetchone()[0] == 0
        capturar(preparar, claves[0], mensaje="Quiero paneles")
        capturar(preparar, claves[1], mensaje="Quiero paneles", telefono=OTRO_CELULAR, nombre="Otra Prueba")
        usadas = preparar.execute("select llamadas_ia_de_hoy()").fetchone()[0]
        relleno = [
            i
            for (i,) in preparar.execute(
                "insert into llamadas_ia (pieza, modelo, estado) select 'calificacion', 'relleno-prueba', 'ok'"
                " from generate_series(1, %s) returning id",
                (max(0, 299 - usadas),),
            )
        ]
        preparar.commit()
    try:
        resultados, salida = [], threading.Barrier(2)

        def pedir():
            with conectar() as con:
                con.execute("set role service_role")
                salida.wait()  # los dos salen a la vez
                resultados.append(
                    con.execute("select tomar_calificacion(%s, %s)", (uuid.uuid4(), MODELO)).fetchone()[0]["estado"]
                )
                con.commit()

        hilos = [threading.Thread(target=pedir) for _ in range(2)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(timeout=60)
        assert sorted(resultados) == ["sin_cupo", "tomada"]
    finally:
        with conectar() as limpiar:
            ids = [i for (i,) in limpiar.execute("select id from calificaciones_lead where clave = any(%s)", (claves,))]
            limpiar.execute("delete from llamadas_ia where referencia = any(%s) or id = any(%s)", (ids, relleno))
            limpiar.execute("delete from contactos where telefono in (%s, %s)", (CELULAR, OTRO_CELULAR))
            limpiar.execute("delete from envios_recibidos where clave = any(%s)", (claves,))
            limpiar.commit()
