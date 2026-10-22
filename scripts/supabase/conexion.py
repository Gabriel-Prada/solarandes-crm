"""Conexión a la base de datos de Supabase con los datos del archivo .env."""

from pathlib import Path

import psycopg
from dotenv import dotenv_values

RAIZ = Path(__file__).resolve().parents[2]
RUTA_ENV = RAIZ / ".env"


def configuracion() -> dict:
    valores = dotenv_values(RUTA_ENV)
    faltan = [k for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_DB_PASSWORD") if not valores.get(k)]
    if faltan:
        raise SystemExit(f"Faltan valores en .env: {', '.join(faltan)}")
    return valores


def conectar() -> psycopg.Connection:
    v = configuracion()
    return psycopg.connect(
        host=v["SUPABASE_DB_HOST"],
        port=5432,
        dbname="postgres",
        user=v["SUPABASE_DB_USER"],
        password=v["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=20,
    )
