"""Le da contraseña (y permiso de entrar) al usuario del asistente público, asistente_web (fase 6).

La migración 025 crea el usuario SIN poder entrar: la contraseña no puede ir en una migración, porque el
repo está en GitHub. Este script:
  1. genera una contraseña aleatoria,
  2. se la pone al usuario YA CIFRADA (SCRAM-SHA-256, el formato de Postgres), para que el texto de la
     contraseña no quede en los registros de la base,
  3. la guarda en .env y en apps/crm/.env.local (ASISTENTE_DB_HOST, ASISTENTE_DB_USUARIO, ASISTENTE_DB_CLAVE),
     sin mostrarla en pantalla.

Correrlo otra vez cambia la contraseña (por ejemplo, si se filtró). Después hay que actualizar
ASISTENTE_DB_CLAVE en Vercel.

Uso: .venv/Scripts/python scripts/supabase/clave_asistente.py
"""

import base64
import hashlib
import hmac
import os
import re
import secrets

from conexion import RAIZ, RUTA_ENV, conectar, configuracion

ENV_CRM = RAIZ / "apps" / "crm" / ".env.local"


def cifrar_scram(clave: str, iteraciones: int = 4096) -> str:
    """El formato en que Postgres guarda las contraseñas: así la base nunca recibe el texto."""
    sal = os.urandom(16)
    salada = hashlib.pbkdf2_hmac("sha256", clave.encode(), sal, iteraciones)
    llave_cliente = hmac.new(salada, b"Client Key", "sha256").digest()
    guardada = hashlib.sha256(llave_cliente).digest()
    llave_servidor = hmac.new(salada, b"Server Key", "sha256").digest()

    def b64(x: bytes) -> str:
        return base64.b64encode(x).decode()

    return f"SCRAM-SHA-256${iteraciones}:{b64(sal)}${b64(guardada)}:{b64(llave_servidor)}"


def escribir_variables(ruta, valores: dict[str, str]) -> None:
    texto = ruta.read_text(encoding="utf-8") if ruta.exists() else ""
    for nombre, valor in valores.items():
        linea = f"{nombre}={valor}"
        if re.search(rf"^{nombre}=.*$", texto, flags=re.M):
            texto = re.sub(rf"^{nombre}=.*$", lambda _, linea=linea: linea, texto, flags=re.M)
        else:
            if "# Fase 6" not in texto:
                texto = (
                    texto.rstrip("\n")
                    + "\n\n# Fase 6: el usuario propio del asistente público en la base (solo el servidor)\n"
                )
            texto = texto.rstrip("\n") + "\n" + linea + "\n"
    ruta.write_text(texto, encoding="utf-8")


def main() -> None:
    v = configuracion()
    # El pooler de Supabase identifica el proyecto en el usuario (postgres.<referencia>); SUPABASE_DB_HOST tiene que
    # ser el host del pooler, porque el CRM se conecta a él por el puerto 6543 (modo transacción)
    if "." not in (v.get("SUPABASE_DB_USER") or ""):
        raise SystemExit("SUPABASE_DB_USER debe ser el usuario del pooler: postgres.<referencia del proyecto>")
    referencia = v["SUPABASE_DB_USER"].split(".", 1)[1]
    clave = secrets.token_urlsafe(32)
    with conectar() as con:
        existe = con.execute("select 1 from pg_roles where rolname = 'asistente_web'").fetchone()
        if not existe:
            raise SystemExit("No existe asistente_web: aplica primero la migración 025.")
        # El texto cifrado no tiene comillas (base64 y signos $ : =): se puede poner tal cual
        con.execute(f"alter role asistente_web login password '{cifrar_scram(clave)}'")
        con.commit()
    variables = {
        "ASISTENTE_DB_HOST": v["SUPABASE_DB_HOST"],
        "ASISTENTE_DB_USUARIO": f"asistente_web.{referencia}",
        "ASISTENTE_DB_CLAVE": clave,
    }
    escribir_variables(RUTA_ENV, variables)
    escribir_variables(ENV_CRM, variables)
    print("Listo: asistente_web ya puede entrar. La contraseña quedó en .env y apps/crm/.env.local (no se muestra).")
    print("Para publicar, copia las tres variables ASISTENTE_DB_* a Vercel (Production, tipo Secret).")


if __name__ == "__main__":
    main()
