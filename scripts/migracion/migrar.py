"""Migra el Excel heredado al CRM: lee, normaliza, une duplicados, concilia y (si se pide) guarda.

Uso:
    .venv/Scripts/python scripts/migracion/migrar.py            ensayo: muestra qué haría, no guarda nada
    .venv/Scripts/python scripts/migracion/migrar.py --aplicar  guarda, en una sola transacción

La migración entra por la misma puerta que la app: para cada cliente, la base de datos se hace
pasar por su asesor, así que se aplican las mismas reglas de permisos (RLS) y cada nota queda a
su nombre. Correrla dos veces no duplica nada: las notas que ya están se saltan.
"""

import json
import sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / d) for d in ("supabase", "datos")]

import psycopg  # noqa: E402
from conciliar import PREFIJO_NOTA, ContactoCRM, Existente, Nueva, Plan, planear  # noqa: E402
from conexion import conectar  # noqa: E402
from duplicados import Persona, deduplicar  # noqa: E402
from leer_excel import leer_excel  # noqa: E402
from normalizar import normalizar  # noqa: E402
from reglas import cotizar  # noqa: E402

BOGOTA = ZoneInfo("America/Bogota")


def leer_crm(con: psycopg.Connection) -> tuple[list[ContactoCRM], dict[str, str]]:
    """Los contactos del CRM y {código del asesor (U02) → id del perfil}. Se lee como administrador."""
    asesores = dict(con.execute("select codigo, id::text from perfiles").fetchall())
    codigo_de = {v: k for k, v in asesores.items()}
    notas: dict[str, set[str]] = {}
    for contacto_id, descripcion in con.execute(
        "select contacto_id::text, descripcion from actividades where tipo = 'nota' and descripcion like %s",
        (PREFIJO_NOTA + "%",),
    ):
        notas.setdefault(contacto_id, set()).add(descripcion)
    contactos = [
        ContactoCRM(
            hoja="CRM",
            fila=0,
            nombre=nombre,
            empresa=empresa,
            tipo=tipo,
            telefono=telefono,
            correo=email,
            ciudad=ciudad,
            consumo_kwh_mes=consumo,
            asesor=codigo_de.get(asesor_id),
            fecha_contacto=None,
            etapa=None,
            notas=None,
            id=id_,
            codigo=codigo,
            notas_existentes=notas.get(id_, set()),
        )  # fmt: skip
        for id_, codigo, nombre, empresa, tipo, telefono, email, ciudad, consumo, asesor_id in con.execute(
            """select id::text, codigo, nombre, empresa, tipo::text, telefono, email, ciudad::text,
                      consumo_kwh_mes, asesor_id::text
               from contactos order by codigo"""
        )
    ]
    return contactos, asesores


def armar_plan(con: psycopg.Connection) -> tuple[Plan, dict[str, str]]:
    personas, _ = deduplicar([normalizar(f) for f in leer_excel()])
    crm, asesores = leer_crm(con)
    return planear(personas, crm), asesores


def como(con: psycopg.Connection, perfil_id: str) -> None:
    """Dentro de la transacción, la base de datos cree que este usuario inició sesión."""
    con.execute("set local role authenticated")
    claims = json.dumps({"sub": perfil_id, "role": "authenticated"})
    con.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def fecha_de_nota(persona: Persona) -> datetime:
    """El día en que el asesor anotó al cliente en el Excel; si no se sabe, ahora."""
    if persona.fecha_contacto:
        return datetime.combine(persona.fecha_contacto, time(12), BOGOTA)
    return datetime.now(BOGOTA)


def aplicar_existente(con: psycopg.Connection, e: Existente, asesor_id: str) -> None:
    como(con, asesor_id)
    if e.completar:
        # coalesce deja lo que haya: si alguien llenó el dato desde la app mientras tanto, no se pisa
        columnas = ", ".join(f"{c} = coalesce({c}, %s)" for c in e.completar)
        con.execute(f"update contactos set {columnas} where id = %s", (*e.completar.values(), e.contacto.id))
    for descripcion in e.notas_nuevas:
        con.execute(
            """insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha, completada)
               values (%s, %s, 'nota', %s, %s, true)""",
            (e.contacto.id, asesor_id, descripcion, fecha_de_nota(e.persona)),
        )


