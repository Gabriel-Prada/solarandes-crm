# Automatizaciones de SolarAndes (n8n)

Los flujos de la fase 3. El plan completo y las decisiones están en [docs/plan-fase-3.md](../docs/plan-fase-3.md).

**El repo es la fuente de la verdad.** Cada flujo es un archivo en `flujos/`, como las migraciones de la base de datos. Un flujo se cambia aquí (o en n8n y luego se exporta) y se sube con el script. Los archivos **no traen secretos**: de cada credencial solo guardan su nombre (por ejemplo `Telegram SolarAndes`) y su código interno, nunca el token, que se queda cifrado dentro de n8n. Si el código no coincide en otro n8n, n8n la busca por el nombre.

**Solo se manejan los flujos del proyecto**: los que empiezan con dos dígitos y un espacio (`00 `, `01 `…). Un flujo de práctica en n8n con otro nombre nunca se exporta, para que nada personal llegue al repo, que es público.

## Los flujos

| Archivo | Qué hace | Estado |
|---|---|---|
| [00-alertas-de-error.json](flujos/00-alertas-de-error.json) | Cuando cualquier flujo falla, avisa por Telegram: qué flujo, en qué paso, el error, la hora y el enlace a la ejecución. Si Telegram falla, reintenta 3 veces. Si la tabla no tiene a quién avisar, **falla a la vista** (queda una ejecución roja en n8n) en vez de terminar en verde sin avisar a nadie | ✅ Activo, probado |
| [99-prueba-de-error.json](flujos/99-prueba-de-error.json) | Falla a propósito, para probar las alertas | Apagado (se prende solo para probar) |

Reglas:
- Todo flujo nuevo lleva en su configuración `"errorWorkflow": "00 Alertas de error"` (las pruebas lo revisan).
- **El flujo "00 Alertas de error" no se renombra**: los demás lo buscan por ese nombre.
- Si renombras un flujo en n8n, `exportar` avisa del archivo viejo que sobra. Bórralo; si no, el próximo `subir` revive el flujo viejo.
- El flujo 99 tiene una dirección conocida (el repo es público). Cuando haya túnel, mantenerlo apagado es lo que evita que cualquiera llene de alertas falsas el Telegram.
- Pendiente: si Telegram falla los 3 reintentos, no hay segundo aviso. El respaldo por correo llega con el Gmail (flujo 1).

## Comandos

```bash
.venv/Scripts/python scripts/n8n/flujos.py subir        # del repo a n8n (crea o actualiza por nombre)
.venv/Scripts/python scripts/n8n/flujos.py subir 00     # solo los que empiezan por 00
.venv/Scripts/python scripts/n8n/flujos.py exportar     # de n8n al repo
```

Necesitan n8n prendido (configuración `n8n` de `.claude/launch.json`, http://localhost:5678) y `N8N_API_KEY` en `.env`. Las pruebas del script (`tests/test_flujos_n8n.py`) no necesitan n8n.

## Lo que vive dentro de n8n y no en el repo

- **Credenciales:** `Telegram SolarAndes` (el token del bot @Solarandes_bot).
- **Tabla de datos `destinos_prueba`** (columnas `tipo`, `valor`, `nota`): los únicos destinos que pueden recibir mensajes reales (el chat de Telegram de las alertas, el correo y el celular de prueba). Son datos personales de Gabriel; por eso no van en el repo. Para que las alertas le lleguen a otra persona, se agrega una fila con `tipo = telegram` y su chat_id.

## Cómo probar las alertas

1. En n8n, activa **99 Prueba de error**.
2. Llama a su dirección: `POST http://localhost:5678/webhook/prueba-error`.
3. Llega un Telegram con "Falló un flujo de SolarAndes".
4. Vuelve a apagar el flujo 99.

Dos cosas que aprendimos con n8n 2.x:
- El flujo de errores **tiene que estar activo** (publicado). Si no, n8n no lo ejecuta y la falla pasa en silencio.
- n8n solo llama al flujo de errores en ejecuciones **reales** (por webhook u horario), no cuando se prueba un flujo a mano desde el editor.
