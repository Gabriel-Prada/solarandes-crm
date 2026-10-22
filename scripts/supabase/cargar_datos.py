"""Carga en Supabase los datos ficticios de data/generados.

1. Crea (o reutiliza) los 6 usuarios del equipo en Supabase Auth, con la contraseña de
   prueba DEMO_PASSWORD del .env. Si no existe, la inventa y la guarda en el .env.
2. Borra los datos de negocio que hubiera y carga todo de nuevo en una sola transacción:
   si algo falla, la base de datos queda como estaba.

Uso: .venv/Scripts/python scripts/supabase/cargar_datos.py
"""

import csv
import secrets
import uuid

import httpx
from conexion import RAIZ, RUTA_ENV, conectar, configuracion

DIR_DATOS = RAIZ / "data" / "generados"


def leer(nombre: str) -> list[dict]:
    with (DIR_DATOS / f"{nombre}.csv").open(encoding="utf-8") as f:
        # Las celdas vacías del CSV son "sin dato" en la base de datos
        return [{k: (v if v != "" else None) for k, v in fila.items()} for fila in csv.DictReader(f)]


def contrasena_demo(v: dict) -> str:
    if v.get("DEMO_PASSWORD"):
        return v["DEMO_PASSWORD"]
    nueva = secrets.token_urlsafe(12)
    with RUTA_ENV.open("a", encoding="utf-8") as f:
        f.write(f"\n# Contraseña de los usuarios ficticios del equipo (todos usan la misma)\nDEMO_PASSWORD={nueva}\n")
    print("Se creó DEMO_PASSWORD en el .env")
    return nueva


def crear_usuarios(v: dict, usuarios: list[dict]) -> dict[str, str]:
    """Devuelve {código del generador (U01) -> id del usuario en Supabase Auth}."""
    cabeceras = {"apikey": v["SUPABASE_SECRET_KEY"], "Authorization": f"Bearer {v['SUPABASE_SECRET_KEY']}"}
    api = f"{v['SUPABASE_URL']}/auth/v1/admin/users"
    clave = contrasena_demo(v)

    with httpx.Client(headers=cabeceras, timeout=60) as cliente:
        existentes = {u["email"]: u["id"] for u in cliente.get(api, params={"per_page": 1000}).json()["users"]}
        ids = {}
        for u in usuarios:
            if u["email"] in existentes:
                ids[u["id"]] = existentes[u["email"]]
                continue
            r = cliente.post(api, json={"email": u["email"], "password": clave, "email_confirm": True})
            r.raise_for_status()
            ids[u["id"]] = r.json()["id"]
            print(f"Usuario creado: {u['email']} ({u['rol']})")
    return ids


