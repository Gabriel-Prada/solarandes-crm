"""Empaqueta cada skill de skills/ en un .zip para subirla a Claude (Configuración → Capacidades → Skills).

Uso: .venv/Scripts/python scripts/skills/empaquetar.py
Deja los .zip en skills/dist/ (no se suben a GitHub: se regeneran con este comando).
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
            print(f"Lista: {empaquetar(carpeta).relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
