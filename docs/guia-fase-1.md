# Guía de la fase 1: el CRM de SolarAndes

Qué se construyó, cómo funciona por dentro y por qué se tomó cada decisión. Está escrita para poder explicar el proyecto en una entrevista.

**Demo:** https://solarandes-crm.vercel.app · **Código:** https://github.com/Gabriel-Prada/solarandes-crm

---

## 1. La idea en 30 segundos

> SolarAndes es una instaladora de paneles solares (ficticia) que perdía clientes porque cada asesor llevaba sus contactos en el celular y en un Excel. Construí un CRM web donde cada persona ve solo lo que le corresponde según su rol: la gerente ve todo y tiene un panel con métricas; cada asesor ve sus clientes y mueve sus ventas en un tablero; el técnico ve sus visitas desde el celular. Los permisos los aplica la base de datos, no solo la app, y todo tiene pruebas automáticas.

---

## 2. Las piezas y cómo se conectan

```
   Navegador (Laura, Andrés, Jhon Fredy…)
        │  1. pide una página
        ▼
   Vercel (internet) ── corre la app Next.js
        │  2. el "proxy" revisa si hay sesión
        │  3. la página pide datos "en nombre" de quien entró
        ▼
   Supabase ── base de datos Postgres + inicio de sesión
        │  4. aplica los permisos por rol (RLS) y entrega solo lo permitido
        ▼
   La página se arma en el servidor y vuelve al navegador
```

| Pieza | Qué es | Para qué la usamos |
|---|---|---|
| **Next.js** | Herramienta para construir apps web con React | Las pantallas y la lógica del servidor, en un solo proyecto |
| **Supabase** | Servicio que da una base de datos Postgres, inicio de sesión y un panel visual | Guardar los datos y saber quién es cada usuario |
| **Vercel** | Servicio que publica apps web en internet | Tener el CRM en un link público; se actualiza solo con cada `git push` |
| **GitHub** | Donde vive el código con su historial | Portafolio, copia de seguridad y fuente para Vercel |

---

## 3. La base de datos

### Las tablas (los "cajones del archivador")

| Tabla | Qué guarda | Se conecta con |
|---|---|---|
| `perfiles` | Las 6 personas del equipo y su rol | Es el "responsable" de contactos, ventas y actividades |
| `contactos` | Los 1.000 clientes y posibles clientes | Un contacto tiene muchas oportunidades |
| `oportunidades` | Cada venta posible, con su etapa y valor | Tiene actividades, cotizaciones e historial |
| `actividades` | Llamadas, WhatsApp, visitas, notas y tareas | Pertenece a un contacto y, opcionalmente, a una venta |
| `cotizaciones` | Las propuestas de precio enviadas | Pertenece a una venta |
| `historial_etapas` | Cada cambio de etapa: de dónde a dónde, quién y cuándo | Pertenece a una venta |
| `productos` | El catálogo | Independiente |

La relación clave es **"uno a muchos"**: *un* contacto tiene *muchas* oportunidades; *una* oportunidad tiene *muchas* actividades. Detalle completo y diagrama: [modelo-datos.md](modelo-datos.md).

### Las 5 decisiones de diseño (y por qué)

1. **Hogares y negocios en una sola tabla.** Comparten casi todos los datos. Dos tablas duplicarían pantallas y búsquedas.
2. **Guardar el historial de etapas.** Sin él solo se sabe dónde está una venta *hoy*. Con él se responde "¿en qué etapa se pierden más ventas?".
3. **Las cotizaciones guardan una "foto" del precio.** Si los precios suben, una cotización vieja sigue mostrando lo que se ofreció ese día.
4. **Un código interno largo (UUID) y uno corto para personas (C0153).** Un asesor puede decir "el cliente C0153".
5. **Las etapas son una lista fija.** La base de datos no acepta una etapa que no exista.

### La base de datos "se cuida sola"

No todo depende de que la app haga las cosas bien. La propia base de datos tiene reglas:

