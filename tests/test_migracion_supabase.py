"""Prueba la carga del paso 4 en la base de datos real de Supabase, sin cambiar nada.

Todo pasa dentro de una transacción que al final se deshace, como en test_permisos_supabase.py.
Las pruebas no dependen de que la migración real ya se haya aplicado o no: usan una nota y un
contacto de prueba propios.

Un detalle: deshacer la transacción no devuelve los contadores de códigos de Postgres (las
secuencias), así que cada corrida "gasta" un código C#### y uno O####. No se pierden datos;
solo quedan huecos en la numeración.

Necesita el .env; si no hay, la prueba se salta.
"""

import psycopg
import pytest
from conciliar import PREFIJO_NOTA, Existente, Nueva, Plan
from conexion import RUTA_ENV
from duplicados import Persona
from migrar import aplicar, aplicar_existente, armar_plan

pytestmark = pytest.mark.skipif(not RUTA_ENV.exists(), reason="sin .env no hay base de datos a la cual conectarse")

NOTA_DE_PRUEBA = "prueba automática, se deshace al terminar"


@pytest.fixture(scope="module")
def con():
    from conexion import conectar

    with conectar() as conexion:
        yield conexion


def persona_de_prueba(**campos) -> Persona:
    base = dict(
        nombre="Prueba Migración", empresa=None, tipo="hogar", telefono="+573009990001", correo=None,
        ciudad="Cali", consumo_kwh_mes=300, asesor="U04", fecha_contacto=None, etapa=None,
        notas=[NOTA_DE_PRUEBA], filas=[("Prueba", 1)],
    )  # fmt: skip
    return Persona(**(base | campos))


def un_existente(plan: Plan) -> Existente:
    """Un contacto real del CRM con una nota de prueba por guardar (sirva o no ya la migración)."""
    e = plan.existentes[0]
    return Existente(e.persona, e.contacto, completar={}, notas_nuevas=[PREFIJO_NOTA + NOTA_DE_PRUEBA], diferencias=[])


def notas_migradas(con) -> list[tuple]:
    return con.execute(
        """select a.descripcion, a.usuario_id, c.asesor_id from actividades a join contactos c on c.id = a.contacto_id
           where a.tipo = 'nota' and a.descripcion like %s""",
        (PREFIJO_NOTA + "%",),
    ).fetchall()


def test_guardar_dos_veces_no_duplica_y_cada_nota_queda_a_nombre_del_asesor(con):
    with con.transaction(force_rollback=True):
        plan, asesores = armar_plan(con)
        plan.existentes.append(un_existente(plan))  # así siempre hay algo por guardar
        antes = len(notas_migradas(con))
        aplicar(con, plan, asesores)

        notas = notas_migradas(con)
        assert len(notas) == antes + sum(len(e.notas_nuevas) for e in plan.existentes)
        assert any(descripcion.endswith(NOTA_DE_PRUEBA) for descripcion, _, _ in notas)
        assert all(usuario == asesor for _, usuario, asesor in notas)

        segundo, _ = armar_plan(con)  # como si se corriera otra vez
        assert sum(len(e.notas_nuevas) for e in segundo.existentes) == 0
        assert sum(len(e.completar) for e in segundo.existentes) == 0


def test_una_persona_nueva_se_crea_con_su_venta_por_la_misma_puerta_que_la_app(con):
    with con.transaction(force_rollback=True):
        _, asesores = armar_plan(con)
        [codigo] = aplicar(con, Plan(nuevas=[Nueva(persona_de_prueba(), "referido")]), asesores)
        contacto = con.execute(
            """select c.asesor_id::text, c.canal_origen::text, count(distinct o.id), count(distinct a.id)
               from contactos c join oportunidades o on o.contacto_id = c.id
               join actividades a on a.contacto_id = c.id where c.codigo = %s
               group by c.asesor_id, c.canal_origen""",
            (codigo,),
        ).fetchone()
        assert contacto == (asesores["U04"], "referido", 1, 1)


def test_la_base_de_datos_no_deja_escribir_en_un_cliente_ajeno(con):
    """Si por error el script se hiciera pasar por otro asesor, RLS lo detiene."""
    with con.transaction(force_rollback=True):
        plan, asesores = armar_plan(con)
        e = un_existente(plan)
        otro = next(codigo for codigo in ("U02", "U03", "U04") if codigo != e.contacto.asesor)
        with pytest.raises(psycopg.errors.InsufficientPrivilege), con.transaction():
            aplicar_existente(con, e, asesores[otro])


def test_si_algo_falla_a_la_mitad_no_queda_nada_guardado(con):
    with con.transaction(force_rollback=True):
        plan, asesores = armar_plan(con)
        antes = len(notas_migradas(con))
        # Un existente válido y después una persona nueva con un teléfono que el CRM no acepta
        malo = Plan(existentes=[un_existente(plan)], nuevas=[Nueva(persona_de_prueba(telefono="123"), "referido")])
        with pytest.raises(psycopg.Error):
            aplicar(con, malo, asesores)
        assert len(notas_migradas(con)) == antes  # la nota del existente válido tampoco quedó
