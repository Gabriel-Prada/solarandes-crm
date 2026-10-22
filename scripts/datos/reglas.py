"""Reglas de negocio de SolarAndes que se usan en varias fases.

La fórmula y los precios están explicados en docs/requisitos.md, sección 4.
"""

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# Horas sol pico promedio al día en cada ciudad
HSP = {"Bogotá": 4.0, "Medellín": 4.5, "Cali": 4.8}
CIUDADES = tuple(HSP)

EFICIENCIA = 0.8  # pérdidas por calor, cables e inversor
POTENCIA_PANEL_W = 550
LIMITE_SISTEMA_PEQUENO_W = 10_000
PRECIO_KWP_PEQUENO = 4_500_000  # COP por kWp, hasta 10 kWp
PRECIO_KWP_GRANDE = 3_800_000  # COP por kWp, más de 10 kWp


@dataclass(frozen=True)
class Cotizacion:
    potencia_necesaria_kwp: float
    num_paneles: int
    potencia_instalada_kwp: float
    precio_kwp: int
    valor_total: int


def cotizar(consumo_kwh_mes: float, ciudad: str) -> Cotizacion:
    """Calcula el sistema y el precio "llave en mano" para un consumo mensual."""
    if consumo_kwh_mes <= 0:
        raise ValueError("El consumo debe ser mayor que cero")
    if ciudad not in HSP:
        raise ValueError(f"Ciudad no atendida: {ciudad!r}")

    necesaria_kwp = consumo_kwh_mes / (HSP[ciudad] * 30 * EFICIENCIA)
    # round() evita que un error de punto flotante sume un panel de más
    num_paneles = math.ceil(round(necesaria_kwp * 1000 / POTENCIA_PANEL_W, 6))
    instalada_w = num_paneles * POTENCIA_PANEL_W
    precio_kwp = PRECIO_KWP_PEQUENO if instalada_w <= LIMITE_SISTEMA_PEQUENO_W else PRECIO_KWP_GRANDE

    return Cotizacion(
        # round() de Python redondea 3,125 a 3,12; aquí se usa el redondeo de siempre (3,13)
        potencia_necesaria_kwp=float(Decimal(str(necesaria_kwp)).quantize(Decimal("0.01"), ROUND_HALF_UP)),
        num_paneles=num_paneles,
        potencia_instalada_kwp=instalada_w / 1000,
        precio_kwp=precio_kwp,
        valor_total=instalada_w * precio_kwp // 1000,
    )
