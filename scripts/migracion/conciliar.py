"""Paso 4 de la migración (la decisión): qué hacer con cada persona del Excel frente al CRM.

Aquí no se toca la base de datos: se arma un plan. Guardarlo es trabajo de migrar.py.

Cada persona se compara con los contactos del CRM con la misma función `comparar` del paso 3:
una persona del Excel y un contacto del CRM se comparan igual que dos filas del Excel.
- Una sola coincidencia segura y ninguna duda: es ese contacto. Se completa lo que el CRM
  tenga vacío (nunca se sobrescribe: el CRM es más reciente que el Excel) y las notas pasan a
  actividades.
- Ninguna coincidencia: es nueva. Se crea solo si tiene todo lo que el CRM exige.
- Lo demás va a revisión.
"""

import re
from dataclasses import dataclass, field

from duplicados import SEGURO, Persona, comparar, contradicciones
from normalizar import ContactoLimpio

PREFIJO_NOTA = "Nota del Excel heredado: "

# Lo que el CRM exige para crear un contacto (columnas "not null" de la tabla contactos)
# y el consumo, que el formulario del CRM también exige porque con él se estima el valor de la venta
OBLIGATORIOS_PARA_CREAR = ["tipo", "telefono", "ciudad", "asesor", "canal_origen", "consumo_kwh_mes"]

# Campos que, si el CRM los tiene vacíos, se pueden completar con lo que dice el Excel:
# campo de la persona → columna del CRM
COMPLETABLES = {"correo": "email", "consumo_kwh_mes": "consumo_kwh_mes", "empresa": "empresa"}

# Campos que se comparan para reportar diferencias (nunca se cambian)
COMPARABLES = {
    "telefono": "telefono", "correo": "email", "ciudad": "ciudad",
    "tipo": "tipo", "asesor": "asesor", "consumo_kwh_mes": "consumo_kwh_mes",
}  # fmt: skip


@dataclass
class ContactoCRM(ContactoLimpio):
    """Un contacto que ya está en el CRM, en el mismo formato que una fila limpia del Excel."""

    id: str = ""  # el uuid de la base de datos
    codigo: str = ""  # C0153
    notas_existentes: set[str] = field(default_factory=set)  # descripciones de sus notas


@dataclass
class Existente:
    persona: Persona
    contacto: ContactoCRM
    completar: dict[str, object]  # columna del CRM → valor
    notas_nuevas: list[str]
    diferencias: list[tuple[str, object, object]]  # (campo, en el Excel, en el CRM)


@dataclass
class Nueva:
    persona: Persona
    canal_origen: str


@dataclass
class EnRevision:
    persona: Persona
    razon: str


@dataclass
class Plan:
    existentes: list[Existente] = field(default_factory=list)
    nuevas: list[Nueva] = field(default_factory=list)
    revision: list[EnRevision] = field(default_factory=list)


def como_fila(persona: Persona) -> ContactoLimpio:
    """La persona unificada en el formato que entiende `comparar`."""
    return ContactoLimpio(
        hoja="Excel",
        fila=0,
        nombre=persona.nombre,
        empresa=persona.empresa,
        tipo=persona.tipo,
        telefono=persona.telefono,
        correo=persona.correo,
        ciudad=persona.ciudad,
        consumo_kwh_mes=persona.consumo_kwh_mes,
        asesor=persona.asesor,
        fecha_contacto=persona.fecha_contacto,
        etapa=persona.etapa,
        notas=None,
    )


def canal_de_origen(persona: Persona) -> str | None:
    """El Excel no tiene columna de canal; solo se sabe cuando una nota dice "Referido por ..."."""
    if any(re.match(r"referid[oa] por\b", nota, re.IGNORECASE) for nota in persona.notas):
        return "referido"
    return None


def comparten_dato(a: ContactoLimpio, b: ContactoLimpio) -> bool:
    return (a.telefono is not None and a.telefono == b.telefono) or (a.correo is not None and a.correo == b.correo)


def describir_crm(c: ContactoCRM) -> str:
    return f"{c.codigo} {c.nombre}"


def decidir(persona: Persona, crm: list[ContactoCRM]) -> Existente | Nueva | EnRevision:
    if "pendiente_de_revision" in persona.problemas:
        return EnRevision(persona, "sus filas del Excel tienen una duda sin resolver (paso 3)")

    fila = como_fila(persona)
    seguros, dudosos = [], []
    for contacto in crm:
        coincidencia = comparar(fila, contacto)
        if coincidencia is None:
            continue
        (seguros if coincidencia.nivel == SEGURO else dudosos).append((contacto, coincidencia.razon))

    if len(seguros) == 1 and not dudosos:
        return existente(persona, seguros[0][0])
    # Si una sola coincidencia comparte teléfono o correo, esa gana. Un homónimo (mismo nombre,
    # algún dato que se contradice y ni teléfono ni correo en común) no es una duda: los datos ya
    # dicen que es otra persona. Si comparte el teléfono o el correo, sí lo es.
    por_dato = [c for c, _ in seguros if comparten_dato(fila, c)]
    homonimos = [c for c, _ in dudosos if contradicciones(fila, c) and not comparten_dato(fila, c)]
    if len(por_dato) == 1 and len(seguros) == 1 and len(homonimos) == len(dudosos):
        return existente(persona, por_dato[0])
    if seguros or dudosos:
        candidatos = "; ".join(f"{describir_crm(c)} ({razon})" for c, razon in seguros + dudosos)
        return EnRevision(persona, f"se parece a más de un contacto del CRM o hay dudas: {candidatos}")

    canal = canal_de_origen(persona)
    faltan = [
        campo
        for campo in OBLIGATORIOS_PARA_CREAR
        if (canal if campo == "canal_origen" else getattr(persona, campo)) is None
    ]
    if persona.nombre is None and persona.empresa is None:
        faltan.insert(0, "nombre")
    if faltan:
        return EnRevision(persona, f"no está en el CRM y le falta {', '.join(faltan)} para crearla")
    return Nueva(persona, canal)


def existente(persona: Persona, contacto: ContactoCRM) -> Existente:
    completar = {
        columna: getattr(persona, campo)
        for campo, columna in COMPLETABLES.items()
        if getattr(contacto, campo) is None and getattr(persona, campo) is not None
    }
    if contacto.tipo != "negocio":  # el CRM no acepta empresa en un hogar
        completar.pop("empresa", None)
    diferencias = [
        (campo, getattr(persona, campo), getattr(contacto, campo))
        for campo in COMPARABLES
        if getattr(persona, campo) is not None
        and getattr(contacto, campo) is not None
        and getattr(persona, campo) != getattr(contacto, campo)
    ]
    # Idempotencia: una nota que ya está en el CRM no se vuelve a guardar
    notas_nuevas = [PREFIJO_NOTA + n for n in persona.notas if PREFIJO_NOTA + n not in contacto.notas_existentes]
    return Existente(persona, contacto, completar, notas_nuevas, diferencias)


def planear(personas: list[Persona], crm: list[ContactoCRM]) -> Plan:
    plan = Plan()
    for persona in personas:
        decision = decidir(persona, crm)
        if isinstance(decision, Existente):
            plan.existentes.append(decision)
        elif isinstance(decision, Nueva):
            plan.nuevas.append(decision)
        else:
            plan.revision.append(decision)
    return plan