- **Validaciones (`check`):** no deja guardar un teléfono mal escrito, ni una venta "perdida" sin motivo, ni un estrato en un negocio.
- **Probabilidad calculada:** la probabilidad de cierre se calcula sola a partir de la etapa (nuevo 5 %, cotizado 50 %…). Nunca queda desactualizada.
- **Historial automático (trigger):** un *trigger* es una regla que se dispara sola cuando pasa algo. Cada vez que una venta cambia de etapa, la base de datos anota quién la movió y cuándo, y pone o quita la fecha de cierre. **Nadie, ni siquiera la gerente, puede escribir el historial a mano.**
- **Búsqueda sin tildes:** una columna calculada guarda nombre, empresa, teléfono y código en minúsculas y sin tildes. Así "panaderia" encuentra "Panadería".
- **Un teléfono = un contacto:** la base de datos no acepta dos contactos con el mismo teléfono. La regla tiene que vivir ahí porque un asesor no ve los contactos de los demás (RLS) y desde la app no podría saber si ya existe.
- **El precio lo calcula la base de datos:** la función `calcular_cotizacion` es la autoridad final. La pantalla muestra una vista previa, pero lo que se guarda siempre se recalcula en la base.
- **Numeración sin choques:** las cotizaciones se numeran solas (COT-2026-0001…). Si dos asesores cotizan al mismo tiempo, un "candado" hace que uno espere al otro para que no se repita el número.

**La idea de fondo de toda la fase:** la app no es la única puerta a la base de datos. Cualquier usuario con sesión puede hablarle a Supabase directamente, y en las fases siguientes también lo harán n8n y el servidor MCP. Por eso las reglas que tienen que cumplirse siempre (permisos, historial, precios) viven en la base de datos: es el único punto por el que pasa todo.

### Migraciones

Una **migración** es un archivo numerado con cambios a la base de datos, como el historial de remodelaciones de una casa. Si mañana hay que crear la base de datos desde cero, se aplican en orden y queda idéntica.

| Migración | Qué hace |
|---|---|
| [001](../supabase/migraciones/001_esquema_crm.sql) | Tablas, validaciones, historial automático, permisos por rol y la vista del técnico |
| [002](../supabase/migraciones/002_busqueda_sin_tildes.sql) | La búsqueda sin tildes |
| [003](../supabase/migraciones/003_panel_gerente.sql) | La función que calcula las métricas del panel |
| [004](../supabase/migraciones/004_corrige_panel_gerente.sql) | Corrige el panel tras la revisión de código |
| [005](../supabase/migraciones/005_crear_ventas_y_cotizaciones.sql) | Teléfono único y numeración automática de cotizaciones (con versiones: la anterior queda "reemplazada") |
| [006](../supabase/migraciones/006_crear_contacto_con_venta.sql) | Crea un contacto y su primera venta en una sola operación: o se guardan los dos, o ninguno |
| [007](../supabase/migraciones/007_cotizar_en_la_base_de_datos.sql) | La fórmula de cotización en la base de datos y permisos por columna. Cierra huecos que encontró la revisión de código |
| [008](../supabase/migraciones/008_potencia_sin_ceros_de_mas.sql) | Muestra la potencia como "3,85 kWp" y no "3.8500000000000000" |

**Regla:** una migración ya aplicada nunca se edita. Si hay un error, se corrige con una nueva (por eso existe la 004). Así el historial cuenta la verdad.

---

## 4. La seguridad: tres capas

| Capa | Dónde | Qué hace | Si fallara… |
|---|---|---|---|
| 1. Menú | [navegacion.ts](../apps/crm/src/lib/navegacion.ts) | Cada rol ve solo sus secciones | …alguien podría escribir la dirección a mano |
| 2. Página | `exigirRol()` en [sesion.ts](../apps/crm/src/lib/sesion.ts) | Cada página revisa el rol en el servidor y devuelve al inicio a quien no corresponde | …la base de datos igual no entregaría los datos |
| 3. Base de datos | RLS en la migración 001 | Solo entrega las **filas** que le corresponden a cada persona | — es la última defensa |

