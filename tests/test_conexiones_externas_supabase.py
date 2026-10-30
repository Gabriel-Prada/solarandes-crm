"""Comprueba en la base de datos real que las conexiones de afuera solo leen (fase 5, migración 023).

Una "conexión de afuera" es una llave que Supabase le entregó a una app conectada (Claude, por OAuth):
trae la marca client_id. Con ella se puede leer lo que su dueño ve, pero no insertar, cambiar ni borrar,
aunque el dueño sea la gerente. Ver docs/plan-fase-5.md, sección 4.

Cada prueba corre dentro de una transacción que al final se deshace: no queda nada guardado.
Si la migración todavía no está aplicada, la prueba la carga dentro de esa misma transacción.
Necesita el .env con las llaves. Si no hay .env, la prueba se salta.
"""

import json
import uuid

import psycopg
import pytest
from conexion import RAIZ, RUTA_ENV

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

APP = "app-de-prueba-fase-5"
GERENTE, ASESOR = "U01", "U02"

# Cada función con permiso propio (se salta RLS) que una sesión puede ejecutar, con lo que hace.
# "frenada": escribe, así que rechaza las conexiones de afuera.
# "lista blanca": escribe y deja pasar a una app solo si está aprobada y es de la gerente, con tope y
# registro (migración 024; su comportamiento se prueba en tests/test_acciones_supabase.py).
# Si aparece una nueva, hay que decidir.
FUNCIONES_CON_PERMISO_PROPIO = {
    "mi_rol": "solo lee",
    "es_mi_contacto": "solo lee",
    "es_mi_oportunidad": "solo lee",
    "mi_app_esta_aprobada": "solo lee",
    "crear_cotizacion": "frenada",
    "cambiar_prioridad": "frenada",
    "aprobar_app": "frenada",
    "registrar_actividad": "lista blanca",
    "mover_venta": "lista blanca",
    "agendar_visita": "lista blanca",
}

# Vistas que leen con el permiso de su dueño (se saltan RLS). Solo dejan leer.
VISTAS_CON_PERMISO_PROPIO = {"visitas_tecnico": "solo lee y filtra por quien pregunta"}


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
    persona = id_de(con, codigo)
    claims = {"sub": str(persona), "role": "authenticated"}
    if app:
        claims["client_id"] = app
    con.execute("set local role authenticated")
    con.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))


def como_admin(con):
    con.execute("reset role")
    con.execute("select set_config('request.jwt.claims', '', true)")


def rechazada(con, consulta, *parametros):
    """La consulta debe fallar por permisos. Corre en un punto de guardado para seguir después."""
    with pytest.raises(psycopg.errors.InsufficientPrivilege) as error:
        with con.transaction():
            con.execute(consulta, parametros)
    return str(error.value)


def test_app_conectada_lee_lo_mismo_que_su_duena(con):
    como(con, GERENTE)
    normal = con.execute("select count(*) from contactos").fetchone()[0]
    como(con, GERENTE, app=APP)
    externa = con.execute("select count(*) from contactos").fetchone()[0]
    assert normal == externa > 0


def filas_tocadas(con, consulta, *parametros):
    """Corre la orden en un punto de guardado que se deshace y dice cuántas filas tocó."""
    with con.transaction(force_rollback=True):
        return con.execute(consulta, parametros).rowcount


def test_app_conectada_no_cambia_ni_borra_aunque_la_gerente_si_pueda(con):
    contacto = con.execute("select id from contactos order by codigo limit 1").fetchone()[0]
    actividad = con.execute("select id from actividades limit 1").fetchone()[0]
    venta = con.execute("select id from oportunidades where etapa <> 'perdido' order by codigo limit 1").fetchone()[0]
    producto = con.execute("select sku from productos limit 1").fetchone()[0]
    ordenes = [
        ("update contactos set nombre = 'Cambiado' where id = %s", contacto),
        ("delete from contactos where id = %s", contacto),
        ("delete from actividades where id = %s", actividad),
        ("update actividades set completada = not completada where id = %s", actividad),
        ("update oportunidades set etapa = 'perdido', motivo_perdida = 'precio' where id = %s", venta),
        ("delete from oportunidades where id = %s", venta),
        ("update perfiles set rol = 'gerente' where codigo = %s", ASESOR),
        ("delete from productos where sku = %s", producto),
    ]
    for consulta, parametro in ordenes:
        # Con su sesión normal la gerente sí puede: así se sabe que el 0 de abajo viene de la 023
        como(con, GERENTE)
        assert filas_tocadas(con, consulta, parametro) == 1, consulta
        # Con la llave de una app conectada, las reglas restrictivas esconden la fila: no toca nada
        como(con, GERENTE, app=APP)
        assert filas_tocadas(con, consulta, parametro) == 0, consulta


def test_app_conectada_no_inserta(con):
    contacto = con.execute("select id from contactos limit 1").fetchone()[0]
    gerente = id_de(con, GERENTE)
    ordenes = [
        (
            "insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha)"
            " values (%s, %s, 'nota', 'x', now())",
            (contacto, gerente),
        ),
        (
            "insert into contactos (tipo, nombre, telefono, ciudad, canal_origen, asesor_id)"
            " values ('hogar', 'X', '+573009990199', 'Cali', 'web', %s)",
            (gerente,),
        ),
        ("insert into productos (sku, nombre, categoria, precio_cop) values ('X-1', 'X', 'panel', 1)", ()),
    ]
    for consulta, parametros in ordenes:
        como(con, GERENTE)
        assert filas_tocadas(con, consulta, *parametros) == 1, consulta
        como(con, GERENTE, app=APP)
        # El error nombra la regla de la 023: no es otra regla la que lo frena
        assert "apps conectadas no insertan" in rechazada(con, consulta, *parametros), consulta


