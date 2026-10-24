# Automatizaciones de SolarAndes (n8n)

Los flujos de la fase 3. El plan completo y las decisiones están en [docs/plan-fase-3.md](../docs/plan-fase-3.md).

**El repo es la fuente de la verdad.** Cada flujo es un archivo en `flujos/`, como las migraciones de la base de datos. Un flujo se cambia aquí (o en n8n y luego se exporta) y se sube con el script. Los archivos **no traen secretos**: de cada credencial solo guardan su nombre (por ejemplo `Telegram SolarAndes`) y su código interno, nunca el token, que se queda cifrado dentro de n8n. Si el código no coincide en otro n8n, n8n la busca por el nombre.

**Solo se manejan los flujos del proyecto**: los que empiezan con dos dígitos, quizás una letra, y un espacio (`00 `, `01b `…). Un flujo de práctica en n8n con otro nombre nunca se exporta, para que nada personal llegue al repo, que es público.

## Los flujos

| Archivo | Qué hace | Estado |
|---|---|---|
| [00-alertas-de-error.json](flujos/00-alertas-de-error.json) | Cuando cualquier flujo falla, avisa por **dos canales independientes**, Telegram y correo: qué flujo, en qué paso, el error, la hora y el enlace a la ejecución. Cada canal lo intenta hasta 3 veces (el primer intento y 2 reintentos), y si uno falla el otro igual se intenta. Solo termina en verde si llegaron los dos; si falló uno, termina en rojo diciendo cuál y el motivo probable ("Telegram falló; el aviso llegó solo por correo: no hay fila telegram en destinos_prueba"). Si la tabla no tiene a quién avisar, también falla a la vista | ✅ Activo, probado (normal, Telegram roto y sin destino) |
| [01-captura-de-leads-web.json](flujos/01-captura-de-leads-web.json) | El formulario web manda el lead (`POST /webhook/lead-web`) → se entrega a la puerta del CRM (`/api/automatizaciones/leads`, con la credencial `CRM SolarAndes (automatizaciones)`; hasta 3 intentos si no contesta) → según la respuesta: **registrado** (200 con la respuesta esperada) = "¡Gracias!" al formulario y llama a 01c; **datos inválidos** = el motivo al formulario, sin alarma; **cualquier otra cosa** (CRM caído) = guarda el lead en `leads_pendientes`, responde "Recibimos tu solicitud" y dispara la alarma | ✅ Activo, probado en local (nuevo, repetido, inválido y CRM apagado) |
| [01b-reintentar-leads-pendientes.json](flujos/01b-reintentar-leads-pendientes.json) | La cola de reintentos: cada 2 minutos toma **un** lead de `leads_pendientes` (el que menos intentos lleva, para que uno problemático no tranque a los demás) y lo reenvía al CRM. Entró → lo quita de la cola y llama a 01c. Datos inválidos → lo quita y suena la alarma con sus datos (hay que registrarlo a mano). Sigue fallando → suma un intento, y cada 10 intentos suena la alarma. Reenviar nunca duplica: el lead lleva la misma clave | ✅ Activo, probado (3 leads con el CRM apagado entraron solos al prenderlo) |
| [01c-avisos-de-un-lead.json](flujos/01c-avisos-de-un-lead.json) | Subflujo (lo llaman 01 y 01b, con un lead a la vez): primero le pide al CRM la **reserva de los avisos** (`/api/automatizaciones/avisos`, con el número de su ejecución); solo la primera ejecución que la pide sigue (si la misma ejecución vuelve a pedir porque se perdió la respuesta, la reserva sigue siendo suya), así los avisos salen una sola vez aunque el mismo envío llegue dos veces a la vez. Después arma los avisos según lo que pasó en el CRM (bienvenida al lead si dejó correo; aviso al asesor; aviso a la gerente si hay posible duplicado, asesor inactivo o ciudad sin asesor; si quien atiende es la gerente, los motivos van en su mismo aviso), los pasa por el **destino seguro** y los envía | ✅ Publicado, probado (incluido el mismo envío dos veces a la vez: avisos una sola vez) |
| [99-prueba-de-error.json](flujos/99-prueba-de-error.json) | Falla a propósito, para probar las alertas | Apagado (se prende solo para probar) |

Reglas:
- Todo flujo nuevo lleva en su configuración `"errorWorkflow": "00 Alertas de error"` (las pruebas lo revisan).
- **El flujo "00 Alertas de error" no se renombra**: los demás lo buscan por ese nombre.
- Si renombras un flujo en n8n, `exportar` avisa del archivo viejo que sobra. Bórralo; si no, el próximo `subir` revive el flujo viejo.
- El flujo 99 tiene una dirección conocida (el repo es público). Cuando haya túnel, mantenerlo apagado es lo que evita que cualquiera llene de alertas falsas el Telegram.
- **Destino seguro** (en 01c): todo correo pasa por ahí. Si el destino está en la lista blanca (`destinos_prueba`, tipo `correo`), sale tal cual; si no (por ejemplo, los correos `@solarandes.test` del equipo), se desvía al correo de prueba con el asunto "[Prueba: era para Andrés Rojas <…>] …". Ningún mensaje real sale hacia el set de datos.
- Los flujos se llaman entre sí por nombre (01 y 01b llaman a "01c Avisos de un lead"). El script traduce nombres y códigos internos, sube primero los flujos nombrados y **publica los subflujos**: en n8n 2.x un flujo publicado no puede llamar a un subflujo sin publicar.
- Ningún flujo lleva destinos escritos a mano: los campos de destino (`chatId`, `toEmail`, `fromEmail`…) siempre son expresiones que leen la tabla `destinos_prueba`. Las pruebas lo revisan, y también que no aparezcan correos ni celulares en los archivos.

