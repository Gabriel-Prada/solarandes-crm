"""Paso 2 de la migración: dejar cada valor del Excel en un solo formato, el del CRM.

Principio: la limpieza nunca inventa datos. Si un teléfono tiene un dígito de menos o un
correo no tiene terminación, no se adivina: el valor queda vacío y se anota el problema,
para que el paso de conciliación (o una persona) decida.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from leer_excel import FilaHeredada, simplificar

MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}  # fmt: skip

# Palabras con las que empieza el nombre de un negocio en el Excel. Salen de mirar los datos;
# un negocio que no empiece así ("Tienda Don Pepe") se toma como nombre de persona.
INICIOS_DE_NEGOCIO = {
    "carniceria", "colegio", "drogueria", "ferreteria", "gimnasio", "hotel",
    "lavanderia", "oficinas", "panaderia", "restaurante", "supermercado", "taller",
}  # fmt: skip

# Palabras que van en minúscula dentro de un nombre propio
CONECTORES = {"de", "del", "la", "las", "los", "y"}

# Asesores del CRM (perfiles.codigo) y cada forma, ya simplificada, en que aparecen en el Excel.
# Es una lista cerrada a propósito: el asesor decide quién ve al cliente en el CRM, así que
# "Camila" no puede terminar asignada a Camilo por empezar igual. Lo que no esté, va a revisión.
ASESORES = {
    "U02": {"andres", "andres r", "andres rojas", "a. rojas"},
    "U03": {"vale", "valentina", "valentina o.", "valentina ospina"},
    "U04": {"cami", "camilo", "camilo t", "camilo torres", "c. torres"},
}

# Lo que se sabe de cada hoja aunque la fila no lo diga: la de Medellín es de Valentina
VALORES_POR_HOJA = {"Medellín (Vale)": {"ciudad": "Medellín", "asesor": "U03"}}

# Estado escrito a mano → etapa del CRM (definiciones en docs/requisitos.md, sección de etapas).
# "contactado" es que un asesor habló con el cliente; si no contesta, nadie habló con él, y
# "perdido" incluye "dejó de responder". El motivo de la pérdida no se deduce: "no contesta" puede
# esconder otro (en este Excel hay quien no contestaba porque aplazó la decisión).
ETAPAS = {
    "sin contactar": "nuevo",
    "nuevo lead": "nuevo",
    "interesado": "contactado",
    "visita": "visita_agendada",
    "visita agendada": "visita_agendada",
    "cotizado": "cotizado",
    "negociando": "negociacion",
    "pide descuento": "negociacion",
    "cerro": "ganado",
    "vendido": "ganado",
    "instalado": "ganado",
    "ganado": "ganado",
    "perdido": "perdido",
    "no le intereso": "perdido",
    "no contesta": "perdido",
}


@dataclass
class ContactoLimpio:
    hoja: str
    fila: int
    nombre: str | None
    empresa: str | None
    tipo: str | None  # hogar | negocio
    telefono: str | None  # +573XXXXXXXXX
    correo: str | None
    ciudad: str | None  # Bogotá | Medellín | Cali
    consumo_kwh_mes: int | None
    asesor: str | None  # código del perfil: U02, U03, U04
    fecha_contacto: date | None
    etapa: str | None
    notas: str | None
    problemas: list[str] = field(default_factory=list)


def normalizar_telefono(valor: object) -> str | None:
    """Celular colombiano en formato +573XXXXXXXXX, o None si no se puede saber cuál es."""
    if valor is None:
        return None
    texto = str(valor).strip()
    if re.fullmatch(r"\d+\.0", texto):  # un número que Excel guardó como decimal: 3056695760.0
        texto = texto[:-2]
    digitos = re.sub(r"\D", "", texto)
    if len(digitos) == 12 and digitos.startswith("57"):
        digitos = digitos[2:]
    if len(digitos) == 10 and digitos.startswith("3"):
        return "+57" + digitos
    return None


def normalizar_correo(valor: object) -> str | None:
    if valor is None:
        return None
    correo = str(valor).strip().lower()
    return correo if re.fullmatch(r"[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+", correo) else None


def normalizar_ciudad(valor: object) -> str | None:
    """Se reconoce por cómo empieza: "Bta", "Bogota DC", "Cali - Valle". "Localidad de Suba" no es Cali."""
    texto = simplificar(valor) if valor is not None else ""
    if texto.startswith(("bog", "bta")):
        return "Bogotá"
    if texto.startswith(("medellin", "mde")):
        return "Medellín"
    if re.match(r"(santiago de )?cali\b", texto):
        return "Cali"
    return None


def normalizar_tipo(valor: object) -> str | None:
    texto = simplificar(valor) if valor is not None else ""
    if texto in {"casa", "residencial", "hogar"}:
        return "hogar"
    if texto in {"comercial", "negocio", "empresa"}:
        return "negocio"
    return None


def nombre_propio(texto: str) -> str:
    """ "MILENA CORREA  ORDÓÑEZ " → "Milena Correa Ordóñez"; respeta "S.A.S." y los conectores."""
    palabras = []
    for i, palabra in enumerate(texto.split()):
        if simplificar(palabra) == "s.a.s.":
            palabras.append("S.A.S.")
        elif i > 0 and palabra.lower() in CONECTORES:
            palabras.append(palabra.lower())
        else:
            palabras.append(palabra[:1].upper() + palabra[1:].lower())
    return " ".join(palabras)


def parece_negocio(texto: str) -> bool:
    simple = simplificar(texto)
    return bool(simple) and (simple.split()[0] in INICIOS_DE_NEGOCIO or "s.a.s" in simple)


def separar_nombre(valor: object) -> tuple[str | None, str | None, bool]:
    """Devuelve (persona, empresa, dudoso).

    "Hotel López - Milena Correa" → ("Milena Correa", "Hotel López", False). Con guion, se
    parte solo si uno de los dos lados parece un negocio; si ninguno lo parece ("Pedro
    Gómez - Hijo"), no se adivina: queda vacío y marcado como dudoso.
    """
    if valor is None or not str(valor).strip():
        return None, None, False
    texto = str(valor).strip()
    if " - " in texto:
        izquierda, derecha = texto.split(" - ", 1)
        if parece_negocio(izquierda):
            return nombre_propio(derecha), nombre_propio(izquierda), False
        if parece_negocio(derecha):
            return nombre_propio(izquierda), nombre_propio(derecha), False
        return None, None, True
    if parece_negocio(texto):
        return None, nombre_propio(texto), False
    return nombre_propio(texto), None, False


def normalizar_consumo(valor: object) -> int | None:
    if isinstance(valor, float) and valor.is_integer():  # Excel a veces guarda 604 como 604.0
        valor = int(valor)
    if valor is None or "-" in str(valor):  # un consumo negativo no existe
        return None
    numeros = re.findall(r"\d+", str(valor))
    return int(numeros[0]) if len(numeros) == 1 and int(numeros[0]) > 0 else None


def normalizar_fecha(valor: object) -> date | None:
    if isinstance(valor, datetime):
        return valor.date()
    if valor is None:
        return None
    texto = simplificar(valor)
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", texto):
        anio, mes, dia = map(int, m.groups())
    elif m := re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", texto):  # día/mes/año, como en Colombia
        dia, mes, anio = map(int, m.groups())
    elif m := re.fullmatch(r"(\d{1,2})-([a-z]{3})-(\d{2})", texto):  # 24-nov-25
        dia, mes, anio = int(m[1]), MESES.get(m[2], 0), 2000 + int(m[3])
    elif m := re.fullmatch(r"(\d{1,2}) de ([a-z]+) de (\d{4})", texto):  # 4 de enero de 2026
        dia, mes, anio = int(m[1]), MESES.get(m[2][:3], 0), int(m[3])
    else:
        return None
    try:
        return date(anio, mes, dia)
    except ValueError:
        return None


def normalizar_asesor(valor: object) -> str | None:
    texto = simplificar(valor) if valor is not None else ""
    return next((codigo for codigo, formas in ASESORES.items() if texto in formas), None)


def estado_simple(valor: object) -> str:
    """ "Cotizado ✓" → "cotizado"; "cerró!!" → "cerro"."""
    return re.sub(r"[^a-z ]", "", simplificar(valor)).strip() if valor is not None else ""


def normalizar_etapa(valor: object) -> str | None:
    return ETAPAS.get(estado_simple(valor))


def texto_o_none(valor: object) -> object:
    """Una celda con solo espacios cuenta como vacía."""
    return None if valor is None or str(valor).strip() == "" else valor


def normalizar(fila: FilaHeredada) -> ContactoLimpio:
    escritos = {campo: texto_o_none(valor) for campo, valor in fila.valores.items()}
    por_hoja = VALORES_POR_HOJA.get(fila.hoja, {})
    persona, empresa, nombre_dudoso = separar_nombre(escritos.get("nombre"))

    contacto = ContactoLimpio(
        hoja=fila.hoja,
        fila=fila.fila,
        nombre=persona,
        empresa=empresa,
        tipo=normalizar_tipo(escritos.get("tipo")) or ("negocio" if empresa else None),
        telefono=normalizar_telefono(escritos.get("telefono")),
        correo=normalizar_correo(escritos.get("correo")),
        # Solo si la celda está vacía vale lo que se sabe de la hoja; si dice algo ilegible, no
        ciudad=normalizar_ciudad(escritos["ciudad"]) if escritos.get("ciudad") else por_hoja.get("ciudad"),
        consumo_kwh_mes=normalizar_consumo(escritos.get("consumo")),
        asesor=normalizar_asesor(escritos["asesor"]) if escritos.get("asesor") else por_hoja.get("asesor"),
        fecha_contacto=normalizar_fecha(escritos.get("fecha")),
        etapa=normalizar_etapa(escritos.get("estado")),
        notas=str(escritos["notas"]).strip() if escritos.get("notas") else None,
    )

    # Lo que no venía en la fila y se dedujo de la hoja también se anota: es una suposición
    for campo in ("ciudad", "asesor"):
        if not escritos.get(campo) and por_hoja.get(campo):
            contacto.problemas.append(f"{campo}_de_la_hoja")

    # Se anota todo lo que venía escrito y no se pudo entender, y lo que falta
    for campo, original in [
        ("telefono", escritos.get("telefono")),
        ("correo", escritos.get("correo")),
        ("ciudad", escritos.get("ciudad")),
        ("tipo", escritos.get("tipo")),
        ("consumo_kwh_mes", escritos.get("consumo")),
        ("fecha_contacto", escritos.get("fecha")),
        ("etapa", escritos.get("estado")),
        ("asesor", escritos.get("asesor")),
    ]:
        if getattr(contacto, campo) is None:
            contacto.problemas.append(f"{campo}_ilegible" if original is not None else f"{campo}_vacio")
    if nombre_dudoso:
        contacto.problemas.append("nombre_dudoso")
    elif contacto.nombre is None and contacto.empresa is None:
        contacto.problemas.append("nombre_vacio")
    return contacto
