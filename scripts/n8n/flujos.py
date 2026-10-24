"""Sube los flujos del repo a n8n y los exporta de vuelta, usando la API de n8n.

El repo es la fuente de la verdad (como las migraciones): cada flujo es un archivo en
automatizaciones/flujos/. Las credenciales no viajan: los archivos solo traen su nombre y
su código interno, y el secreto se queda cifrado dentro de n8n.

Solo se manejan los flujos del proyecto: los que empiezan con dos dígitos (y quizás una letra)
y un espacio ("00 Alertas de error", "01b Reintentar leads pendientes"). Cualquier otro flujo
de n8n (de práctica, por ejemplo) se ignora, para que nada personal termine en el repo, que es público.

Los flujos se nombran entre sí (el de errores, los subflujos): en el repo por su nombre y en n8n
por su código interno. El script traduce en los dos sentidos y sube primero los que otros nombran.

Uso:
    .venv/Scripts/python scripts/n8n/flujos.py subir            # todos los flujos del repo
    .venv/Scripts/python scripts/n8n/flujos.py subir 00 99      # solo los que empiezan así
    .venv/Scripts/python scripts/n8n/flujos.py exportar         # de n8n al repo
"""

import json
import re
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

RAIZ = Path(__file__).resolve().parents[2]
CARPETA_FLUJOS = RAIZ / "automatizaciones" / "flujos"

# La API de n8n rechaza campos que no conoce, así que solo se envía y se guarda esto.
# Deja fuera pinData y staticData, donde n8n puede guardar datos de prueba.
CAMPOS = ("name", "nodes", "connections", "settings")

DEL_PROYECTO = re.compile(r"^\d\d[a-z]? ")
# El paso de n8n que llama a otro flujo (un subflujo)
SUBFLUJO = "n8n-nodes-base.executeWorkflow"
# El primer paso de un subflujo ("Cuando lo llamen")
ACTIVADOR_DE_SUBFLUJO = "n8n-nodes-base.executeWorkflowTrigger"


def es_del_proyecto(nombre: str) -> bool:
    return bool(DEL_PROYECTO.match(nombre))


def nombre_de_archivo(nombre: str) -> str:
    """'00 Alertas de error' → '00-alertas-de-error.json'."""
    simple = nombre.lower().translate(str.maketrans("áéíóúüñ", "aeiouun"))
    return re.sub(r"[^a-z0-9]+", "-", simple).strip("-") + ".json"


def indice_por_nombre(flujos: list[dict]) -> dict[str, str]:
    """{nombre: id}. Se detiene si dos flujos del proyecto se llaman igual: uno pisaría al otro."""
    indice = {}
    for f in flujos:
        if f["name"] in indice and es_del_proyecto(f["name"]):
            raise SystemExit(f"Hay 2 flujos llamados '{f['name']}' en n8n: cámbiale el nombre a uno")
        indice[f["name"]] = f["id"]
    return indice


def dependencias(flujo: dict) -> set[str]:
    """Los flujos que este nombra: su flujo de errores y los subflujos que llama."""
    nombres = set()
    if (flujo.get("settings") or {}).get("errorWorkflow"):
        nombres.add(flujo["settings"]["errorWorkflow"])
    for nodo in flujo.get("nodes", []):
        referencia = nodo.get("parameters", {}).get("workflowId") if nodo.get("type") == SUBFLUJO else None
        if isinstance(referencia, dict) and referencia.get("value"):
            nombres.add(referencia["value"])
    return nombres


def _traducir_referencias(flujo: dict, traducir) -> dict:
    """Cambia cada referencia a otro flujo (el de errores y los subflujos) con traducir(valor) → (valor, nombre)."""
    configuracion = dict(flujo.get("settings") or {})
    if configuracion.get("errorWorkflow"):
        configuracion["errorWorkflow"] = traducir(configuracion["errorWorkflow"])[0]
    nodos = []
    for nodo in flujo.get("nodes", []):
        referencia = nodo.get("parameters", {}).get("workflowId") if nodo.get("type") == SUBFLUJO else None
        if isinstance(referencia, dict) and referencia.get("value"):
            valor, nombre = traducir(referencia["value"])
            referencia = {**referencia, "mode": "list", "value": valor, "cachedResultName": nombre}
            nodo = {**nodo, "parameters": {**nodo["parameters"], "workflowId": referencia}}
        nodos.append(nodo)
    return {**flujo, "settings": configuracion, "nodes": nodos}


def referencias_a_ids(flujo: dict, por_nombre: dict[str, str]) -> dict:
    """En el repo los demás flujos se nombran; n8n necesita su código interno, que cambia de un n8n a otro."""

    def traducir(nombre):
        if nombre not in por_nombre:
            raise SystemExit(f"{flujo['name']}: primero sube el flujo '{nombre}'")
        return por_nombre[nombre], nombre

    return _traducir_referencias(flujo, traducir)


def referencias_a_nombres(flujo: dict, por_id: dict[str, str]) -> dict:
    """Lo contrario: al exportar, cada código interno vuelve a ser el nombre."""

    def traducir(codigo):
        if codigo not in por_id:
            raise SystemExit(f"{flujo['name']}: nombra un flujo ({codigo}) que ya no existe en n8n")
        return por_id[codigo], por_id[codigo]

    return _traducir_referencias(flujo, traducir)


