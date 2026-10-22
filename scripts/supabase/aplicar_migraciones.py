"""Aplica en Supabase las migraciones de supabase/migraciones que todavía no se han aplicado.

Cada migración corre completa o no corre (una transacción), y queda anotada en
control.migraciones para no repetirla.

Uso: .venv/Scripts/python scripts/supabase/aplicar_migraciones.py
"""

from conexion import RAIZ, conectar

DIR_MIGRACIONES = RAIZ / "supabase" / "migraciones"


def main() -> None:
    archivos = sorted(DIR_MIGRACIONES.glob("*.sql"))
    with conectar() as con:
        con.execute("create schema if not exists control")
        con.execute(
            """create table if not exists control.migraciones (
                 nombre text primary key,
                 aplicada_en timestamptz default now()
               )"""
        )
        con.commit()
        aplicadas = {fila[0] for fila in con.execute("select nombre from control.migraciones")}

        pendientes = [a for a in archivos if a.name not in aplicadas]
        if not pendientes:
            print("No hay migraciones pendientes.")
        for archivo in pendientes:
            with con.transaction():
                con.execute(archivo.read_text(encoding="utf-8"))
                con.execute("insert into control.migraciones (nombre) values (%s)", (archivo.name,))
            print(f"Aplicada: {archivo.name}")


if __name__ == "__main__":
    main()
