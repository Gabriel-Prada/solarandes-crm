"""Hook de Claude Code: formatea con ruff cada archivo Python que Claude edita.

Si después de formatear quedan errores del linter, se los devuelve a Claude (código de salida 2)
para que los corrija en el mismo momento.
"""

import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
RUFF = RAIZ / ".venv" / "Scripts" / "ruff.exe"


def main() -> int:
    evento = json.load(sys.stdin)
    ruta = evento.get("tool_input", {}).get("file_path", "")
    if not ruta.endswith(".py") or not Path(ruta).exists() or not RUFF.exists():
        return 0

    subprocess.run([RUFF, "format", "--quiet", ruta], cwd=RAIZ)
    revision = subprocess.run([RUFF, "check", "--fix", "--quiet", ruta], cwd=RAIZ, capture_output=True, text=True)
    if revision.returncode != 0:
        print(f"ruff encontró problemas en {ruta}:\n{revision.stdout}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
