"""Verifica el script que sube y exporta los flujos de n8n, sin necesitar n8n prendido."""

import json
import re
from pathlib import Path

import flujos as f
import pytest

CARPETA = Path(__file__).resolve().parents[1] / "automatizaciones" / "flujos"


def test_nombre_de_archivo():
    assert f.nombre_de_archivo("00 Alertas de error") == "00-alertas-de-error.json"
    assert f.nombre_de_archivo("01 Captura de leads (web)") == "01-captura-de-leads-web.json"
    assert f.nombre_de_archivo("03 Señales de compañía") == "03-senales-de-compania.json"


def test_solo_los_flujos_del_proyecto():
    assert f.es_del_proyecto("00 Alertas de error")
    assert f.es_del_proyecto("01b Reintentar leads pendientes")
    assert not f.es_del_proyecto("Mi flujo de práctica")
    assert not f.es_del_proyecto("0 Casi")


def un_flujo(nombre, errores=None, subflujo=None):
    nodos = []
    if subflujo:
        referencia = {"__rl": True, "mode": "list", "value": subflujo, "cachedResultName": subflujo}
        nodos.append({"name": "Llamar", "type": f.SUBFLUJO, "parameters": {"workflowId": referencia}})
    return {"name": nombre, "nodes": nodos, "settings": {"errorWorkflow": errores} if errores else {}}


def test_las_referencias_a_otros_flujos_van_y_vuelven_igual():
    # Subir y luego exportar debe dejar el archivo del repo como estaba
    flujo = un_flujo("01 Captura", errores="00 Alertas de error", subflujo="01c Avisos")
    ids = {"00 Alertas de error": "abc", "01c Avisos": "xyz"}
    en_n8n = f.referencias_a_ids(flujo, ids)
    assert en_n8n["settings"]["errorWorkflow"] == "abc"
    assert en_n8n["nodes"][0]["parameters"]["workflowId"]["value"] == "xyz"
    assert f.referencias_a_nombres(en_n8n, {v: k for k, v in ids.items()}) == flujo
    assert flujo["settings"]["errorWorkflow"] == "00 Alertas de error"  # no cambia el original


def test_una_referencia_a_un_flujo_que_no_existe_avisa():
    with pytest.raises(SystemExit, match="primero sube"):
        f.referencias_a_ids(un_flujo("99 Prueba", errores="00 Alertas de error"), {})
    with pytest.raises(SystemExit, match="ya no existe"):
        f.referencias_a_nombres(un_flujo("99 Prueba", errores="zzz"), {})


def test_se_suben_primero_los_flujos_que_otros_nombran():
    captura = un_flujo("01 Captura", errores="00 Alertas", subflujo="01c Avisos")
    avisos = un_flujo("01c Avisos", errores="00 Alertas")
    alertas = un_flujo("00 Alertas")
    orden = [x["name"] for x in f.orden_de_subida([captura, avisos, alertas], set())]
    assert orden.index("00 Alertas") < orden.index("01c Avisos") < orden.index("01 Captura")
    # Aunque ya estén en n8n, si vienen en la misma subida, los nombrados van primero
    orden = [x["name"] for x in f.orden_de_subida([captura, avisos], {"00 Alertas", "01c Avisos", "01 Captura"})]
    assert orden == ["01c Avisos", "01 Captura"]
    # Si el flujo nombrado ya está en n8n y no viene en esta subida, no hace falta subirlo antes
    assert [x["name"] for x in f.orden_de_subida([captura], {"00 Alertas", "01c Avisos"})] == ["01 Captura"]
    with pytest.raises(SystemExit, match="faltan los flujos 01c Avisos"):
        f.orden_de_subida([captura], {"00 Alertas"})


def test_nombres_repetidos_se_detienen():
    repetidos = [{"name": "00 Alertas de error", "id": "a"}, {"name": "00 Alertas de error", "id": "b"}]
    with pytest.raises(SystemExit, match="Hay 2 flujos"):
        f.indice_por_nombre(repetidos)
    # Los flujos de práctica repetidos no importan: nunca se suben ni se exportan
    assert f.indice_por_nombre([{"name": "Prueba", "id": "a"}, {"name": "Prueba", "id": "b"}]) == {"Prueba": "b"}


@pytest.mark.parametrize("archivo", sorted(CARPETA.glob("*.json")), ids=lambda a: a.name)
def test_flujos_del_repo(archivo):
    flujo = json.loads(archivo.read_text(encoding="utf-8"))
    assert f.es_del_proyecto(flujo["name"])
    assert archivo.name == f.nombre_de_archivo(flujo["name"])
    # Todo flujo, salvo el de alertas, avisa cuando falla
    if not flujo["name"].startswith("00 "):
        assert flujo["settings"].get("errorWorkflow") == "00 Alertas de error"
    # Los subflujos se nombran (no por código interno), y el flujo nombrado existe en el repo
    nombres = {json.loads(a.read_text(encoding="utf-8"))["name"] for a in CARPETA.glob("*.json")}
    assert f.dependencias(flujo) <= nombres
    # Los archivos van al repo público: nunca datos de prueba ni secretos
    assert "pinData" not in flujo and "staticData" not in flujo
    # Ni correos ni celulares escritos a mano: los destinos viven en la tabla destinos_prueba de n8n
    texto = archivo.read_text(encoding="utf-8")
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", texto), "hay un correo escrito en el flujo"
    assert not re.search(r"\+?57\s?3\d{9}|\b3\d{9}\b", texto), "hay un celular escrito en el flujo"
    for nodo in flujo["nodes"]:
        for credencial in nodo.get("credentials", {}).values():
            assert set(credencial) <= {"id", "name"}
        # Los destinos siempre se leen (expresión, empieza por "="), nunca se escriben a mano:
        # así no se cuela un chat_id, que es un número cualquiera y ningún patrón lo atrapa
        for campo in ("chatId", "toEmail", "fromEmail", "ccEmail", "bccEmail"):
            valor = nodo["parameters"].get(campo)
            if valor is not None:
                assert str(valor).startswith("="), f"{nodo['name']}: {campo} está escrito a mano"