def orden_de_subida(flujos: list[dict], en_n8n: set[str]) -> list[dict]:
    """Primero los flujos que otros nombran: así nadie apunta a uno que todavía no existe.

    Si el flujo nombrado también viene en esta subida, va primero aunque ya esté en n8n: puede
    traer cambios o tener que publicarse antes (un subflujo).
    """
    pendientes, orden = list(flujos), []
    disponibles = set(en_n8n) - {f["name"] for f in flujos}
    while pendientes:
        listos = [f for f in pendientes if dependencias(f) - {f["name"]} <= disponibles]
        if not listos:
            faltan = sorted(set().union(*(dependencias(f) for f in pendientes)) - disponibles)
            raise SystemExit(f"No se pueden subir: faltan los flujos {', '.join(faltan)}")
        for f in listos:
            orden.append(f)
            disponibles.add(f["name"])
            pendientes.remove(f)
    return orden


def cliente() -> httpx.Client:
    valores = dotenv_values(RAIZ / ".env")
    llave = (valores.get("N8N_API_KEY") or "").strip()
    if not llave:
        raise SystemExit("Falta N8N_API_KEY en .env (se crea en n8n: Settings → n8n API)")
    url = (valores.get("N8N_URL") or "http://localhost:5678").rstrip("/")
    return httpx.Client(base_url=f"{url}/api/v1", headers={"X-N8N-API-KEY": llave}, timeout=20)


def flujos_en_n8n(api: httpx.Client) -> list[dict]:
    flujos, cursor = [], None
    while True:
        respuesta = api.get("/workflows", params={"limit": 100, **({"cursor": cursor} if cursor else {})})
        respuesta.raise_for_status()
        datos = respuesta.json()
        flujos += datos["data"]
        cursor = datos.get("nextCursor")
        if not cursor:
            return flujos


def subir(prefijos: list[str]) -> None:
    api = cliente()
    archivos = sorted(CARPETA_FLUJOS.glob("*.json"))
    if prefijos:
        archivos = [a for a in archivos if a.name.startswith(tuple(prefijos))]
    if not archivos:
        raise SystemExit("No hay flujos que subir")

    flujos = []
    for archivo in archivos:
        flujo = {k: v for k, v in json.loads(archivo.read_text(encoding="utf-8")).items() if k in CAMPOS}
        if not es_del_proyecto(flujo["name"]):
            raise SystemExit(f"{archivo.name}: el nombre debe empezar con dos dígitos y un espacio")
        flujos.append(flujo)

    for flujo in orden_de_subida(flujos, set(indice_por_nombre(flujos_en_n8n(api)))):
        # Se vuelve a preguntar en cada vuelta: así un flujo encuentra al que se acaba de crear
        por_nombre = indice_por_nombre(flujos_en_n8n(api))
        existente = por_nombre.get(flujo["name"])
        flujo = referencias_a_ids(flujo, por_nombre)
        if existente:
            respuesta = api.put(f"/workflows/{existente}", json=flujo)
            accion = "actualizado"
        else:
            respuesta = api.post("/workflows", json=flujo)
            accion = "creado"
        if respuesta.is_error:
            raise SystemExit(f"{flujo['name']}: n8n respondió {respuesta.status_code}: {respuesta.text}")
        # Un flujo publicado no puede llamar a un subflujo sin publicar (n8n 2.x): los subflujos se publican
        if any(n.get("type") == ACTIVADOR_DE_SUBFLUJO for n in flujo["nodes"]):
            publicado = api.post(f"/workflows/{respuesta.json()['id']}/activate")
            if publicado.is_error:
                raise SystemExit(f"{flujo['name']}: no se pudo publicar: {publicado.text}")
            accion += " y publicado"
        print(f"{flujo['name']}: {accion} (id {respuesta.json()['id']})")


def exportar() -> None:
    api = cliente()
    flujos = flujos_en_n8n(api)
    indice_por_nombre(flujos)  # se detiene si hay nombres repetidos
    por_id = {f["id"]: f["name"] for f in flujos}
    CARPETA_FLUJOS.mkdir(parents=True, exist_ok=True)

    escritos = set()
    for resumen in flujos:
        if not es_del_proyecto(resumen["name"]):
            print(f"Ignorado (no es del proyecto): {resumen['name']}")
            continue
        respuesta = api.get(f"/workflows/{resumen['id']}")
        respuesta.raise_for_status()
        flujo = {k: v for k, v in respuesta.json().items() if k in CAMPOS}
        flujo = referencias_a_nombres(flujo, por_id)
        archivo = CARPETA_FLUJOS / nombre_de_archivo(flujo["name"])
        archivo.write_text(json.dumps(flujo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        escritos.add(archivo.name)
        print(f"{flujo['name']} → {archivo.relative_to(RAIZ)}")

    # Un flujo renombrado en n8n deja su archivo viejo; si se sube, revive el flujo viejo
    for sobrante in sorted(a.name for a in CARPETA_FLUJOS.glob("*.json") if a.name not in escritos):
        print(f"Aviso: {sobrante} ya no corresponde a ningún flujo de n8n (¿lo renombraron?). Bórralo o revísalo")


if __name__ == "__main__":
    orden, *resto = sys.argv[1:] or ["ayuda"]
    if orden == "subir":
        subir(resto)
    elif orden == "exportar":
        exportar()
    else:
        print(__doc__)
