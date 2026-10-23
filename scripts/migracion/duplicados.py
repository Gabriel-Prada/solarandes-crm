"""Paso 3 de la migración: decidir qué filas son la misma persona y unirlas en una sola ficha.

Cada pareja de filas se compara y queda en uno de tres niveles:
- "seguro": se unen solas (comparten teléfono o correo, o el mismo nombre y la misma ciudad, y
  nada se contradice).
- "revision": hay indicios pero no bastan; una persona decide.
- sin coincidencia.

Una contradicción (dos teléfonos, correos, empresas o ciudades distintos) impide unir en
automático: en este Excel ninguna pareja verdadera tiene dos teléfonos distintos, mientras que
"David Sánchez" y "David Sánchez Gómez" son personas diferentes y el teléfono lo delata.

Se compara cada fila con todas las demás (unas 53.000 parejas para 327 filas). Con cientos de
miles de filas convendría comparar solo dentro de "bloques" (mismo teléfono, mismo correo o
mismas iniciales), pero aquí no hace falta.
"""

from dataclasses import dataclass, field
from datetime import date
from itertools import combinations

from leer_excel import simplificar
from normalizar import ContactoLimpio

SEGURO = "seguro"
REVISION = "revision"

CAMPOS_QUE_DEBERIAN_ESTAR = [
    "tipo", "telefono", "correo", "ciudad", "consumo_kwh_mes", "asesor", "fecha_contacto", "etapa",
]  # fmt: skip


@dataclass
class Coincidencia:
    nivel: str  # seguro | revision
    razon: str  # en palabras, para la lista de revisión y el reporte


@dataclass
class ParejaEnRevision:
    a: ContactoLimpio
    b: ContactoLimpio
    razon: str


@dataclass
class Persona:
    """Una persona del Excel después de unir sus filas repetidas."""

    nombre: str | None
    empresa: str | None
    tipo: str | None
    telefono: str | None
    correo: str | None
    ciudad: str | None
    consumo_kwh_mes: int | None
    asesor: str | None
    fecha_contacto: date | None  # la primera vez que aparece
    etapa: str | None  # la de la fila más reciente
    notas: list[str]
    filas: list[tuple[str, int]]  # de dónde salió: (hoja, fila)
    problemas: list[str] = field(default_factory=list)


def palabras_del_nombre(c: ContactoLimpio) -> frozenset[str]:
    """El nombre como conjunto de palabras: "Mosquera Aldair" y "ALDAIR MOSQUERA" dan lo mismo."""
    return frozenset(simplificar(c.nombre).split()) if c.nombre else frozenset()


def clave_empresa(c: ContactoLimpio) -> str | None:
    """ "Panadería Torres S.A.S." y "PANADERIA TORRES" son la misma empresa."""
    return simplificar(c.empresa).removesuffix(" s.a.s.") if c.empresa else None


def chocan(x: object, y: object) -> bool:
    """Dos valores se contradicen si los dos existen y son distintos. Si falta uno, no se sabe."""
    return x is not None and y is not None and x != y


def contradicciones(a: ContactoLimpio, b: ContactoLimpio) -> list[str]:
    pares = {
        "teléfono": (a.telefono, b.telefono),
        "correo": (a.correo, b.correo),
        "empresa": (clave_empresa(a), clave_empresa(b)),
        "ciudad": (a.ciudad, b.ciudad),
    }
    return [campo for campo, (x, y) in pares.items() if chocan(x, y)]


def comparar_nombres(a: ContactoLimpio, b: ContactoLimpio) -> tuple[bool, bool, bool]:
    """Devuelve (iguales, parecidos, chocan).

    "Aldair Mosquera" y "MOSQUERA ALDAIR" son iguales. "David Sánchez" y "David Sánchez Gómez"
    se parecen (uno contiene al otro), pero eso no prueba que sean la misma persona. Si a una
    de las dos filas le falta el nombre, no son iguales ni chocan: no se sabe.
    """
    nombre_a, nombre_b = palabras_del_nombre(a), palabras_del_nombre(b)
    if not nombre_a or not nombre_b:
        return False, False, False
    iguales = len(nombre_a) >= 2 and nombre_a == nombre_b
    parecidos = (nombre_a <= nombre_b or nombre_b <= nombre_a) and len(nombre_a & nombre_b) >= 2
    return iguales, parecidos, not parecidos


