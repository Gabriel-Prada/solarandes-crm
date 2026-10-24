# Plan de la fase 3: automatizaciones en n8n

*Escrito al empezar la fase (2026-10-23). Se actualiza cuando cambie una decisión.*

---

## 1. La idea en 30 segundos

Hasta ahora el CRM solo hace algo cuando una persona entra y hace clic. En esta fase el negocio empieza a **moverse solo**: cuando llega un lead, queda guardado, asignado y avisado sin que nadie lo toque; cuando un lead se enfría, alguien se entera; el lunes, Laura recibe sus números.

Lo hace **n8n**, que funciona como el **recepcionista** de la empresa: recibe lo que llega (un formulario, un WhatsApp, la hora del día), decide a quién avisar y manda los mensajes. El **CRM es el archivo**, con sus reglas. El recepcionista no archiva carpetas por su cuenta: se las entrega al archivista, que sabe dónde va cada cosa y si ya existe.

Resuelve dos problemas de [requisitos.md](requisitos.md): **P4** (los leads tardan horas en ser atendidos y se olvidan los seguimientos) y **P5** (el técnico se entera tarde de sus visitas).

---

## 2. Los flujos, en orden

| # | Flujo | Cuándo se dispara | Qué hace | Necesita |
|---|---|---|---|---|
| 0 | **Alertas de error** ✅ | Cuando cualquier otro flujo falla | Avisa por Telegram (y correo) qué falló, cuándo y con enlace a la ejecución. Hecho y probado el 2026-10-23, con Telegram y correo como canales independientes | Telegram + correo (SMTP) |
| 1 | **Captura de leads por la web** | Alguien llena el formulario | Revisa duplicados, crea el lead en el CRM, lo asigna, da la bienvenida y avisa al asesor | CRM + correo |
| 2 | **Captura por WhatsApp** | Alguien le escribe al número de la empresa | Lo mismo que el 1, pero desde WhatsApp | Meta (WhatsApp) + n8n visible desde internet |
| 3 | **Seguimiento** | Todos los días a las 8 a. m. | Lead con 3 días sin actividad → recordatorio al asesor; con 7 → aviso a Laura | CRM + correo |
| 4 | **Visitas técnicas** | Un asesor agenda una visita en el CRM | Crea el evento en el calendario, avisa al técnico y le recuerda al cliente el día antes | Google Calendar |
| 5 | **Reporte semanal** | Cada lunes a las 7 a. m. | Correo a Laura con las métricas de la semana | CRM + correo |
| 6 | **Posventa** | Todos los días | Instalación cumple 6 meses → recordatorio de mantenimiento | CRM + correo o WhatsApp |
| 7 | **Entrega** | Al final | Flujos exportados al repo, documentación, diagrama y guía de estudio | — |

**Por qué este orden:**
- **El 0 va primero** porque todos los demás se cuelgan de él. Construirlo al final sería como instalar la alarma de incendios después de mudarse.
- **El 1 es el corazón** de la fase y el que pide el "Listo cuando". Empieza por la web y no por WhatsApp porque la web no depende de Meta: así probamos toda la cadena antes de pelear con la configuración de WhatsApp.
- **El 2 reutiliza el 1**: WhatsApp solo es otra puerta de entrada al mismo proceso.
- **Del 3 al 6** son flujos "con reloj" (se disparan por horario) y se parecen entre sí; el 3 es el más útil para el negocio.

---

## 3. Qué decides tú y qué decido yo

### Lo tuyo (cuentas, dinero y publicar)

**A. Dónde corre n8n.** Es la decisión más importante, porque WhatsApp y el formulario público necesitan que n8n sea **visible desde internet** (que tenga una dirección a la que otros puedan mandarle cosas).

| Opción | Costo | A favor | En contra |
|---|---|---|---|
| **Local en tu PC (D:) + un túnel** | Gratis | Todo en tu máquina; es lo que dice el PLAN | Solo funciona con el PC prendido. El túnel (por ejemplo Cloudflare Tunnel) es un "pasillo" que hace visible tu n8n en internet mientras está abierto |
| **n8n Cloud** | Prueba gratis de 14 días, luego pago mensual | Siempre prendido, cero instalación | Cuesta; la prueba se acaba en medio de la fase |
| **Un servidor propio (VPS)** | Unos USD 5 al mes | Siempre prendido; se ve muy profesional | Hay que administrar un servidor |