def test_las_funciones_que_escriben_rechazan_a_las_apps(con):
    venta = con.execute("select id from oportunidades where etapa not in ('ganado', 'perdido') limit 1").fetchone()[0]
    como(con, GERENTE, app=APP)
    assert "solo pueden leer" in rechazada(con, "select crear_cotizacion(%s, 300, 0)", venta)
    assert "solo pueden leer" in rechazada(con, "select cambiar_prioridad(%s, 'alta')", uuid.uuid4())
    assert "solo pueden leer" in rechazada(con, "select aprobar_app('otra-app', 'X', 'evil.com')")


def test_crear_cotizacion_sigue_funcionando_en_el_crm(con):
    venta = con.execute("select id from oportunidades where etapa not in ('ganado', 'perdido') limit 1").fetchone()[0]
    como(con, GERENTE)
    numero = con.execute("select crear_cotizacion(%s, 300, 0)", (venta,)).fetchone()[0]
    assert numero.startswith("COT-")


def test_toda_tabla_donde_una_sesion_escribe_tiene_su_candado(con):
    """No depende de una lista: recorre las tablas donde 'authenticated' puede escribir."""
    permisos = con.execute(
        """
        select c.relname, c.relkind, c.relrowsecurity,
               -- "alguna columna" también cuenta los permisos de una sola columna (actividades, oportunidades)
               has_any_column_privilege('authenticated', c.oid, 'INSERT'),
               has_any_column_privilege('authenticated', c.oid, 'UPDATE'),
               has_table_privilege('authenticated', c.oid, 'DELETE')
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
        """
    ).fetchall()
    candados = {
        (tabla, comando)
        for tabla, comando in con.execute(
            "select tablename, cmd from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'"
            " and 'authenticated' = any(roles) and policyname like 'apps conectadas %%'"
        ).fetchall()
    }
    faltan = []
    for tabla, tipo, con_rls, inserta, cambia, borra in permisos:
        if not (inserta or cambia or borra):
            continue
        # Una vista que deja escribir, o una tabla sin RLS, no tiene dónde poner la regla
        if tipo not in ("r", "p") or not con_rls:
            faltan.append(f"{tabla}: deja escribir sin RLS")
            continue
        for comando, puede in (("INSERT", inserta), ("UPDATE", cambia), ("DELETE", borra)):
            if puede and (tabla, comando) not in candados:
                faltan.append(f"{tabla}: {comando}")
    assert not faltan, f"Tablas donde una app conectada podría escribir: {faltan}"


def test_toda_funcion_con_permiso_propio_esta_clasificada(con):
    """No depende de acordarse: falla si aparece una función que se salta RLS y nadie la clasificó."""
    encontradas = {
        nombre
        for (nombre,) in con.execute(
            """
            select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
            """
        ).fetchall()
    }
    assert encontradas == set(FUNCIONES_CON_PERMISO_PROPIO), (
        "Clasifica cada función nueva (solo lee, frenada o lista blanca) en FUNCIONES_CON_PERMISO_PROPIO"
    )


def test_solo_una_vista_se_salta_rls_y_solo_deja_leer(con):
    vistas = {
        nombre
        for (nombre,) in con.execute(
            """
            select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('v', 'm')
              and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)
              and has_table_privilege('authenticated', c.oid, 'SELECT')
            """
        ).fetchall()
    }
    assert vistas == set(VISTAS_CON_PERMISO_PROPIO)


def test_solo_la_gerente_aprueba_apps_y_cada_app_solo_ve_si_ella_esta_aprobada(con):
    como(con, ASESOR)
    rechazada(con, "select aprobar_app(%s, 'Claude', 'claude.ai')", APP)

    como(con, GERENTE)
    con.execute("select aprobar_app(%s, 'Claude', 'claude.ai')", (APP,))
    assert con.execute("select count(*) from apps_conectadas").fetchone()[0] >= 1

    como(con, GERENTE, app=APP)
    assert con.execute("select mi_app_esta_aprobada()").fetchone()[0] is True
    como(con, GERENTE, app="otra-app-sin-aprobar")
    assert con.execute("select mi_app_esta_aprobada()").fetchone()[0] is False

    # Un asesor no ve la lista de apps conectadas
    como(con, ASESOR)
    assert con.execute("select count(*) from apps_conectadas").fetchone()[0] == 0


def test_un_visitante_anonimo_no_ejecuta_las_funciones_de_permisos(con):
    for funcion in [
        "mi_rol()",
        "es_mi_contacto(uuid)",
        "es_mi_oportunidad(uuid)",
        "sin_tildes(text)",
        "en_carga_masiva()",
        "es_conexion_externa()",
        "mi_app_esta_aprobada()",
        "aprobar_app(text, text, text)",
    ]:
        assert con.execute("select has_function_privilege('anon', %s, 'EXECUTE')", (funcion,)).fetchone()[0] is False, (
            funcion
        )