def aplicar_nueva(con: psycopg.Connection, n: Nueva, asesor_id: str) -> str:
    """Crea el contacto y su primera venta con la misma función que usa el formulario del CRM."""
    p = n.persona
    como(con, asesor_id)
    estimado = cotizar(p.consumo_kwh_mes, p.ciudad)  # el consumo es obligatorio para crear (conciliar.py)
    contacto = {
        "tipo": p.tipo, "nombre": p.nombre or p.empresa, "empresa": p.empresa if p.tipo == "negocio" else "",
        "telefono": p.telefono, "email": p.correo or "", "ciudad": p.ciudad, "direccion": "", "estrato": None,
        "consumo_kwh_mes": p.consumo_kwh_mes, "canal_origen": n.canal_origen, "asesor_id": asesor_id,
    }  # fmt: skip
    venta = {
        "nombre": f"Sistema {estimado.potencia_instalada_kwp} kWp - {p.empresa or p.nombre}",
        "potencia_kwp": estimado.potencia_instalada_kwp,
        "valor_cop": estimado.valor_total,
    }
    codigo = con.execute(
        "select crear_contacto_con_venta(%s::jsonb, %s::jsonb)", (json.dumps(contacto), json.dumps(venta))
    ).fetchone()[0]
    for nota in p.notas:
        con.execute(
            """insert into actividades (contacto_id, usuario_id, tipo, descripcion, fecha, completada)
               select id, %s, 'nota', %s, %s, true from contactos where codigo = %s""",
            (asesor_id, PREFIJO_NOTA + nota, fecha_de_nota(p), codigo),
        )
    return codigo


def aplicar(con: psycopg.Connection, plan: Plan, asesores: dict[str, str]) -> list[str]:
    """Guarda todo el plan en una sola transacción: si algo falla, no queda nada a medias."""
    creados = []
    # pipeline: las consultas se mandan en fila sin esperar cada respuesta (muchos menos viajes)
    with con.transaction(), con.pipeline():
        for e in plan.existentes:
            if e.completar or e.notas_nuevas:  # a los que no tienen nada nuevo no hay que visitarlos
                # El dueño del cliente lo dice el CRM, no el Excel
                aplicar_existente(con, e, asesores[e.contacto.asesor])
        for n in plan.nuevas:
            creados.append(aplicar_nueva(con, n, asesores[n.persona.asesor]))
        # "set local" dura hasta el final de la transacción más externa; si esta va dentro de otra
        # (como en las pruebas), la conexión seguiría haciéndose pasar por el último asesor
        con.execute("reset role")
    return creados


def resumen(plan: Plan) -> str:
    notas = sum(len(e.notas_nuevas) for e in plan.existentes)
    completados = sum(len(e.completar) for e in plan.existentes)
    diferencias = [d for e in plan.existentes for d in e.diferencias]
    lineas = [
        f"Personas del Excel ya en el CRM: {len(plan.existentes)}",
        f"  notas por pasar a actividades: {notas}",
        f"  datos vacíos del CRM por completar: {completados}",
        f"  diferencias entre el Excel y el CRM (no se cambian): {len(diferencias)}",
        f"Personas nuevas por crear: {len(plan.nuevas)}",
        f"Personas en revisión: {len(plan.revision)}",
    ]
    for r in plan.revision:
        lineas.append(f"  - {r.persona.nombre or r.persona.empresa} {r.persona.filas}: {r.razon}")
    if diferencias:
        lineas.append("Diferencias:")
    for e in plan.existentes:
        for campo, en_excel, en_crm in e.diferencias:
            lineas.append(f"  ≠ {e.contacto.codigo} {campo}: Excel={en_excel!r}, CRM={en_crm!r}")
    return "\n".join(lineas)


def main(argumentos: list[str]) -> None:
    aplicar_cambios = "--aplicar" in argumentos
    with conectar() as con:
        plan, asesores = armar_plan(con)
        con.rollback()  # solo se leyó: se cierra la transacción de lectura
        print(resumen(plan))
        if not aplicar_cambios:
            print("\nEnsayo: no se guardó nada. Para guardar: migrar.py --aplicar")
            return
        creados = aplicar(con, plan, asesores)
        print(f"\nGuardado. Contactos creados: {', '.join(creados) or 'ninguno'}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
