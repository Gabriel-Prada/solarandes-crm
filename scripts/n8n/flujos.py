"""Sube los flujos del repo a n8n y los exporta de vuelta, usando la API de n8n.

El repo es la fuente de la verdad (como las migraciones): cada flujo es un archivo en
automatizaciones/flujos/. Las credenciales no viajan: los archivos solo traen su nombre y
su código interno, y el secreto se queda cifrado dentro de n8n.

Solo se manejan los flujos del proyecto: los que empiezan con dos dígitos y un espacio
("00 Alertas de error"). Cualquier otro flujo de n8n (de práctica, por ejemplo) se ignora,
para que nada personal termine en el repo, que es público.

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

DEL_PROYECTO = re.compile(r"^\d\d ")


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


def flujo_de_errores_a_id(flujo: dict, por_nombre: dict[str, str]) -> dict:
    """En el repo el flujo de errores se nombra; n8n necesita su código interno."""
    nombre = (flujo.get("settings") or {}).get("errorWorkflow")
    if not nombre:
        return flujo
    if nombre not in por_nombre:
        raise SystemExit(f"{flujo['name']}: primero sube el flujo '{nombre}'")
    return {**flujo, "settings": {**flujo["settings"], "errorWorkflow": por_nombre[nombre]}}


def flujo_de_errores_a_nombre(flujo: dict, por_id: dict[str, str]) -> dict:
    """Lo contrario: al exportar, el código interno vuelve a ser el nombre."""
    codigo = (flujo.get("settings") or {}).get("errorWorkflow")
    if not codigo:
        return flujo
    if codigo not in por_id:
        raise SystemExit(f"{flujo['name']}: su flujo de errores ({codigo}) ya no existe en n8n")
    return {**flujo, "settings": {**flujo["settings"], "errorWorkflow": por_id[codigo]}}


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

    for archivo in archivos:
        flujo = {k: v for k, v in json.loads(archivo.read_text(encoding="utf-8")).items() if k in CAMPOS}
        if not es_del_proyecto(flujo["name"]):
            raise SystemExit(f"{archivo.name}: el nombre debe empezar con dos dígitos y un espacio")
        # Se vuelve a preguntar en cada vuelta: así el flujo 99 encuentra al 00 recién creado
        por_nombre = indice_por_nombre(flujos_en_n8n(api))
        flujo = flujo_de_errores_a_id(flujo, por_nombre)

        existente = por_nombre.get(flujo["name"])
        if existente:
            respuesta = api.put(f"/workflows/{existente}", json=flujo)
            accion = "actualizado"
        else:
            respuesta = api.post("/workflows", json=flujo)
            accion = "creado"
        if respuesta.is_error:
            raise SystemExit(f"{archivo.name}: n8n respondió {respuesta.status_code}: {respuesta.text}")
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
        flujo = flujo_de_errores_a_nombre(flujo, por_id)
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
