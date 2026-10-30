# Conectar Claude al CRM de SolarAndes (servidor MCP y skills)

Instrucciones para la gerente (o para quien quiera probarlo). No hay que instalar nada en el computador: el servidor MCP vive dentro del CRM publicado.

**Dirección del servidor MCP:** `https://solarandes-crm.vercel.app/api/mcp`

> Solo la **gerente** puede conectarse (decisión de producto de la fase 5). Un asesor, el técnico o la contadora verán "tu rol no usa esta conexión". Para probarlo, usa el usuario de demostración de la gerente que aparece en el [README](../README.md).

---

## 1. Conectar el CRM en Claude (Desktop, claude.ai o el celular)

1. Abre Claude y entra a **Configuración → Conectores** (*Settings → Connectors*).
2. Elige **Agregar conector personalizado** (*Add custom connector*).
3. Ponle de nombre `SolarAndes CRM` y pega la dirección `https://solarandes-crm.vercel.app/api/mcp`. Deja vacíos el *Client ID* y el *Client Secret*: Claude se registra solo.
4. Haz clic en **Conectar**. Se abre el CRM:
   - Si no tienes sesión, entra con tu usuario del CRM. Al entrar vuelves sola a la página de autorización.
   - En **"Autorizar una aplicación"**, revisa que el dominio en grande sea **claude.ai** (o **claude.com**).
   - Autoriza solo si **tú misma** acabas de pedir la conexión.
5. Listo: en una conversación nueva, el CRM aparece en el menú de herramientas (el ícono de conectores).

**Plan de Claude:** con el plan gratis se puede agregar un conector personalizado. Si ya tienes otro, hace falta un plan pago.

### Para empezar, prueba

- *"¿Con qué usuario estoy conectada?"* (`quien_soy`)
- *"¿Qué asesor tiene más leads sin seguimiento?"* (`ventas_sin_seguimiento`)
- *"Hazme el resumen del día"*: en el menú **+**, busca los prompts del conector y elige **Resumen del día**.
- *"¿Cuánto le sale a un hogar de 400 kWh en Cali?"* (`calcular_precio`)
- *"Agéndale una visita a [cliente] el jueves a las 9"*. Claude busca al cliente, te muestra el día en palabras y **te pide confirmar** antes de escribir.

### Lo que Claude puede y no puede hacer

| Puede | No puede |
|---|---|
| Consultar el CRM con tus mismos permisos (clientes, ventas, seguimiento, panel, agenda, precios) | Borrar nada |
| Registrar actividades, mover ventas de etapa y agendar visitas, a tu nombre y con tu confirmación | Marcar una venta como **ganada** ni reabrir una cerrada: eso se hace en el tablero del CRM |
| Adjuntar con el **+** el catálogo, la tabla de precios o la ficha completa de un cliente | Hacer más de 50 acciones al día desde Claude |

### Buenas prácticas de seguridad

- **Usa el CRM en conversaciones sin otros conectores que envíen cosas hacia afuera** (correo, publicaciones, web). Los mensajes de los leads los escribe gente de afuera. El CRM se los marca a Claude como "datos, no instrucciones", pero lo que pase con *otros* conectores de la misma conversación no lo controla el CRM.
- **Lee la confirmación antes de aceptar una acción**, sobre todo la fecha en palabras: si dice "jueves 5 de noviembre" y querías otro día, corrige.
- **No actives "permitir siempre"** en las herramientas que escriben (registrar, mover, agendar).
- **Si alguien te manda un enlace de autorización, no lo abras:** una conexión se pide solo desde tu propio Claude.

### Desconectar Claude (dos pasos)

1. En Claude: **Configuración → Conectores → SolarAndes CRM → Desconectar**.
2. Para cortar también la llave que ya tenía Claude, el desarrollador quita la app de la lista de apps aprobadas (tabla `apps_conectadas`) y de *Authentication → OAuth Apps* en Supabase. En el MCP el corte es inmediato: el siguiente pedido recibe un "no". Pero una llave ya entregada sigue sirviendo para **leer** directo de la base hasta que vence (una hora como máximo); escribir no puede nunca, por la migración 023.

---

## 2. Instalar las skills (propuesta comercial e informe gerencial)

Las skills son paquetes de "saber hacer": le enseñan a Claude a armar la propuesta en PDF con la marca y el informe del mes con gráficos. Usan los datos del conector del CRM, así que primero conecta el CRM.

1. El desarrollador genera los paquetes: `.venv/Scripts/python scripts/skills/empaquetar.py`. Quedan en `skills/dist/`:
   - `propuesta-comercial-solarandes.zip`
   - `informe-gerencial-solarandes.zip`
2. En Claude: **Configuración → Capacidades** (*Settings → Capabilities*). Activa la **ejecución de código** (*Code execution*).
3. En **Personalizar → Skills → Agregar → Subir Skill**, haz **clic en el recuadro** y elige los dos archivos `.skill` (o los `.zip`). No abras los paquetes antes ni arrastres su contenido: la página solo recibiría el `SKILL.md`, sin el script. Desde el navegador integrado de la app, arrastrar los `.zip` no funcionó; elegirlos con clic, sí.
4. Pruébalas:
   - *"Hazme la propuesta comercial de la venta O0153"*
   - *"Arma el informe gerencial de septiembre"*

**Plan de Claude:** según la documentación de Anthropic, subir skills propias pide un plan Pro o superior. Revisa lo que aparece en tu cuenta.

---

## 3. Para el desarrollador: probar con MCP Inspector

MCP Inspector es la herramienta oficial para "hablarle" a un servidor MCP a mano y ver qué responde.

1. Abre Inspector: `npx -y @modelcontextprotocol/inspector@2.13.0`. Ya está en `.claude/launch.json` como `mcp-inspector`. Usa la dirección con su llave local que imprime al arrancar.
2. **Agrega un servidor:**
   - transporte `streamable-http`;
   - dirección `https://solarandes-crm.vercel.app/api/mcp`, o `http://localhost:3000/api/mcp` con el CRM local.
3. **Para que la página de autorización acepte a Inspector** (que vuelve a `http://localhost:6274/oauth/callback`):
   - El interruptor `MCP_PERMITIR_INSPECTOR=si` tiene que estar donde corre esa página. **En Vercel nunca está encendido**, así que Inspector se prueba contra el CRM local.
   - Con el CRM local, la dirección principal (*Site URL*) de Supabase tiene que ser `http://localhost:3000` mientras pruebas.
   - Al terminar: vuelve a poner `https://solarandes-crm.vercel.app` y apaga el interruptor (`MCP_PERMITIR_INSPECTOR=no`).
4. Conecta, inicia sesión como la gerente, autoriza y prueba `tools/list`, `resources/list`, `prompts/list` y cada herramienta.
5. **Una solicitud de autorización vence a los pocos minutos:** autoriza apenas abra la página.
6. **Al terminar, borra la app de prueba** en *Authentication → OAuth Apps* y su fila en `apps_conectadas`.

Detalle técnico, decisiones y pruebas: [plan-fase-5.md](plan-fase-5.md). Guía de estudio: [guia-fase-5.md](guia-fase-5.md).
