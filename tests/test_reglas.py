import pytest
from reglas import PRECIO_KWP_GRANDE, PRECIO_KWP_PEQUENO, aplicar_descuento, cotizar


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


# Los mismos casos están en apps/crm/src/lib/cotizacion.test.ts y, contra la base de datos,
# en tests/test_permisos_supabase.py: las tres versiones de la fórmula deben coincidir.
@pytest.mark.parametrize(
    ("valor", "descuento", "esperado"),
    [
        (4_950_000, 5, 4_703_000),  # 4.702.500: la mitad sube (el round() de Python daría 4.702.000)
        (12_375_000, 5, 11_756_000),
        (56_430_000, 8, 51_916_000),
        (14_850_000, 0, 14_850_000),
        (14_850_000, 2.5, 14_479_000),  # con decimal
        (14_850_000, 30, 10_395_000),
    ],
)
def test_aplicar_descuento(valor, descuento, esperado):
    assert aplicar_descuento(valor, descuento) == esperado


@pytest.mark.parametrize("descuento", [-1, 30.1, 100])
def test_descuento_fuera_de_rango(descuento):
    with pytest.raises(ValueError):
        aplicar_descuento(14_850_000, descuento)