### Row Level Security (RLS), la capa más importante

RLS significa "seguridad por fila". En cada tabla hay reglas escritas como *"un asesor solo puede ver los contactos donde `asesor_id` es él mismo"*. La base de datos aplica esas reglas **en cada consulta**, sin importar desde dónde venga. Por eso la página de contactos no filtra por asesor: no le hace falta.

**Resultado comprobado:** Laura ve 1.000 contactos, Andrés 456, Valentina 295, Camilo 249, y el técnico y la contadora, 0.

### Filas vs. columnas: la vista del técnico

RLS decide **qué filas** ve alguien, pero no **qué columnas**. El técnico necesita el nombre, el teléfono y la dirección de sus clientes, pero no su consumo, su correo ni los precios. Por eso no lee la tabla `contactos`: lee una **vista** (`visitas_tecnico`), una consulta guardada que solo trae lo que él necesita. Es como darle una fotocopia de la ficha con los datos sensibles tapados.

### Otras decisiones de seguridad

- **La app usa la llave publicable, nunca la secreta.** La publicable se puede ver en el navegador sin problema, porque la seguridad la ponen las reglas RLS. La secreta (que se salta todo) solo la usan los scripts de carga de datos, desde tu computador.
- **Los secretos viven en `.env`**, un archivo que git tiene prohibido subir. Antes de cada commit revisamos que no se colara ninguno.
- **"Seguridad por defecto" en Supabase:** las tablas nuevas nacen protegidas y ninguna queda disponible para la app por accidente.
- **Mínimo privilegio:** cada pieza tiene solo los permisos que necesita. Pasa con el subagente revisor (solo lee), con Vercel (solo ve un repositorio) y con el técnico (solo ve sus visitas).
- **Mensaje de error genérico al iniciar sesión** ("correo o contraseña incorrectos"): no revela si un correo existe.
- **Permisos por columna** (migración 007): RLS decide qué filas puedes tocar; además, en una venta un asesor solo puede cambiar la etapa y el motivo de pérdida, no el valor. Y nadie puede escribir cotizaciones directamente: solo a través de la función `crear_cotizacion`, que calcula el precio ella misma.
- **"Venta no encontrada" sirve para todo:** si intentas cotizar una venta ajena, la respuesta es la misma que si no existiera. Así no se revela qué ventas existen.

---

## 5. Cómo funciona la app por dentro

### El inicio de sesión, paso a paso

1. La persona escribe correo y contraseña. El formulario los envía a una **acción del servidor** ([acciones.ts](../apps/crm/src/app/login/acciones.ts)).
2. El servidor se los pasa a Supabase, que verifica la contraseña. **La app nunca guarda contraseñas.**
3. Supabase devuelve una "credencial" que queda guardada en una **cookie**: un dato que el navegador guarda y envía en cada visita, para recordar que la persona ya entró.
4. En cada visita, el **proxy** ([proxy.ts](../apps/crm/src/proxy.ts)), que es el "portero", renueva esa credencial si está por vencer y manda a `/login` a quien no la tiene.

### Servidor vs. navegador

- **La mayoría del código corre en el servidor** (componentes de servidor): pide los datos a Supabase, arma la página y la envía lista. Los datos nunca pasan por el navegador sin control.
- **Solo lo interactivo corre en el navegador** (componentes de cliente, marcados con `"use client"`): el formulario de inicio de sesión, el tablero que se arrastra y los botones.

### Acciones del servidor

Cuando alguien guarda algo, como registrar una actividad o mover una venta, el navegador llama a una **acción del servidor**, una función que corre en el servidor. Cada acción:
1. **Vuelve a verificar quién es y su rol**, porque una acción se puede llamar sin pasar por la página.
2. **Valida los datos**: el tipo de actividad existe, la descripción no está vacía, la venta pertenece a ese contacto.
3. Guarda en Supabase, donde RLS vuelve a aplicar los permisos.
4. Llama a `refresh()` para que la pantalla muestre los datos nuevos.

