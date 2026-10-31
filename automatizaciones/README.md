# Automatizaciones de SolarAndes (n8n)

Los flujos de la fase 3. El plan completo y las decisiones están en [docs/plan-fase-3.md](../docs/plan-fase-3.md); el mapa de todas las piezas y la guía para explicarlas, en [docs/guia-fase-3.md](../docs/guia-fase-3.md).

**El repo es la fuente de la verdad.** Cada flujo es un archivo en `flujos/`, como las migraciones de la base de datos. Un flujo se cambia aquí (o en n8n y luego se exporta) y se sube con el script. Los archivos **no traen secretos**: de cada credencial solo guardan su nombre (por ejemplo `Telegram SolarAndes`) y su código interno, nunca el token, que se queda cifrado dentro de n8n. Si el código no coincide en otro n8n, n8n la busca por el nombre.

**Solo se manejan los flujos del proyecto**: los que empiezan con dos dígitos, quizás una letra, y un espacio (`00 `, `01b `…). Un flujo de práctica en n8n con otro nombre nunca se exporta, para que nada personal llegue al repo, que es público.

## Los flujos

| Archivo | Qué hace | Estado |
|---|---|---|
| [00-alertas-de-error.json](flujos/00-alertas-de-error.json) | Cuando cualquier flujo falla, avisa por **dos canales independientes**, Telegram y correo: qué flujo, en qué paso, el error, la hora y el enlace a la ejecución. Cada canal lo intenta hasta 3 veces (el primer intento y 2 reintentos), y si uno falla el otro igual se intenta. Solo termina en verde si llegaron los dos; si falló uno, termina en rojo diciendo cuál y el motivo probable ("Telegram falló; el aviso llegó solo por correo: no hay fila telegram en destinos_prueba"). Si la tabla no tiene a quién avisar, también falla a la vista | ✅ Activo, probado (normal, Telegram roto y sin destino) |
| [00b-enviar-correo-seguro.json](flujos/00b-enviar-correo-seguro.json) | Subflujo que **envía correos con destino seguro** (lo usan 01c y 03): recibe los correos (`para`, `quien`, `asunto`, `texto` y una referencia `ref`), revisa cada destino contra `destinos_prueba` (lo que no está se desvía al correo de prueba) y los manda. Un correo que falla no detiene a los demás: devuelve por cada uno si salió (`ok`, solo si Gmail lo aceptó) y el error, y quien llamó decide qué hacer. No tiene flujo de errores propio: su error le llega a quien lo llamó (si no, una falla avisaría dos veces) | ✅ Publicado, probado desde 01c y 03 |
| [01-captura-de-leads-web.json](flujos/01-captura-de-leads-web.json) | (Entrada por webhook, para pruebas y futuros canales; el formulario público usa el buzón, ver 01d.) El que llama al webhook manda el lead (`POST /webhook/lead-web`) → se entrega a la puerta del CRM (`/api/automatizaciones/leads`, con la credencial `CRM SolarAndes (automatizaciones)`; hasta 3 intentos si no contesta) → según la respuesta: **registrado** (200 con la respuesta esperada) = "¡Gracias!" al formulario y llama a 01c; **datos inválidos** = el motivo al formulario, sin alarma; **cualquier otra cosa** (CRM caído) = guarda el lead en `leads_pendientes`, responde "Recibimos tu solicitud" y dispara la alarma | ✅ Activo, probado en local (nuevo, repetido, inválido y CRM apagado) |
| [01b-reintentar-leads-pendientes.json](flujos/01b-reintentar-leads-pendientes.json) | La cola de reintentos: cada 2 minutos toma **un** lead de `leads_pendientes` (el que menos intentos lleva, para que uno problemático no tranque a los demás) y lo reenvía al CRM. Entró → lo quita de la cola y llama a 01c. Datos inválidos → lo quita y suena la alarma con sus datos (hay que registrarlo a mano). Sigue fallando → suma un intento, y cada 10 intentos suena la alarma. Reenviar nunca duplica: el lead lleva la misma clave | ✅ Activo, probado (3 leads con el CRM apagado entraron solos al prenderlo) |
| [01c-avisos-de-un-lead.json](flujos/01c-avisos-de-un-lead.json) | Subflujo (lo llaman 01 y 01b, con un lead a la vez): primero le pide al CRM la **reserva de los avisos** (`/api/automatizaciones/avisos`, con el número de su ejecución); solo la primera ejecución que la pide sigue (si la misma ejecución vuelve a pedir porque se perdió la respuesta, la reserva sigue siendo suya), así los avisos salen una sola vez aunque el mismo envío llegue dos veces a la vez. Después arma los avisos según lo que pasó en el CRM (bienvenida al lead si dejó correo; aviso al asesor; aviso a la gerente si hay posible duplicado, asesor inactivo o ciudad sin asesor; si quien atiende es la gerente, los motivos van en su mismo aviso), los envía con el subflujo **00b** (destino seguro); si alguno no salió, el flujo falla y llega la alerta; si salieron todos, **confirma** al CRM (`accion: confirmar`), que borra los datos copiados del envío | ✅ Publicado, probado (incluido el mismo envío dos veces a la vez: avisos una sola vez) |
| [01d-revisar-el-buzon-del-crm.json](flujos/01d-revisar-el-buzon-del-crm.json) | **El buzón del formulario web.** El formulario público `/cotiza` vive en el CRM y registra el lead al instante, sin n8n. Cada minuto, 01d le pregunta al CRM (`/api/automatizaciones/pendientes`) qué leads no tienen avisos y llama a 01c por cada uno. Al final junta las alarmas en un solo aviso, sin repetirlas cada minuto (usa la memoria del flujo): CRM que no contesta (cada 30 minutos mientras dure), avisos sin confirmar (con la ejecución que los reservó: revisarla antes de reenviar), un tope del formulario alcanzado, falta `HUELLA_SECRETA` en el CRM o un aviso que falló | ✅ Activo, probado en local con el formulario real |
| [03-seguimiento-de-ventas.json](flujos/03-seguimiento-de-ventas.json) | **Seguimiento de ventas.** Cada hora de 8 a. m. a 6 p. m., de lunes a viernes, le pide al CRM (`/api/automatizaciones/seguimiento`, `accion: tomar`) los resúmenes de hoy que faltan: a cada asesor, sus ventas que llegaron a 3+ días sin actividad y sus tareas sin venta vencidas hace 3+ días; a la gerente, las que llegaron a 7+ días, por asesor. El CRM decide qué va (la regla única de la vista `seguimiento_ventas` y el registro de qué se avisó, migración 016), los reserva y los devuelve ya escritos. Los envía con 00b y, por cada uno, confirma (`confirmar`: el CRM anota qué se avisó) o lo suelta (`soltar`: la hora siguiente lo intenta otra vez). Antes de las 12 m. nada suena; desde las 12 m., si algo no salió (o no hay una gerente activa que reciba los avisos de 7+ días), una sola alarma al día, sin nombres de clientes | Probado en local; se activa al publicar el CRM |
| [05-reporte-semanal.json](flujos/05-reporte-semanal.json) | **Reporte semanal a la gerente.** Cada hora de 7 a. m. a 6 p. m., de lunes a viernes, pide al CRM (`/api/automatizaciones/reporte`) el reporte de la semana que acaba de terminar. La base de datos lo entrega **una sola vez por semana** (reserva por semana; nunca en sábado ni domingo) con las cifras de la semana y de la anterior (leads por canal, ganadas, perdidas y sus motivos, por asesor) y la foto de hoy (lo abierto, el valor ponderado y las ventas con 7+ días, comparadas con el reporte anterior). Si sale después del lunes, dice que llega tarde. Mismo patrón que 03: 00b, confirmar o soltar, una alarma al día desde las 12 m. | Probado en local; se activa al publicar el CRM |
| [06-posventa.json](flujos/06-posventa.json) | **Mantenimiento cada 6 meses.** Cada hora de 9 a. m. a 6 p. m., de lunes a viernes, pide al CRM (`/api/automatizaciones/posventa`) los aniversarios de los últimos 30 días (cada 6 meses desde la primera venta ganada del cliente). La base de datos crea de una vez la tarea del asesor del contacto ("Agendar el mantenimiento de los 6 meses", sin venta: si se vence, la vigila el 03) y devuelve los recordatorios a clientes, que salen por 00b (siempre desviados: los clientes son del set de datos). Un recordatorio que no sale en 7 días se vence y hace sonar la alarma enseguida | Probado en local (9 tareas y 9 recordatorios reales); se activa al publicar el CRM |
| [09-avisos-del-asistente.json](flujos/09-avisos-del-asistente.json) | **Los avisos del asistente público (fase 6).** Cada 2 minutos pide al CRM (`/api/automatizaciones/asistente`) los avisos que dejó Sol: "visita pedida" y "un cliente pidió un asesor" (con el resumen hecho por IA, marcado así). Mismo patrón que el 08: reservar → 00b (destino seguro) → confirmar o soltar. Alarmas, sin nombres de clientes: la ventanilla no responde (si no es todo el CRM caído: eso lo avisa 01d), avisos atascados, correos que no salieron y, una vez al día, "el asistente llegó a su tope del día" | Se activa al publicar el asistente |
| [99-prueba-de-error.json](flujos/99-prueba-de-error.json) | Falla a propósito, para probar las alertas | Apagado (se prende solo para probar) |