**Decidido (2026-10-23): local + túnel.** n8n 2.44.6 instalado en `D:\herramientas\n8n`; sus datos (flujos, credenciales cifradas y la llave que las cifra) en `D:\herramientas\n8n\datos`. Se prende con la configuración `n8n` de `.claude/launch.json`, en http://localhost:5678. El túnel se instala cuando haga falta que internet llegue a n8n (formulario público y WhatsApp). La versión queda **fija** para que una actualización no cambie nada sin aviso. n8n avisa que en versiones futuras exigirá correr dentro de Docker (un "contenedor": una caja que trae el programa con todo lo que necesita); si algún día se pasa a un servidor, se hace así. Los nodos de código se escriben en JavaScript (el ejecutor de Python no está instalado y no hace falta).

**Por qué esta opción:** **local + túnel** para construir (gratis, y es lo previsto). Para la presentación de la fase 7 decides si vale la pena pagar un servidor unos meses. Honestidad para la entrevista: "¿cómo sabrías que un flujo falló a las 3 a. m.?" tiene una respuesta distinta si n8n está apagado; en producción iría en un servidor.

**B. Las cuentas** (las creas tú; nunca pegues contraseñas ni llaves en el chat):

| Cuenta | Para qué | Cuándo |
|---|---|---|
| **Telegram + un bot** (se crea en 2 minutos hablándole a @BotFather) | Las alertas de error en tu celular | Flujo 0 |
| **Gmail exclusivo de SolarAndes** (ya estaba en el PLAN) | Bienvenida al lead, avisos al asesor, reporte del lunes y respaldo de las alertas (✅ creado) | Flujo 0 y 1 |
| **Contraseña de aplicación de Gmail** (✅ hecha) | Para que n8n envíe correos por SMTP. Se intentó primero un proyecto de Google Cloud con OAuth, pero Google lo marcó como posible infracción al crearlo (cuenta nueva, permisos de Gmail): para enviar correos no hace falta | Flujo 0 y 1 |
| **Google Calendar** (pendiente de decidir) | Crear los eventos de las visitas. Sin Google Cloud no hay acceso oficial al calendario: se decide al llegar al flujo 4 (apelar en Google Cloud u otra vía) | Flujo 4 |
| **Meta for Developers** con el número de prueba de WhatsApp | Recibir y enviar WhatsApp. El número de prueba solo le escribe a máximo 5 números que tú verifiques: justo lo que queremos | Flujo 2 |

**C. Los destinos de prueba autorizados**: qué celular(es) y correo(s) tuyos pueden recibir mensajes de verdad. Todo lo demás se desvía (ver la decisión 5).

**D. Una variable en Vercel**: el CRM publicado necesitará una llave nueva (la decisión 2). Agregarla en Vercel es tocar tu cuenta, así que lo haces tú o me das el visto bueno.

### Lo mío (decisiones técnicas, ya tomadas)

1. **n8n orquesta; el CRM guarda las reglas.** n8n no escribe directo en las tablas ni lleva su propia copia de "¿es la misma persona?". Le pide al CRM, por una puerta de entrada (`/api/automatizaciones/leads`), que registre el lead. **¿Por qué?** Las reglas de duplicados ya existen dos veces (Python y TypeScript, [guia-fase-2.md](guia-fase-2.md)) y se prueban con los mismos casos. Una tercera copia dentro de n8n terminaría diferente sin que nadie lo note. Con esta decisión, **la captura usa exactamente las reglas de la fase 2**. De paso, la prueba del "Listo cuando" (apagar el CRM y que llegue la alerta) tiene sentido: si el archivista no responde, el recepcionista avisa.

2. **La puerta de entrada tiene una llave propia**, distinta de la llave de servicio de Supabase. n8n solo conoce esa llave, y esa llave solo abre esa puerta. Si se filtra, se cambia sin tocar nada más. Es la diferencia entre darle al mensajero la llave del buzón o la del edificio.

3. **Nada se duplica si el mismo lead llega dos veces.** Cada envío trae una **clave de idempotencia**: un número único del envío (como el número de radicado de un trámite). La base de datos guarda esas claves y **rechaza la segunda vez** la misma clave, aunque las dos lleguen al mismo milisegundo. Lo hace la base de datos y no n8n, porque es la única que puede garantizarlo cuando dos copias llegan juntas. Es lo de la fase 1: **las reglas que no se pueden romper viven en la base de datos.**