def comparar(a: ContactoLimpio, b: ContactoLimpio) -> Coincidencia | None:
    nombres_iguales, nombres_parecidos, nombres_chocan = comparar_nombres(a, b)
    misma_empresa = clave_empresa(a) is not None and clave_empresa(a) == clave_empresa(b)
    misma_ciudad = a.ciudad is not None and a.ciudad == b.ciudad
    dato_compartido = [
        campo
        for campo, (x, y) in {"teléfono": (a.telefono, b.telefono), "correo": (a.correo, b.correo)}.items()
        if x is not None and x == y
    ]

    if choques := contradicciones(a, b):
        if nombres_iguales:
            return Coincidencia(REVISION, f"mismo nombre, pero distinto {', '.join(choques)}")
        return None
    if dato_compartido:
        if nombres_chocan:  # puede ser una familia que comparte celular o correo
            return Coincidencia(REVISION, f"mismo {' y '.join(dato_compartido)}, pero nombres distintos")
        return Coincidencia(SEGURO, f"mismo {' y '.join(dato_compartido)}")
    # Sin teléfono ni correo en común, un nombre igual es poca prueba ("Juan Pérez" hay muchos):
    # se une solo si además coincide la ciudad
    if nombres_iguales or (misma_empresa and not nombres_chocan):
        que = "mismo nombre" if nombres_iguales else "misma empresa"
        if misma_ciudad:
            return Coincidencia(SEGURO, f"{que} y misma ciudad")
        return Coincidencia(REVISION, f"{que}, sin teléfono, correo ni ciudad que lo confirme")
    if nombres_parecidos:
        return Coincidencia(REVISION, "nombre parecido, sin teléfono ni correo que lo confirme")
    return None


def por_que_no_unir(a: ContactoLimpio, b: ContactoLimpio) -> str | None:
    """Si dos filas no se pueden unir en automático, la razón; si no hay impedimento, None.

    Sirve para revisar un grupo completo: dos filas pueden terminar en el mismo grupo sin
    compararse directamente, a través de una tercera que se parece a las dos.
    """
    if choques := contradicciones(a, b):
        return f"distinto {', '.join(choques)}"
    if comparar_nombres(a, b)[2]:
        return "nombres distintos"
    coincidencia = comparar(a, b)
    if coincidencia is not None and coincidencia.nivel == REVISION:
        return coincidencia.razon
    return None


def describir(c: ContactoLimpio) -> str:
    return f"{c.nombre or c.empresa or 'sin nombre'} ({c.hoja}, fila {c.fila})"


def agrupar(contactos: list[ContactoLimpio]) -> tuple[list[list[ContactoLimpio]], list[ParejaEnRevision]]:
    """Une las filas de cada persona y devuelve también las parejas que tiene que decidir alguien.

    Funciona en dos tiempos, y por eso el resultado no depende del orden de las filas:
    1. Con las parejas seguras se arman grupos, como una red de amigos: si A=B y B=C, A, B y
       C quedan en el mismo grupo aunque A y C nunca se hayan comparado.
    2. Cada grupo se revisa completo. Si dos de sus filas no se pueden unir (datos que chocan,
       nombres distintos o una pareja en duda), el grupo no se une: sus filas quedan separadas
       y las parejas en conflicto van a revisión. Así una fila sin nombre no sirve de puente
       para juntar a "Ana Ruiz" y "Pedro Ruiz" porque comparten celular.
    """
    vecinos: dict[int, list[int]] = {i: [] for i in range(len(contactos))}
    revision: list[ParejaEnRevision] = []
    en_revision: set[tuple[int, int]] = set()
    for i, j in combinations(range(len(contactos)), 2):
        coincidencia = comparar(contactos[i], contactos[j])
        if coincidencia is None:
            continue
        if coincidencia.nivel == SEGURO:
            vecinos[i].append(j)
            vecinos[j].append(i)
        else:
            revision.append(ParejaEnRevision(contactos[i], contactos[j], coincidencia.razon))
            en_revision.add((i, j))

    grupos: list[list[ContactoLimpio]] = []
    visitados: set[int] = set()
    for inicio in range(len(contactos)):
        if inicio in visitados:
            continue
        # Recorre la red desde esta fila para encontrar todo su grupo
        grupo, pendientes = [], [inicio]
        visitados.add(inicio)
        while pendientes:
            actual = pendientes.pop()
            grupo.append(actual)
            for vecino in vecinos[actual]:
                if vecino not in visitados:
                    visitados.add(vecino)
                    pendientes.append(vecino)
        grupo.sort()

        conflictos = [
            (x, y, razon) for x, y in combinations(grupo, 2) if (razon := por_que_no_unir(contactos[x], contactos[y]))
        ]
        if not conflictos:
            grupos.append([contactos[x] for x in grupo])
            continue
        grupos.extend([contactos[x]] for x in grupo)
        for x, y, razon in conflictos:
            if (x, y) not in en_revision:
                cadena = " → ".join(describir(contactos[z]) for z in grupo)
                razon = f"las une una cadena de filas parecidas ({cadena}), pero tienen {razon}"
                revision.append(ParejaEnRevision(contactos[x], contactos[y], razon))
    return grupos, revision