def main() -> None:
    v = configuracion()
    usuarios = leer("usuarios")
    id_usuario = crear_usuarios(v, usuarios)

    contactos, oportunidades = leer("contactos"), leer("oportunidades")
    id_contacto = {c["id"]: uuid.uuid4() for c in contactos}
    id_oportunidad = {o["id"]: uuid.uuid4() for o in oportunidades}

    with conectar() as con, con.transaction():
        # Los datos ya traen sus fechas e historial: se apagan los automatismos durante la carga
        con.execute("set local solarandes.carga_masiva = 'on'")
        con.execute("set local timezone = 'America/Bogota'")
        con.execute("truncate contactos, oportunidades, actividades, cotizaciones, historial_etapas, productos")

        for u in usuarios:
            con.execute(
                """insert into perfiles (id, codigo, nombre, email, rol, ciudad) values (%s, %s, %s, %s, %s, %s)
                   on conflict (id) do update set codigo = excluded.codigo, nombre = excluded.nombre,
                     email = excluded.email, rol = excluded.rol, ciudad = excluded.ciudad""",
                (id_usuario[u["id"]], u["id"], u["nombre"], u["email"], u["rol"], u["ciudad"]),
            )

        def copiar(tabla: str, columnas: list[str], filas) -> int:
            n = 0
            with con.cursor().copy(f"copy {tabla} ({', '.join(columnas)}) from stdin") as copia:
                for fila in filas:
                    copia.write_row(fila)
                    n += 1
            return n

        totales = {
            "productos": copiar(
                "productos",
                ["sku", "nombre", "categoria", "precio_cop"],
                ((p["sku"], p["nombre"], p["categoria"], p["precio_cop"]) for p in leer("productos")),
            ),
            "contactos": copiar(
                "contactos",
                [
                    "id",
                    "codigo",
                    "tipo",
                    "nombre",
                    "empresa",
                    "telefono",
                    "email",
                    "ciudad",
                    "direccion",
                    "estrato",
                    "consumo_kwh_mes",
                    "canal_origen",
                    "asesor_id",
                    "creado_en",
                    "actualizado_en",
                ],
                (
                    (
                        id_contacto[c["id"]],
                        c["id"],
                        c["tipo"],
                        c["nombre"],
                        c["empresa"],
                        c["telefono"],
                        c["email"],
                        c["ciudad"],
                        c["direccion"],
                        c["estrato"],
                        c["consumo_kwh_mes"],
                        c["canal_origen"],
                        id_usuario[c["asesor_id"]],
                        c["creado_en"],
                        c["creado_en"],
                    )
                    for c in contactos
                ),
            ),
            "oportunidades": copiar(
                "oportunidades",
                [
                    "id",
                    "codigo",
                    "contacto_id",
                    "asesor_id",
                    "tipo",
                    "nombre",
                    "etapa",
                    "potencia_kwp",
                    "valor_cop",
                    "motivo_perdida",
                    "creada_en",
                    "actualizada_en",
                    "fecha_cierre",
                ],
                (
                    (
                        id_oportunidad[o["id"]],
                        o["id"],
                        id_contacto[o["contacto_id"]],
                        id_usuario[o["asesor_id"]],
                        o["tipo"],
                        o["nombre"],
                        o["etapa"],
                        o["potencia_kwp"],
                        o["valor_cop"],
                        o["motivo_perdida"],
                        o["creada_en"],
                        o["actualizada_en"],
                        o["fecha_cierre"],
                    )
                    for o in oportunidades
                ),
            ),
            "actividades": copiar(
                "actividades",
                ["contacto_id", "oportunidad_id", "usuario_id", "tipo", "descripcion", "fecha", "completada"],
                (
                    (
                        id_contacto[a["contacto_id"]],
                        id_oportunidad[a["oportunidad_id"]],
                        id_usuario[a["usuario_id"]],
                        a["tipo"],
                        a["descripcion"],
                        a["fecha"],
                        a["completada"],
                    )
                    for a in leer("actividades")
                ),
            ),
            "cotizaciones": copiar(
                "cotizaciones",
                [
                    "numero",
                    "oportunidad_id",
                    "version",
                    "fecha",
                    "consumo_kwh_mes",
                    "potencia_kwp",
                    "num_paneles",
                    "precio_kwp",
                    "descuento_pct",
                    "valor_total",
                    "estado",
                ],
                (
                    (
                        c["numero"],
                        id_oportunidad[c["oportunidad_id"]],
                        c["version"],
                        c["fecha"],
                        c["consumo_kwh_mes"],
                        c["potencia_kwp"],
                        c["num_paneles"],
                        c["precio_kwp"],
                        c["descuento_pct"],
                        c["valor_total"],
                        c["estado"],
                    )
                    for c in leer("cotizaciones")
                ),
            ),
            "historial_etapas": copiar(
                "historial_etapas",
                ["oportunidad_id", "etapa_anterior", "etapa_nueva", "cambiado_por", "fecha"],
                (
                    (
                        id_oportunidad[h["oportunidad_id"]],
                        h["etapa_anterior"],
                        h["etapa_nueva"],
                        id_usuario[h["cambiado_por"]] if h["cambiado_por"] else None,
                        h["fecha"],
                    )
                    for h in leer("historial_etapas")
                ),
            ),
        }

        # Los códigos nuevos que cree la app continúan después de los cargados (C1001, O1007...)
        con.execute("select setval('contactos_codigo_seq', %s)", (len(contactos),))
        con.execute("select setval('oportunidades_codigo_seq', %s)", (len(oportunidades),))

    for tabla, n in totales.items():
        print(f"{tabla}: {n} filas")


if __name__ == "__main__":
    main()
