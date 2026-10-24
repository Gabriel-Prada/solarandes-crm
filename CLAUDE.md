# SolarAndes: guía para Claude

Portafolio de Gabriel: el sistema comercial de **SolarAndes S.A.S.**, una instaladora de paneles solares **ficticia** en Bogotá, Medellín y Cali. El plan completo está en `PLAN.md` y los requisitos del "cliente" en `docs/requisitos.md`.

**Fase actual: 3 (Automatizaciones en n8n).** Fase 0 cerrada el 2026-10-21; fases 1 y 2 cerradas el 2026-10-23. Actualiza esta línea al cerrar cada fase.

**Fase 3, dónde quedamos (2026-10-23):** plan escrito en `docs/plan-fase-3.md` (flujos 0 a 7, qué decide Gabriel, decisiones técnicas y el flujo 1 diseñado). Gabriel leyó el plan y decidió **n8n local + túnel**: n8n 2.44.6 instalado en `D:\herramientas\n8n` (datos en `D:\herramientas\n8n\datos`, hora de Bogotá); se prende con la configuración `n8n` de `.claude/launch.json` (http://localhost:5678). El túnel se instala cuando haga falta (formulario público, WhatsApp). **Flujo 0 (alertas de error) construido y probado:** el flujo 99 falla a propósito y llegan un Telegram de @Solarandes_bot y un correo. Los flujos viven en `automatizaciones/flujos/` (ver `automatizaciones/README.md`) y se suben o exportan con `scripts/n8n/flujos.py` (usa `N8N_API_KEY` del `.env`). Las alertas van por dos canales independientes (Telegram y correo): verde solo si llegan los dos. En n8n quedan las credenciales `Telegram SolarAndes` y `Correo SolarAndes` (SMTP de Gmail con contraseña de aplicación) y la tabla de datos `destinos_prueba` (lista blanca y remitente; datos personales de Gabriel, nunca en el repo: las pruebas revisan que los flujos no traigan correos ni celulares). En n8n 2.x el flujo de errores tiene que estar activo. Google Cloud quedó descartado para el correo (Google marcó el proyecto `solarandes-n8n` al crearlo; no se apeló): Google Calendar para el flujo 4 está por decidir. **Siguiente: flujo 1 (captura web)**: migración 009, la puerta `/api/automatizaciones/leads` del CRM y el flujo en n8n. Orden: 0 alertas de error → 1 captura web → 2 WhatsApp → 3 seguimiento → 4 visitas → 5 reporte → 6 posventa → 7 entrega. Decisiones clave: n8n no escribe en las tablas ni copia las reglas de duplicados; llama a una puerta del CRM (`/api/automatizaciones/leads`, con llave propia) que usa `buscarEnCrm` de la fase 2; la idempotencia (clave de envío única) y la asignación viven en la base de datos (migración 009); todo envío pasa por "destino seguro" (lista blanca; lo demás se desvía al correo de prueba); en la captura, lo dudoso se crea y se avisa a Laura (un lead vivo no puede esperar). El detalle de `cambiado_por` quedó resuelto: vacío = "lo hizo el sistema" (D2 de `docs/modelo-datos.md`), y ningún flujo de la fase 3 mueve etapas.

**Cierre de la fase 2 (2026-10-23):** publicada (Contactos → Importar CSV) y con guía de estudio en `docs/guia-fase-2.md`. Gabriel aclaró que sabe poco de código: en "Explícalo tú" respondió bien lo de criterio (flujo de importación, por qué el servidor reanaliza, nombres en otro orden) y le costó decir *qué pasa si te equivocas* (unir a dos personas es peor que dejar un duplicado) y el caso de la familia que comparte celular (dijo "unir"; es revisión). Explícale desde el criterio, no desde el código. Pendiente de Gabriel: decidir el caso del Colegio Rodríguez (`data/migracion/para_revisar.csv`; las pistas apuntan a C0059: celular casi igual y mismo consumo) y escribir sus viñetas de las fases 1 y 2 en el README. Mejoras posibles que Gabriel decidió **no** hacer por ahora: una bandeja de revisión en el CRM, que `migrar.py` acepte cualquier Excel (hoy la ruta está fija en `leer_excel.py`) y migrar desde la app; la migración la corre el desarrollador desde la terminal.

**Dónde quedamos (2026-10-23):** fase 1 cerrada. El CRM está publicado en https://solarandes-crm.vercel.app (82 pruebas pasando) y el README tiene los usuarios de demostración. Resumen para estudiar: `docs/guia-fase-1.md`. En "Explícalo tú", Gabriel explicó bien las tablas, RLS y el lado de la app; le costó el *por qué* las reglas viven en la base de datos (trigger, cotización): refuérzalo cuando aparezca en la fase 3 con n8n. Pendiente de Gabriel: escribir sus viñetas de la fase 1 en el README. Detalle para la fase 3 (resuelto en `docs/plan-fase-3.md`, decisión 6): si n8n escribe con la llave de servicio, `auth.uid()` es nulo y `historial_etapas.cambiado_por` queda vacío.

**Fase 2, decisiones tomadas:** las 280 personas del Excel heredado ya están en el CRM (son los contactos más antiguos), así que la migración **concilia**: busca cada persona en el CRM y la enriquece (las notas pasan a actividades), crea solo lo que no existe y manda lo dudoso a revisión; correrla dos veces no duplica. Se hace en Python (`scripts/migracion/`), como una cadena de pasos. `respuestas_migracion.csv` solo se usa para calificar en las pruebas; las reglas de limpieza no se sacan de él ni del generador. Pasos: 1 leer ✅, 2 normalizar ✅ (22 nombres vienen con el apellido primero: comparar nombres sin importar el orden de las palabras), 3 duplicados ✅ (327 filas → 280 personas exactas; las fichas con `pendiente_de_revision` no se cargan en el paso 4; en clientes que ya existen, el CRM manda sobre el asesor), 4 conciliar y cargar ✅ (aplicada en el CRM el 2026-10-23: 92 notas; si se recargan los datos con cargar_datos.py, volver a correr migrar.py --aplicar; `scripts/migracion/migrar.py`: ensayo por defecto, `--aplicar` guarda; 279 personas en el CRM, 92 notas, 1 en revisión: Colegio Rodríguez), 5 reporte ✅ (`scripts/migracion/reporte.py` genera `docs/reporte-migracion.md` y `data/migracion/para_revisar.csv`; con él se cumple el "Listo cuando"), 6 importar CSV desde el CRM ✅ (Contactos → Importar CSV, solo la gerente; la limpieza está traducida a TypeScript en `apps/crm/src/lib/importar/` y los dos lenguajes resuelven los mismos casos de `tests/casos_compartidos/limpieza.json`: si cambias una regla, cámbiala en los dos). Fase cerrada.

`.claude/launch.json` apaga la telemetría de Next.js (`NEXT_TELEMETRY_DISABLED`): sin eso, `next dev` falla al intentar escribir su configuración en C:.

## Con quién trabajas

Gabriel se prepara para trabajar en desarrollo de apps, automatizaciones y CRMs. Tú escribes la mayor parte del código; él decide, prueba, conecta cuentas y credenciales, y **tiene que poder explicar cada pieza en una entrevista**. Por eso:

- Habla en español y en lenguaje claro. Cuando uses un término técnico por primera vez, explícalo en una frase.
- **Explica cada paso antes y después de hacerlo:** qué vas a hacer y para qué; al terminar, qué quedó y dónde verlo (con enlaces a los archivos). Usa analogías cotidianas; no des por sabido qué es un commit, un hook o una migración. Si avanzas rápido y en jerga, Gabriel se pierde (ya pasó).
- Trabaja en pasos pequeños. Antes de un paso importante, di qué vas a hacer y por qué.
- Las decisiones técnicas (tablas, herramientas, flujos) las tomas tú según conveniencia y eficacia, sin pedirle aprobación; pero siempre explícale qué decidiste y por qué. Consúltale solo lo que es suyo: cuentas, dinero, publicar algo o gustos de producto.
- Él sabe más de n8n que de código: apóyate en eso cuando haya que elegir entre n8n y código.
- Las cuentas (GitHub, Supabase, Vercel, Anthropic, Meta) las crea y conecta él. Nunca pidas que pegue contraseñas o llaves en el chat: van en `.env`.

## Estructura

```
PLAN.md                 plan del portafolio por fases
docs/requisitos.md      lo que pidió el cliente, procesos y reglas de negocio
scripts/datos/          generador de datos ficticios
data/generados/         CSVs "limpios" que alimentarán el CRM (se regeneran)
data/heredado/          Excel sucio para la fase 2 y sus respuestas correctas
docs/modelo-datos.md    diseño de tablas, decisiones y permisos por rol
docs/plan-fase-3.md     plan de las automatizaciones en n8n y diseño del flujo 1
supabase/migraciones/   cambios a la base de datos, numerados (001_..., 002_...)
scripts/supabase/       aplicar migraciones y cargar los datos en Supabase
scripts/migracion/      fase 2: leer, limpiar, deduplicar y conciliar el Excel heredado con el CRM
automatizaciones/       fase 3: flujos de n8n exportados (flujos/*.json) y su documentación
scripts/n8n/            subir y exportar los flujos de n8n por su API
apps/crm/               la app web del CRM (Next.js 16 + Supabase). Ver apps/crm/README.md y apps/crm/AGENTS.md
tests/                  pruebas con pytest (test_permisos_supabase.py usa la base de datos real)
.claude/                subagentes, skills y hooks del proyecto
```

Llegarán más carpetas por fase (por ejemplo `apps/crm/` en la fase 1 y `automatizaciones/` en la 3).

## Comandos

```bash
.venv/Scripts/pip install -r requirements.txt      # dependencias de Python
.venv/Scripts/python scripts/datos/generar_datos.py # regenerar todos los datos
.venv/Scripts/pytest                               # correr las pruebas
.venv/Scripts/python scripts/supabase/aplicar_migraciones.py  # aplicar migraciones pendientes en Supabase
.venv/Scripts/python scripts/supabase/cargar_datos.py         # recargar los datos ficticios en Supabase
.venv/Scripts/ruff check . && .venv/Scripts/ruff format .
.venv/Scripts/python scripts/n8n/flujos.py subir      # subir los flujos del repo a n8n (exportar: de n8n al repo)
```

```bash
npm --prefix apps/crm run dev      # CRM en http://localhost:3000
npm --prefix apps/crm run lint     # estilo del código del CRM
npm --prefix apps/crm test         # pruebas del CRM (Vitest, archivos *.test.ts junto al código)
cd apps/crm && npx tsc --noEmit    # revisar tipos (si falla por rutas nuevas: npx next typegen)
```

En Windows se usa `.venv/Scripts/...`; no hay `python3` ni `source`.

**Next.js 16 tiene cambios grandes** (por ejemplo, `middleware` ahora se llama `proxy`). Antes de escribir código del CRM, lee la guía que aplique en `apps/crm/node_modules/next/dist/docs/`. Cache Components está apagado a propósito (ver `apps/crm/next.config.ts`). El caché de npm va en `D:/herramientas/npm-cache` (`apps/crm/.npmrc`).

## Reglas

- **Todo en el disco D:.** Nada se instala ni se guarda en C: salvo lo que el sistema exija.
- **Solo datos ficticios.** Ningún dato real de personas. El generador usa una semilla fija, así que los datos son siempre los mismos (ver `data/README.md`).
- **Las automatizaciones nunca le escriben a contactos del set de datos.** Los teléfonos inventados pueden existir; los mensajes reales solo van a números y correos de prueba autorizados.
- **Nombres del dominio en español** (contactos, oportunidades, asesores), igual que en `docs/requisitos.md`. Código en Python con `snake_case`.
- **Si cambias el generador de datos**, vuelve a correrlo y corre las pruebas: las fases siguientes dependen de esos archivos.
- **Cada cambio con prueba** cuando sea lógica de negocio (cálculos, limpieza de datos, reglas).
- **Commits pequeños**, mensaje en español, en imperativo: "Agrega generador de cotizaciones".
- Los secretos van en `.env` (está en `.gitignore`); en el repo solo va `.env.example`. Nunca imprimas valores secretos del `.env`.
- **La base de datos solo se cambia con migraciones nuevas** en `supabase/migraciones/`, nunca editando una ya aplicada ni desde el panel de Supabase. Después de una migración que toque permisos, corre `tests/test_permisos_supabase.py`.

## Herramientas del proyecto

- Subagente `revisor-codigo`: úsalo antes de cada commit con cambios de lógica.
- Subagente `probador`: corre pruebas y linter, y escribe pruebas que falten.
- Hook en `.claude/settings.json`: cada archivo `.py` que edites se formatea con ruff; si quedan errores, te los devuelve para corregirlos.

## Al cerrar una fase

Usa la skill `cerrar-fase`: revisa la lista de "Listo cuando" del `PLAN.md` y le hace a Gabriel las preguntas de "Explícalo tú".