def unico(grupo: list[ContactoLimpio], campo: str, problemas: list[str]):
    """El valor del campo en el grupo. Si las filas dicen cosas distintas, gana la más reciente y se anota."""
    valores = [getattr(c, campo) for c in grupo if getattr(c, campo) is not None]
    if len(set(valores)) > 1:
        problemas.append(f"{campo}_distinto_entre_filas")
        return getattr(mas_reciente(grupo, campo), campo)
    return valores[0] if valores else None


def mas_reciente(grupo: list[ContactoLimpio], campo: str) -> ContactoLimpio:
    """La fila más reciente que tiene el campo lleno.

    Las filas sin fecha cuentan como las más viejas. Si hay empate, gana la que aparece primero
    en el Excel; como el valor elegido igual queda anotado como _distinto_entre_filas, alguien
    puede revisarlo.
    """
    con_valor = [c for c in grupo if getattr(c, campo) is not None]
    return max(con_valor, key=lambda c: c.fecha_contacto or date.min)


def mejor_escrito(textos: list[str | None]) -> str | None:
    """De varias formas del mismo nombre, la más completa y luego la que tiene tildes."""
    candidatos = [t for t in textos if t]
    if not candidatos:
        return None
    return max(candidatos, key=lambda t: (len(t.split()), sum(not ch.isascii() for ch in t)))


def unificar(grupo: list[ContactoLimpio]) -> Persona:
    problemas: list[str] = []
    fechas = [c.fecha_contacto for c in grupo if c.fecha_contacto]
    notas = list(dict.fromkeys(c.notas for c in grupo if c.notas))  # sin repetir, en orden
    persona = Persona(
        nombre=mejor_escrito([c.nombre for c in grupo]),
        empresa=mejor_escrito([c.empresa for c in grupo]),
        tipo=unico(grupo, "tipo", problemas),
        telefono=unico(grupo, "telefono", problemas),
        correo=unico(grupo, "correo", problemas),
        ciudad=unico(grupo, "ciudad", problemas),
        consumo_kwh_mes=unico(grupo, "consumo_kwh_mes", problemas),
        asesor=unico(grupo, "asesor", problemas),
        fecha_contacto=min(fechas) if fechas else None,
        etapa=mas_reciente(grupo, "etapa").etapa if any(c.etapa for c in grupo) else None,
        notas=notas,
        filas=[(c.hoja, c.fila) for c in grupo],
        problemas=problemas,
    )
    # Lo que ninguna de sus filas logró llenar sigue faltando. Se conserva la diferencia entre
    # "no lo escribieron" (_vacio) y "lo escribieron, pero no se entiende" (_ilegible)
    de_las_filas = {p for c in grupo for p in c.problemas}
    for campo in CAMPOS_QUE_DEBERIAN_ESTAR:
        if getattr(persona, campo) is None:
            persona.problemas.append(f"{campo}_ilegible" if f"{campo}_ilegible" in de_las_filas else f"{campo}_vacio")
    if persona.nombre is None and persona.empresa is None:
        persona.problemas.append("nombre_dudoso" if "nombre_dudoso" in de_las_filas else "nombre_vacio")
    return persona


def deduplicar(contactos: list[ContactoLimpio]) -> tuple[list[Persona], list[ParejaEnRevision]]:
    """Las personas del Excel y las parejas que alguien tiene que decidir.

    Una persona con alguna fila en la lista de revisión queda marcada "pendiente_de_revision":
    el paso de carga no la toca hasta que alguien decida, para no crear un duplicado.
    """
    grupos, revision = agrupar(contactos)
    en_duda = {id(c) for pareja in revision for c in (pareja.a, pareja.b)}
    personas = []
    for grupo in grupos:
        persona = unificar(grupo)
        if any(id(c) in en_duda for c in grupo):
            persona.problemas.append("pendiente_de_revision")
        personas.append(persona)
    return personas, revision