### Actualización optimista (el tablero)

Al mover una tarjeta, la pantalla **asume que va a salir bien** y la cambia de columna al instante, sin esperar al servidor. Si el servidor rechaza el cambio, la tarjeta vuelve sola y aparece el error. Así se siente rápido.

### Una venta completa, de principio a fin

Este es el recorrido que pide el "Listo cuando" del plan: un asesor inicia sesión y lleva una venta de cero a "Ganado".

1. **Crear el contacto** (botón "Nuevo contacto"). El formulario llama a la función `crear_contacto_con_venta` (migración 006), que guarda el contacto **y** su primera venta **en una sola operación**: o se guardan los dos, o ninguno. Si se guardaran por separado y fallara la venta, quedaría un contacto suelto que el asesor ni siquiera podría borrar (solo la gerente borra). El teléfono se valida y no puede repetirse.
2. **Cotizar** (en la ficha del contacto). Mientras el asesor escribe el consumo en kWh, la pantalla calcula al instante paneles y precio con [cotizacion.ts](../apps/crm/src/lib/cotizacion.ts). Al guardar, la función `crear_cotizacion` de la base de datos hace todo en un solo paso: revisa que la venta sea tuya, **recalcula el precio**, numera la cotización, pone el valor en la venta, la pasa a "Cotizado" si estaba antes y anota una actividad "Envío de cotización COT-…".
3. **Agendar la visita técnica** ([acciones-venta.ts](../apps/crm/src/app/(crm)/contactos/[codigo]/acciones-venta.ts)). Se crea una actividad de tipo visita asignada al técnico, que le aparece en "Mis visitas", y la venta pasa a "Visita agendada". La fecha se interpreta en hora de Colombia y tiene que ser futura.
4. **Arrastrar a "Ganado"** en el tablero. El trigger anota el historial y la fecha de cierre, la probabilidad sube a 100 % y el panel de la gerente la cuenta como venta ganada.

**¿Por qué la fórmula de cotización está escrita tres veces?** En Python ([reglas.py](../scripts/datos/reglas.py)) genera los datos ficticios; en TypeScript da la vista previa instantánea; en la base de datos es la autoridad que no se puede saltar. El riesgo de duplicar es que se desincronicen. Para evitarlo, una prueba compara más de 2.000 combinaciones de consumo, ciudad y descuento entre Python y la base de datos, y TypeScript usa los mismos ejemplos que Python en sus pruebas.

### Las pantallas

| Pantalla | Quién la ve | Lo interesante por dentro |
|---|---|---|
| **Panel** | Gerente | Todas las métricas se calculan en la base de datos con una sola función que se niega a responder si no eres la gerente |
| **Ventas** (tablero) | Gerente y asesores | Arrastrar y soltar más un selector accesible; motivo obligatorio al perder; alertas a los 3 y 7 días sin actividad |
| **Contactos** | Gerente y asesores | Búsqueda sin tildes, filtros en la dirección (se pueden compartir), páginas de 25 |
| **Nuevo contacto** | Gerente y asesores | Contacto y primera venta en una sola operación; teléfono validado y sin repetir |
| **Ficha del contacto** | Gerente y asesores | Recorrido de etapas desde el historial, cotizaciones, registro de actividades, cotizar con vista previa y agendar la visita técnica |
| **Mis visitas** | Técnico | Diseñada para celular; lee la vista sin datos sensibles |

---

## 6. El panel de la gerente

| Pregunta de Laura | Respuesta que da el panel |
|---|---|
| ¿Cuánto vendimos este mes? | $399,9 M en 13 instalaciones en los últimos 30 días |
| ¿Cuántas ventas se están abandonando? | 64 abiertas llevan 7 o más días sin actividad (58 %) |
| ¿Qué canal funciona mejor? | Los referidos cierran el 29 %; los anuncios, el 7 % |
| ¿Dónde se pierden las ventas? | Sobre todo en "Contactado", porque el cliente deja de responder |

