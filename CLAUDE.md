# SolarAndes: guía para Claude

Portafolio de Gabriel: el sistema comercial de **SolarAndes S.A.S.**, una instaladora de paneles solares **ficticia** en Bogotá, Medellín y Cali. El plan completo está en `PLAN.md` y los requisitos del "cliente" en `docs/requisitos.md`.

**Fase actual: 2 (Migración de datos).** Fase 0 cerrada el 2026-10-21; fase 1 cerrada el 2026-10-23. Actualiza esta línea al cerrar cada fase.

**Dónde quedamos (2026-10-23):** fase 1 cerrada. El CRM está publicado en https://solarandes-crm.vercel.app (82 pruebas pasando) y el README tiene los usuarios de demostración. Resumen para estudiar: `docs/guia-fase-1.md`. En "Explícalo tú", Gabriel explicó bien las tablas, RLS y el lado de la app; le costó el *por qué* las reglas viven en la base de datos (trigger, cotización): refuérzalo cuando aparezca en la fase 3 con n8n. Pendiente de Gabriel: escribir sus viñetas de la fase 1 en el README. Detalle para la fase 3: si n8n escribe con la llave de servicio, `auth.uid()` es nulo y `historial_etapas.cambiado_por` queda vacío.

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
supabase/migraciones/   cambios a la base de datos, numerados (001_..., 002_...)
scripts/supabase/       aplicar migraciones y cargar los datos en Supabase
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