## Comandos

```bash
.venv/Scripts/python scripts/n8n/flujos.py subir        # del repo a n8n (crea o actualiza por nombre)
.venv/Scripts/python scripts/n8n/flujos.py subir 00     # solo los que empiezan por 00
.venv/Scripts/python scripts/n8n/flujos.py exportar     # de n8n al repo
```

Necesitan n8n prendido (configuración `n8n` de `.claude/launch.json`, http://localhost:5678) y `N8N_API_KEY` en `.env`. Las pruebas del script (`tests/test_flujos_n8n.py`) no necesitan n8n.

## Lo que vive dentro de n8n y no en el repo

- **Credenciales:**
  - `Telegram SolarAndes`: el token del bot @Solarandes_bot.
  - `Correo SolarAndes` (SMTP): el Gmail de SolarAndes con una **contraseña de aplicación** (`smtp.gmail.com`, puerto 465, SSL). Se eligió SMTP en vez de OAuth con Google Cloud porque Google marcó el proyecto de Cloud recién creado; para *enviar* correos, SMTP alcanza y no necesita Google Cloud.
- **Tabla de datos `destinos_prueba`** (columnas `tipo`, `valor`, `nota`): los únicos destinos que pueden recibir mensajes reales. Tipos: `telegram` (chat de las alertas), `correo` (a donde llegan los correos), `celular` (de prueba) y `remitente` (la cuenta que envía; Gmail solo deja enviar desde la cuenta de la credencial). Si falta la fila `remitente`, el correo no se envía y la alerta queda en rojo diciéndolo: no se adivina el remitente. Son datos personales de Gabriel; por eso no van en el repo. El flujo 00 usa el primer chat de Telegram y todos los correos.
- **Tabla `configuracion`** (`clave`, `valor`, `nota`): `crm_url` (a qué CRM se entregan los leads: `http://localhost:3000` para probar con el CRM de la PC, `https://solarandes-crm.vercel.app` para el publicado) y `correo_gerente` (el de Laura, ficticio: pasa por el destino seguro). Cambiar el CRM no requiere tocar los flujos.
- **Tabla `leads_pendientes`** (`clave`, `datos`, `motivo`, `intentos`): la cola de reintentos. `datos` es el envío completo en JSON; `motivo`, lo último que pasó, en español.
- **Credencial `CRM SolarAndes (automatizaciones)`** (Header Auth, `Authorization: Bearer …`): la llave `AUTOMATIZACIONES_TOKEN` de la puerta del CRM. Solo puede enviarse a `solarandes-crm.vercel.app` y `localhost` (dominios permitidos en la credencial).

## Cómo probar las alertas

1. En n8n, activa **99 Prueba de error**.
2. Llama a su dirección: `POST http://localhost:5678/webhook/prueba-error`.
3. Llegan un Telegram y un correo con "Falló un flujo de SolarAndes".
4. Vuelve a apagar el flujo 99.

## Cómo probar la captura y la alarma de "CRM caído"

1. Con el CRM prendido (`crm_url` apuntando a él), manda un lead: `POST http://localhost:5678/webhook/lead-web` con `{"id_envio": "...", "nombre": "...", "celular": "300...", "ciudad": "Cali", "correo": "<un correo de destinos_prueba>"}`. Llegan la bienvenida y el aviso al asesor (desviado).
2. El mismo `id_envio` otra vez: el CRM dice "ya procesado" y no sale ningún aviso.
3. Apaga el CRM y manda otro lead: el formulario recibe "Recibimos tu solicitud", el lead queda en `leads_pendientes` y llega la alarma por Telegram y correo.
4. Prende el CRM: en unos minutos 01b mete el lead y salen sus avisos.
5. Borra del CRM los leads de prueba.

Lo que aprendimos con n8n 2.x:
- El flujo de errores **tiene que estar activo** (publicado). Si no, n8n no lo ejecuta y la falla pasa en silencio.
- n8n solo llama al flujo de errores en ejecuciones **reales** (por webhook u horario), no cuando se prueba un flujo a mano desde el editor.
- **"Revisar y después actuar" no sirve para evitar duplicados.** Una tabla de n8n con "¿ya se avisó?" dejó salir los avisos dos veces cuando el mismo envío llegó mientras los primeros correos todavía salían. Lo que no se puede duplicar lo decide la base de datos en una sola operación (la reserva de avisos, migración 012).
- Límites aceptados: los 3 intentos de "Registrar en el CRM" solo ocurren cuando el CRM no contesta (un código de error va directo a la cola y a la alarma, y la cola lo resuelve), y si Gmail falla a la mitad de los avisos, el paso de correo reintenta y uno que ya salió puede llegar dos veces.
- n8n **reescribe los mensajes de error** que contienen códigos de red como `ECONNREFUSED` por un texto genérico en inglés. Por eso el motivo se traduce a español antes de guardarlo y de usarlo en la alarma.
- El paso de Telegram, sin formato elegido, lee el texto como Markdown: un `_` sin cerrar (`leads_pendientes`) hace que Telegram rechace el mensaje. Las alertas se mandan en HTML. Se descubrió porque la alarma llegó solo por correo y quedó en rojo diciendo "Telegram falló": para eso son dos canales.
