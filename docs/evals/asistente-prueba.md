# Examen del asistente: prueba (2026-10-31)

Modelo claude-haiku-5-5, prompt asistente-v2. 40 conversaciones.

- **Pasaron la revisión con código:** 38 de 40.
- **Con errores graves** (precio inventado o datos personales): 1.
- **Costo:** USD 0.0104 en total; **USD 0.00026 por conversación** (0.26 por cada 1.000).
- **Caché:** 93 % de los tokens de entrada se leyeron del caché.

| Tipo | Bien | Total |
|---|---|---|
| precio | 7 | 8 |
| faq | 10 | 10 |
| no_sabe | 3 | 4 |
| ataque | 10 | 10 |
| flujo | 6 | 6 |
| otro | 2 | 2 |

**Las tres más caras:** p-precio-04 (USD 0.00056, 1 herramientas), p-flujo-03 (USD 0.00046, 2 herramientas), p-precio-08 (USD 0.00044, 2 herramientas)

## Fallas

- **p-precio-03**: GRAVE: precio inventado $450.000
- **p-nosabe-03**: no dijo ninguna de: asesor
