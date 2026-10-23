"""Comprueba en la base de datos real de Supabase que cada rol ve solo lo que le corresponde.

La base de datos se hace pasar por cada usuario (como si hubiera iniciado sesión) dentro de una
transacción que al final se deshace: la prueba no cambia nada.

Necesita el .env con las llaves y los datos cargados con scripts/supabase/cargar_datos.py.
Si no hay .env, la prueba se salta.
"""

import json

import psycopg
import pytest
from conexion import RUTA_ENV

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


def lo_que_hay(con, consulta, *parametros):
    """Lo que hay de verdad en la base de datos, contado sin permisos (como administrador).
    Se compara contra lo que ve cada rol, así las pruebas siguen valiendo aunque el CRM se use."""
    resultado = con.execute(consulta, parametros).fetchone()[0]
    con.rollback()
    return resultado


def test_gerente_ve_todo(con, equipo):
    vistos = contar(con, equipo["U01"])
    assert vistos["contactos"] == lo_que_hay(con, "select count(*) from contactos")
    assert vistos["oportunidades"] == lo_que_hay(con, "select count(*) from oportunidades")


def test_cada_asesor_ve_solo_sus_contactos(con, equipo):
    vistos_en_total = 0
    for codigo in ("U02", "U03", "U04"):
        suyos = lo_que_hay(con, "select count(*) from contactos where asesor_id = %s", equipo[codigo])
        vistos = contar(con, equipo[codigo])["contactos"]
        assert vistos == suyos, codigo
        vistos_en_total += vistos
    # Entre los tres ven todos los contactos, y ninguno ve los de otro
    assert vistos_en_total == lo_que_hay(con, "select count(*) from contactos")


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
        # El embudo cuenta hasta dónde LLEGÓ cada venta, aunque después retroceda
        llegaron_a_ganado = con.execute(
            "select count(distinct oportunidad_id) from historial_etapas where etapa_nueva = 'ganado'"
        ).fetchone()[0]

    embudo = {e["etapa"]: e["ventas"] for e in panel["embudo"]}
    assert embudo["nuevo"] == total  # todas las ventas entran por "nuevo"
    assert embudo["ganado"] == llegaron_a_ganado
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


def _contacto_nuevo(asesor_id, telefono="+573009998877"):
    return json.dumps(
        {
            "tipo": "hogar",
            "nombre": "Cliente De Prueba",
            "telefono": telefono,
            "ciudad": "Bogotá",
            "estrato": 4,
            "consumo_kwh_mes": 300,
            "canal_origen": "web",
            "asesor_id": str(asesor_id),
        }
    )


VENTA_NUEVA = json.dumps({"nombre": "Sistema 3.3 kWp - Cliente De Prueba", "potencia_kwp": 3.3, "valor_cop": 14850000})


