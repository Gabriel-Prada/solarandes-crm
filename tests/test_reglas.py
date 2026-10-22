import pytest
from reglas import PRECIO_KWP_GRANDE, PRECIO_KWP_PEQUENO, cotizar


def test_ejemplo_de_los_requisitos():
    # docs/requisitos.md: hogar en Bogotá con 300 kWh/mes
    c = cotizar(300, "Bogotá")
    assert c.potencia_necesaria_kwp == 3.13
    assert c.num_paneles == 6
    assert c.potencia_instalada_kwp == 3.3
    assert c.valor_total == 14_850_000


def test_mas_sol_necesita_menos_paneles():
    assert cotizar(500, "Cali").num_paneles < cotizar(500, "Bogotá").num_paneles


def test_sistemas_grandes_tienen_precio_menor_por_kwp():
    assert cotizar(300, "Bogotá").precio_kwp == PRECIO_KWP_PEQUENO
    assert cotizar(3000, "Bogotá").precio_kwp == PRECIO_KWP_GRANDE


def test_justo_en_el_limite_de_10_kwp_es_precio_pequeno():
    # 18 paneles = 9,9 kWp (precio pequeño); 19 paneles = 10,45 kWp (precio grande)
    assert cotizar(950, "Bogotá").num_paneles == 18
    assert cotizar(950, "Bogotá").precio_kwp == PRECIO_KWP_PEQUENO
    assert cotizar(1000, "Bogotá").num_paneles == 19
    assert cotizar(1000, "Bogotá").precio_kwp == PRECIO_KWP_GRANDE


@pytest.mark.parametrize("consumo", [0, -10])
def test_consumo_invalido(consumo):
    with pytest.raises(ValueError):
        cotizar(consumo, "Bogotá")


def test_ciudad_no_atendida():
    with pytest.raises(ValueError):
        cotizar(300, "Barranquilla")