**Decisiones de visualización:** cuando la respuesta es un número, se muestra el número, sin gráfica. Hay un solo color, validado con un script para que se distinga bien y tenga contraste. Cada gráfica tiene "Ver tabla" con los números exactos, y los lectores de pantalla leen cada valor.

**Lo que el panel le dice al negocio:** conviene un programa de referidos, y el gran problema es el seguimiento. Eso justifica las automatizaciones de la fase 3.

---

## 7. Calidad: pruebas y revisiones

### Pruebas automáticas (82)

| Grupo | Cuántas | Qué comprueban |
|---|---|---|
| Datos generados | 12 | Que los datos inventados sean coherentes (teléfonos válidos, embudo realista, historial completo) |
| Regla de cotización (Python) | 16 | La fórmula de paneles y precio, incluido el borde exacto de 10 kWp, y el redondeo del descuento |
| Permisos en la base real | 24 | Que cada rol vea solo lo suyo, que nadie escriba el historial, que el panel solo lo vea la gerente, que la base y Python coticen igual y los "intentos de abuso": cotizar una venta ajena, descuentos de 100 %… |
| CRM (Vitest) | 30 | Búsqueda sin tildes, reglas de seguimiento (justo en 2, 3, 6 y 7 días), la fórmula de cotización en TypeScript y la validación de teléfonos |

Las pruebas de permisos **se hacen pasar por cada persona del equipo** dentro de una transacción que al final se deshace, así que no cambian nada.

### Revisiones de código

Antes de cada entrega, el **subagente revisor** revisó los cambios. Encontró errores reales que las pruebas no veían:

| Qué encontró | Por qué importa |
|---|---|
| Bucle infinito de redirecciones si un usuario no tiene perfil | El navegador se quedaba dando vueltas |
| La sesión renovada se perdía al redirigir | La gente podía quedar desconectada sin razón |
| La alerta del tablero medía "días sin cambiar de etapa" y no "días sin actividad" | **El código funcionaba, pero no cumplía la regla de la clienta** |
| El embudo contaba mal las ventas que se saltan etapas | Los números del panel podían no tener sentido |
| El formulario borraba lo escrito si había un error | Mala experiencia de uso |

**La lección:** que el código funcione no basta. Tiene que cumplir los requisitos. Por eso se escriben, se revisan y se prueban justo en los límites.

---

## 8. La publicación

1. **Vercel se conectó al repositorio de GitHub**, con acceso solo a ese repositorio.
2. Se configuró la carpeta `apps/crm` y las dos **variables de entorno** públicas de Supabase. Vercel no las conocía porque el `.env.local` nunca sube a GitHub.
3. **Despliegue continuo:** cada `git push` a GitHub publica una versión nueva en uno o dos minutos.
4. Antes de publicar se hizo una **compilación de producción** en local (`npm run build`), porque hay errores que solo aparecen ahí.

---

## 9. Cómo se trabajó con IA

- **`CLAUDE.md`** le da a Claude el contexto del proyecto en cada sesión: qué es, las reglas y cómo trabajamos.
- **Subagente revisor de código:** revisa antes de cada commit; solo puede leer.
- **Subagente probador:** corre pruebas y escribe las que falten; solo puede tocar la carpeta de pruebas.
- **Skill `cerrar-fase`:** comprueba la lista de "listo cuando" y hace las preguntas de "Explícalo tú".
- **Hook de formato:** cada archivo de Python que se edita se formatea solo.
- **Documentación oficial antes de programar:** Next.js 16 cambió cosas importantes (por ejemplo, el "middleware" ahora se llama "proxy"), así que se leyó la guía incluida en la versión instalada en vez de confiar en lo que "se sabía".

**Tu rol:** definir qué se construye, tomar las decisiones de producto, conectar cuentas y credenciales, probar y entender cada pieza. La IA escribe la mayor parte del código; tú respondes por él.