def test_crear_contacto_crea_tambien_su_venta_y_su_historial(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U02"])
        codigo = con.execute(
            "select crear_contacto_con_venta(%s::jsonb, %s::jsonb)", (_contacto_nuevo(equipo["U02"]), VENTA_NUEVA)
        ).fetchone()[0]
        venta = con.execute(
            """select o.etapa, o.asesor_id, h.etapa_nueva, h.cambiado_por
               from contactos c join oportunidades o on o.contacto_id = c.id
               join historial_etapas h on h.oportunidad_id = o.id
               where c.codigo = %s""",
            (codigo,),
        ).fetchall()
    assert codigo.startswith("C")
    assert venta == [("nuevo", equipo["U02"], "nuevo", equipo["U02"])]


def test_asesor_no_puede_crear_contactos_a_nombre_de_otro(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U02"])  # Andrés intenta crearlo a nombre de Valentina
        con.execute(
            "select crear_contacto_con_venta(%s::jsonb, %s::jsonb)", (_contacto_nuevo(equipo["U03"]), VENTA_NUEVA)
        )


def test_no_se_repiten_telefonos_aunque_el_contacto_sea_de_otro_asesor(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U03"])  # Valentina
        telefono_de_valentina = con.execute("select telefono from contactos limit 1").fetchone()[0]
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.UniqueViolation):
        como(con, equipo["U02"])  # Andrés no ve ese contacto, pero la base de datos sí
        con.execute(
            "select crear_contacto_con_venta(%s::jsonb, %s::jsonb)",
            (_contacto_nuevo(equipo["U02"], telefono_de_valentina), VENTA_NUEVA),
        )


def test_numeracion_de_cotizaciones_no_se_repite_entre_asesores(con, equipo):
    with con.transaction(force_rollback=True):
        # El año se calcula, no se escribe fijo: la prueba sigue valiendo en 2027
        anio = con.execute("select to_char(now() at time zone 'America/Bogota', 'YYYY')").fetchone()[0]
        mayor = con.execute(
            "select coalesce(max(split_part(numero, '-', 3)::int), 0) from cotizaciones where numero like %s",
            (f"COT-{anio}-%",),
        ).fetchone()[0]
        como(con, equipo["U04"])  # Camilo solo ve sus cotizaciones, que no tienen el número mayor
        opp_id = con.execute("select id from oportunidades where etapa = 'contactado' limit 1").fetchone()[0]
        primera = con.execute("select crear_cotizacion(%s, 300, 0)", (opp_id,)).fetchone()[0]
        segunda = con.execute("select crear_cotizacion(%s, 300, 5)", (opp_id,)).fetchone()[0]
        cotizaciones = con.execute(
            "select version, estado from cotizaciones where oportunidad_id = %s order by version", (opp_id,)
        ).fetchall()
        venta = con.execute("select etapa, valor_cop from oportunidades where id = %s", (opp_id,)).fetchone()
    assert primera == f"COT-{anio}-{mayor + 1:04d}"
    assert segunda == f"COT-{anio}-{mayor + 2:04d}"
    assert cotizaciones == [(1, "reemplazada"), (2, "enviada")]
    assert venta[0] == "cotizado"  # pasó sola de "contactado" a "cotizado"


def test_la_formula_de_la_base_de_datos_coincide_con_la_de_python():
    """Cientos de combinaciones: si alguna de las dos fórmulas cambia sin la otra, esto falla."""
    from conexion import conectar
    from reglas import CIUDADES, aplicar_descuento, cotizar

    casos = [(c, ciudad, d) for c in range(50, 6001, 37) for ciudad in CIUDADES for d in (0, 2.5, 5, 8, 30)]
    consumos, ciudades, descuentos = (list(columna) for columna in zip(*casos, strict=True))
    descuentos = [str(d) for d in descuentos]  # mezcla enteros y decimales: se envían como texto
    # Todos los casos en una sola consulta (uno por uno serían miles de viajes al servidor)
    with conectar() as conexion:
        filas = conexion.execute(
            """select r.num_paneles, r.precio_kwp, r.valor_total
               from unnest(%s::integer[], %s::ciudad[], %s::numeric[])
                    with ordinality as t(consumo, ciudad, descuento, n)
               cross join lateral calcular_cotizacion(t.consumo, t.ciudad, t.descuento) r
               order by t.n""",
            (consumos, ciudades, descuentos),
        ).fetchall()

    assert len(filas) == len(casos) > 2000
    for (consumo, ciudad, descuento), fila in zip(casos, filas, strict=True):
        esperado = cotizar(consumo, ciudad)
        assert fila == (
            esperado.num_paneles,
            esperado.precio_kwp,
            aplicar_descuento(esperado.valor_total, descuento),
        ), (consumo, ciudad, descuento)


# --- Intentos de abuso: alguien con sesión le habla a la base de datos sin pasar por la app ---


def test_nadie_puede_escribir_cotizaciones_directamente(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U02"])
        con.execute("update cotizaciones set numero = 'COT-2026-x'")
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U02"])
        opp_id = con.execute("select id from oportunidades limit 1").fetchone()[0]
        con.execute(
            """insert into cotizaciones (numero, oportunidad_id, consumo_kwh_mes, potencia_kwp, num_paneles,
               precio_kwp, valor_total) values ('COT-1', %s, 300, 3.3, 6, 1, 1)""",
            (opp_id,),
        )


def test_no_se_puede_cotizar_la_venta_de_otro_asesor(con, equipo):
    with con.transaction(force_rollback=True):
        opp_ajena = con.execute(
            "select id from oportunidades where asesor_id = %s and etapa = 'contactado' limit 1", (equipo["U03"],)
        ).fetchone()[0]
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U02"])  # Andrés intenta cotizar una venta de Valentina
        con.execute("select crear_cotizacion(%s, 300, 0)", (opp_ajena,))


def test_no_se_aceptan_descuentos_mayores_a_30(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InvalidParameterValue):
        como(con, equipo["U01"])
        opp_id = con.execute("select id from oportunidades where etapa = 'contactado' limit 1").fetchone()[0]
        con.execute("select crear_cotizacion(%s, 300, 100)", (opp_id,))


def test_asesor_no_puede_cambiar_el_valor_de_una_venta(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U02"])
        con.execute("update oportunidades set valor_cop = 1 where asesor_id = %s", (equipo["U02"],))


def test_tecnico_no_puede_cambiar_el_cliente_de_una_visita(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.InsufficientPrivilege):
        como(con, equipo["U05"])
        con.execute("update actividades set contacto_id = gen_random_uuid() where usuario_id = %s", (equipo["U05"],))


def test_tecnico_si_puede_marcar_sus_visitas(con, equipo):
    with con.transaction(force_rollback=True):
        como(con, equipo["U05"])
        marcadas = con.execute(
            "update actividades set completada = true where usuario_id = %s and not completada", (equipo["U05"],)
        ).rowcount
    assert marcadas > 0


def test_no_se_puede_perder_una_venta_sin_motivo(con, equipo):
    with con.transaction(force_rollback=True), pytest.raises(psycopg.errors.CheckViolation):
        como(con, equipo["U01"])
        con.execute("update oportunidades set etapa = 'perdido' where etapa = 'cotizado'")
