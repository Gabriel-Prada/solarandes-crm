# SolarAndes

Sistema comercial para una instaladora de paneles solares ficticia: CRM, automatizaciones, IA aplicada y servidor MCP.

> Este README lo escribe Gabriel al cierre de cada fase. Por ahora solo tiene lo mínimo para correr el proyecto.

## Probar el CRM

Entra a **https://solarandes-crm.vercel.app** con cualquiera de estos usuarios de demostración. Todos usan la contraseña `Wi480A9ZIV17MJdI`.

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `andres.rojas@solarandes.test` | Asesor | Ver y trabajar solo sus clientes: crear contactos, cotizar, agendar visitas y mover ventas en el tablero |
| `laura.mendez@solarandes.test` | Gerente | Ver todo el equipo y el panel de métricas |
| `jhon.munoz@solarandes.test` | Técnico | Ver solo sus visitas agendadas, desde el celular |

Todos los datos son ficticios y se recargan de vez en cuando, así que puedes crear, cotizar y mover ventas con libertad.

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