4. **La asignación sigue la regla del cliente.** [requisitos.md](requisitos.md) dice: cada lead va al asesor de su ciudad. El PLAN dice "rotativa". Las junto así: el lead va a los asesores **activos** de su ciudad, y si hay varios, al que lleva más tiempo sin recibir uno (eso es la rotación). Si la ciudad no tiene asesor activo (vacaciones, renuncia: el dolor de Laura), se rota entre todos y se le avisa a Laura. Hoy hay un asesor por ciudad, así que se comporta como siempre; la rotación queda lista para cuando crezca el equipo.

5. **"Destino seguro": ningún mensaje real sale hacia el set de datos.** Todo envío pasa por un mismo paso que revisa una **lista blanca** (los destinos de prueba de la decisión C). Si el destino no está, el mensaje **se desvía** a tu correo de prueba con el asunto "[Prueba: era para …]". Los correos del equipo (`@solarandes.test`) no existen, así que los avisos a asesores también llegan ahí. Así se cumple la regla de `CLAUDE.md` por diseño, no por cuidado.

6. **`historial_etapas.cambiado_por` vacío = "lo hizo el sistema".** El pendiente de la fase 1 se resuelve con lo que ya dice [modelo-datos.md](modelo-datos.md) (D2): el primer paso de una venta (`nuevo`) lo hace el sistema cuando llega el lead, y vacío significa exactamente eso. Ningún flujo de esta fase mueve ventas de etapa (eso lo hace el asesor en el CRM), así que no hace falta inventar un "usuario robot". Si un flujo futuro mueve etapas, se crea uno.

7. **Duda de duplicado = se crea igual y se avisa.** En la fase 2, lo dudoso se quedaba afuera, porque era un Excel viejo y podía esperar. Un lead del formulario es una persona **esperando respuesta hoy**. Perderlo es peor que tener un duplicado, y unir a dos personas sigue siendo lo peor de todo. Entonces: se crea como contacto nuevo y Laura recibe "posible duplicado de C0123, revísalo".

8. **Cada flujo, con prueba y en el repo.** La lógica (duplicados, asignación, idempotencia) se prueba con pruebas automáticas en el CRM y en la base de datos. Los flujos se exportan como archivos a `automatizaciones/`; los archivos exportados **no incluyen las credenciales**, que se quedan guardadas (cifradas) dentro de n8n.

---

## 4. El primer flujo, diseñado: captura de leads por la web

### El recorrido

```mermaid
flowchart TD
    F[Formulario web] -->|nombre, celular, ciudad, correo,<br/>consumo, mensaje, id del envío| W[n8n: Webhook]
    W --> P[Preparar datos y clave del envío]
    P --> C{{CRM: /api/automatizaciones/leads}}
    C -->|3 intentos; si sigue fallando| E[Flujo 0: alerta de error]
    C --> S{¿Qué respondió?}
    S -->|creado| B[Bienvenida al lead] --> A[Aviso al asesor]
    S -->|posible duplicado| B2[Bienvenida al lead] --> A2[Aviso al asesor y a Laura]
    S -->|ya era cliente| A3[Aviso al asesor: tu cliente volvió a escribir]
    S -->|ya procesado| N[Nada: era un envío repetido]
    A & A2 & A3 & N --> R[Responder al formulario: recibido]
```

Todos los mensajes pasan por el paso **Destino seguro** antes de salir.

### Lo que pasa dentro del CRM (la puerta de entrada)

1. Revisa la llave. Sin llave o con una equivocada → "no autorizado" y no hace nada.
2. Limpia los datos con las reglas de la fase 2: celular a `+57…`, ciudad bien escrita, nombre con mayúsculas. Si falta algo obligatorio (celular, ciudad) → "datos inválidos", y **n8n no reintenta**: reintentar no arregla un celular mal escrito.
3. ¿Esta clave de envío ya llegó? → "ya procesado", con el mismo código de contacto de la primera vez.
4. Busca a la persona en el CRM con `buscarEnCrm`, la misma función de la importación de CSV.
5. Según el resultado: crea el contacto con su oportunidad y le asigna asesor; o, si ya existe, le anota una actividad "Volvió a escribir por la web: …".
6. En los dos casos le deja al asesor una **tarea**: "Contactar a este lead". Esa tarea es la que el flujo 3 vigilará para el seguimiento.
7. Responde a n8n: qué pasó, el código del contacto (C0281) y a quién se asignó.