Reglas:
- Todo flujo nuevo lleva en su configuración `"errorWorkflow": "00 Alertas de error"` (las pruebas lo revisan). La excepción es 00b: lo llaman otros flujos, que reciben su error y avisan.
- **El flujo "00 Alertas de error" no se renombra**: los demás lo buscan por ese nombre.
- Si renombras un flujo en n8n, `exportar` avisa del archivo viejo que sobra. Bórralo; si no, el próximo `subir` revive el flujo viejo.
- El flujo 99 tiene una dirección conocida (el repo es público). Cuando haya túnel, mantenerlo apagado es lo que evita que cualquiera llene de alertas falsas el Telegram.
- **Destino seguro** (subflujo 00b): todo correo pasa por ahí. Si el destino está en la lista blanca (`destinos_prueba`, tipo `correo`), sale tal cual; si no (por ejemplo, los correos `@solarandes.test` del equipo), se desvía al correo de prueba con el asunto "[Prueba: era para Andrés Rojas <…>] …". Ningún mensaje real sale hacia el set de datos.
- Los flujos se llaman entre sí por nombre (01 y 01b llaman a "01c Avisos de un lead"; 01c y 03 a "00b Enviar correo seguro"). El script traduce nombres y códigos internos, sube primero los flujos nombrados y **publica los subflujos**: en n8n 2.x un flujo publicado no puede llamar a un subflujo sin publicar.
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

