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
    assert not f.es_del_proyecto("Mi flujo de práctica")
    assert not f.es_del_proyecto("0 Casi")


def test_flujo_de_errores_va_y_vuelve_igual():
    # Subir y luego exportar debe dejar el archivo del repo como estaba
    flujo = {"name": "99 Prueba", "settings": {"errorWorkflow": "00 Alertas de error", "timezone": "America/Bogota"}}
    en_n8n = f.flujo_de_errores_a_id(flujo, {"00 Alertas de error": "abc123"})
    assert en_n8n["settings"]["errorWorkflow"] == "abc123"
    assert f.flujo_de_errores_a_nombre(en_n8n, {"abc123": "00 Alertas de error"}) == flujo
    assert flujo["settings"]["errorWorkflow"] == "00 Alertas de error"  # no cambia el original


def test_flujo_de_errores_que_no_existe_avisa():
    flujo = {"name": "99 Prueba", "settings": {"errorWorkflow": "00 Alertas de error"}}
    with pytest.raises(SystemExit, match="primero sube"):
        f.flujo_de_errores_a_id(flujo, {})
    with pytest.raises(SystemExit, match="ya no existe"):
        f.flujo_de_errores_a_nombre({"name": "99 Prueba", "settings": {"errorWorkflow": "zzz"}}, {})


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
