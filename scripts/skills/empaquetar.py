"""Empaqueta cada skill de skills/ en un .zip para subirla a Claude (Configuración → Capacidades → Skills).

Uso: .venv/Scripts/python scripts/skills/empaquetar.py
Deja en skills/dist/ un .zip y un .skill de cada una (el mismo paquete con las dos extensiones que acepta Claude;
al subirlas desde el navegador de la app, el .skill elegido con clic funcionó y el .zip arrastrado no).
No se suben a GitHub: se regeneran con este comando.
"""

import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SKILLS = RAIZ / "skills"
DESTINO = SKILLS / "dist"


def empaquetar(carpeta: Path) -> Path:
    """La carpeta de la skill, con su SKILL.md adentro, como pide Claude. Sin cachés de Python."""
    DESTINO.mkdir(exist_ok=True)
    salida = DESTINO / f"{carpeta.name}.zip"
    with zipfile.ZipFile(salida, "w", zipfile.ZIP_DEFLATED) as zip_:
        for archivo in sorted(carpeta.rglob("*")):
            if archivo.is_file() and "__pycache__" not in archivo.parts:
                zip_.write(archivo, archivo.relative_to(SKILLS))
    return salida


def main() -> None:
    for carpeta in sorted(SKILLS.iterdir()):
        if (carpeta / "SKILL.md").exists():
            zip_ = empaquetar(carpeta)
            copia = zip_.with_suffix(".skill")
            copia.write_bytes(zip_.read_bytes())
            print(f"Lista: {zip_.relative_to(RAIZ)} (y {copia.name})")


if __name__ == "__main__":
    main()