## Cómo probar el seguimiento

1. Con el CRM prendido y `crm_url` apuntando a él, abre **03 Seguimiento de ventas** en n8n y dale **Execute**: llegan al correo de prueba los resúmenes de hoy (desviados: "[Prueba: era para Andrés Rojas <…>] Seguimiento: …").
2. Dale **Execute** otra vez: no sale nada (un resumen por persona al día).
3. Con el CRM apagado, **Execute**: después de las 12 m. el flujo termina en rojo con "Seguimiento de ventas: no se pudieron pedir los resúmenes al CRM (el CRM no contesta…)". Probado a mano no llega la alerta (n8n solo la manda en ejecuciones por horario); en las de verdad, sí.
4. Los números del correo, del panel de Laura y del tablero de ventas salen de la misma vista (`seguimiento_ventas`): deben coincidir.

## Cómo probar el reporte y la posventa

- **Reporte (05):** de lunes a viernes, con `crm_url` apuntando al CRM, dale **Execute**: llega al correo de prueba "Reporte semanal SolarAndes: …". Otra vez: no sale nada (uno por semana). En sábado o domingo no sale nunca. Para ver el texto con otra semana, las pruebas llaman a `tomar_reporte_semanal` con una fecha (la ventanilla no lo permite).
- **Posventa (06):** **Execute** crea las tareas de los aniversarios de los últimos 30 días (en el CRM, en la ficha de cada cliente) y manda sus recordatorios, desviados al correo de prueba. Otra vez: nada nuevo.

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
- Límites aceptados: los 3 intentos de "Registrar en el CRM" solo ocurren cuando el CRM no contesta (un código de error va directo a la cola y a la alarma, y la cola lo resuelve), y el envío de correos (00b) no reintenta solo: reintentar el paso completo reenviaría también los correos que sí salieron. Un correo que falla se informa: 01c falla y llega la alerta (los avisos se reenvían a mano); 03 suelta ese resumen y lo intenta la hora siguiente.
- n8n **reescribe los mensajes de error** que contienen códigos de red como `ECONNREFUSED` por un texto genérico en inglés. Por eso el motivo se traduce a español antes de guardarlo y de usarlo en la alarma.
- El paso de Telegram, sin formato elegido, lee el texto como Markdown: un `_` sin cerrar (`leads_pendientes`) hace que Telegram rechace el mensaje. Las alertas se mandan en HTML. Se descubrió porque la alarma llegó solo por correo y quedó en rojo diciendo "Telegram falló": para eso son dos canales.