Los pasos 3 a 6 ocurren **en una sola operación** de la base de datos: o se guarda todo, o nada (como `crear_contacto_con_venta` en la fase 1).

**Lo que quedó construido en la base de datos (migraciones 009 y 010, aplicadas el 2026-10-24):**
- `envios_recibidos`: el libro de radicados (clave única por envío).
- `asesor_para_lead(ciudad)`: asesor activo de la ciudad; entre varios, el que lleva más tiempo sin recibir un contacto; sin asesor en la ciudad, rota entre todos (y la respuesta trae `fuera_de_ciudad`).
- `capturar_lead(...)`: solo la llama la llave de servicio. Casos: lead nuevo (`creado`), cliente que vuelve (`existente`), dudoso (`revision`: si su celular ya es de otro contacto, solo deja una nota en ese contacto, sin unir datos ni abrir venta), envío repetido (`ya_procesado`). Si el asesor del cliente ya no está activo, la tarea va a la gerente (`asesor_inactivo`). Los datos raros no tumban el lead: con empresa es negocio, consumo con decimales se redondea y fuera de rango deja la venta "por definir".
- Para la puerta del CRM: un error `22023` (por ejemplo, sin nombre ni empresa) es **dato inválido** y no se reintenta; un `23505` (celular único) solo pasa si llegan dos envíos distintos de la misma persona nueva a la vez, y sí se reintenta (la segunda vez entra como cliente existente).
- La migración 010 corrigió lo que encontró la revisión de código de la 009: un asesor sin ciudad se llevaba todos los leads, la tarea de un cliente de un asesor inactivo quedaba huérfana, los datos raros tumbaban el lead, no había turno al asignar y sobraban permisos en la tabla de radicados.

### Cuando algo falla

| Qué falla | Qué pasa |
|---|---|
| El mismo envío llega dos veces (doble clic, el formulario reintenta) | La segunda vez el CRM responde "ya procesado" y n8n no manda nada |
| El CRM está caído o tarda | n8n reintenta 3 veces, con pausas. Si sigue fallando, el flujo 0 te avisa por Telegram con el enlace a la ejecución; el lead queda guardado en esa ejecución y se puede **reintentar** desde n8n cuando el CRM vuelva |
| Los datos vienen malos | No se reintenta; queda registrado como error de datos y el formulario le pide al cliente corregir |
| El correo de bienvenida falla | El lead **ya quedó** en el CRM (lo importante). Te llega la alerta y el correo se puede reenviar |

### Qué se construye para este flujo

| Pieza | Dónde | Prueba |
|---|---|---|
| ✅ Migraciones 009 y 010: tabla de claves de envío y función que asigna asesor y crea el lead en una sola operación | `supabase/migraciones/` | ✅ `tests/test_captura_leads_supabase.py`, 20 pruebas contra la base real: asignación y rotación, envío repetido, cliente existente, celular compartido, asesor inactivo, datos raros, nadie de afuera puede llamarla |
| ✅ Puerta de entrada del CRM (y migración 011: la llave de servicio solo lee las 6 columnas que se comparan) | `apps/crm/src/app/api/automatizaciones/leads/route.ts`, con la lógica en `apps/crm/src/lib/automatizaciones/lead.ts` | ✅ Vitest (`lead.test.ts`): llave, datos malos, negocio que vuelve, familia con un celular, consumo absurdo, errores de la base. En vivo contra el CRM local: 401, 400, creado, ya procesado y negocio existente |
| Flujo 0 (alertas) y flujo 1 (captura) | n8n, exportados a `automatizaciones/` | Prueba de punta a punta: un envío real del formulario y, con el CRM apagado, la alerta |
| Formulario web | Una página pública sencilla (se decide al construir si va dentro del CRM) | Se prueba con el flujo |

---

## 5. Antes de construir

1. Lee este plan y pregunta lo que no quede claro.
2. Decide **dónde corre n8n** (sección 3.A).
3. Crea el **bot de Telegram** y el **Gmail de SolarAndes**; define tus **destinos de prueba**.
4. Con eso, instalo n8n (si es local, en `D:\herramientas\n8n`) y empezamos por el flujo 0.

Meta (WhatsApp) y Google Calendar pueden esperar hasta los flujos 2 y 4.