---

## 10. Glosario

| Término | Significado |
|---|---|
| **CRM** | Sistema para gestionar clientes, ventas y seguimiento |
| **Lead** | Persona interesada que todavía no ha comprado |
| **Embudo (pipeline)** | Las etapas por las que pasa una venta |
| **Migración** | Archivo numerado con un cambio a la base de datos |
| **RLS** | Seguridad por fila: reglas en la base de datos sobre qué filas ve cada usuario |
| **Vista** | Consulta guardada que se usa como si fuera una tabla, con solo algunas columnas |
| **Trigger** | Regla que la base de datos ejecuta sola cuando pasa algo (por ejemplo, al cambiar una etapa) |
| **Cookie** | Dato que el navegador guarda y envía en cada visita (aquí, la sesión) |
| **Proxy** | En Next.js 16, el código que corre antes de cada página; aquí funciona como portero |
| **Acción del servidor** | Función que corre en el servidor y se llama desde un formulario o botón |
| **Actualización optimista** | Mostrar el cambio en pantalla antes de que el servidor confirme |
| **Variable de entorno** | Configuración que se le da a la app desde afuera, sin escribirla en el código |
| **Despliegue continuo** | Cada cambio subido a GitHub se publica solo |
| **Commit / push** | Guardar una "foto" del proyecto / subirla a GitHub |

---

## 11. Preguntas probables de entrevista

**¿Cómo organizaste la base de datos?**
Alrededor de las oportunidades de venta. Un contacto tiene varias oportunidades, y cada una acumula actividades, cotizaciones y su historial de etapas. Las etapas son una lista fija y la base de datos valida los datos por sí sola.

**¿Cómo evitas que un asesor vea los clientes de otro?**
Con tres capas: el menú, la revisión del rol en cada página y, sobre todo, Row Level Security en la base de datos. Aunque alguien manipule la app, Supabase solo le entrega sus filas. Lo comprueban pruebas automáticas que se hacen pasar por cada rol.

**¿Qué pasa cuando alguien mueve una venta a "Ganado"?**
La tarjeta cambia de columna al instante (actualización optimista). La acción del servidor verifica el rol y actualiza la venta. La base de datos, con un trigger, anota el cambio en el historial con quién lo hizo, pone la fecha de cierre y recalcula la probabilidad al 100 %. Luego la pantalla se refresca.

**¿Por qué el historial lo escribe un trigger y no la app?**
Porque la app no es la única que va a cambiar ventas: también lo harán n8n, el servidor MCP o un script. Si el historial dependiera de la app, cualquiera de esas puertas podría olvidarlo. El trigger está pegado a la tabla, así que ningún cambio de etapa se escapa, y nadie puede escribir el historial a mano.

**La fórmula de cotización está en tres lugares. ¿No es duplicar código?**
Sí, a propósito: en la pantalla para dar respuesta inmediata y en la base de datos porque es la autoridad que no se puede saltar (si alguien manipula la vista previa, la base recalcula el precio real). El riesgo es que se desincronicen, y lo controlo con una prueba que compara más de 2.000 casos entre las versiones.

**¿Por qué calculas las métricas en la base de datos y no en la app?**
Porque es más rápido calcular donde están los datos que traer miles de filas. Además, la función se protege sola: exige el rol de gerente.

**¿Qué error interesante encontraste?**
La alerta de seguimiento contaba días sin cambiar de etapa, pero la regla de la clienta era días sin actividad. El código funcionaba, pero no cumplía el requisito. Lo corregí, saqué la regla a una función aparte y le escribí pruebas justo en los límites.

**¿Cómo usaste la IA?**
Como un equipo: Claude Code escribe el código siguiendo un `CLAUDE.md` con las reglas del proyecto. Un subagente revisor solo puede leer y uno probador solo puede tocar las pruebas. Yo decido, pruebo y respondo por cada pieza.
