# SolarAndes

Sistema comercial para una instaladora de paneles solares ficticia: CRM, automatizaciones, IA aplicada y servidor MCP.

> Este README lo escribe Gabriel al cierre de cada fase. Por ahora solo tiene lo mínimo para correr el proyecto.

## Cómo correrlo

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python scripts/datos/generar_datos.py
.venv/Scripts/pytest
```

## Documentos

- [Plan del portafolio](PLAN.md)
- [Requisitos del cliente](docs/requisitos.md)
