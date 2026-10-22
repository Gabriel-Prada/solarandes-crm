# CRM de SolarAndes

App web del CRM: Next.js 16 (App Router), TypeScript, Tailwind y Supabase.

## Correrla en local

```bash
cp .env.example .env.local   # y completar con los datos del proyecto de Supabase
npm install
npm run dev                  # http://localhost:3000
```

Los usuarios de prueba (gerente, asesores, técnico, contadora) se crean con `scripts/supabase/cargar_datos.py` en la raíz del repo.

## Cómo está organizada

| Archivo | Qué hace |
|---|---|
| `src/proxy.ts` | Renueva la sesión y manda a `/login` a quien no la tiene |
| `src/lib/supabase/servidor.ts` | Cliente de Supabase en nombre de quien inició sesión (aplica sus permisos) |
| `src/lib/sesion.ts` | `obtenerPerfil()` y `exigirRol()`: quién está conectado y si puede ver la página |
| `src/lib/navegacion.ts` | Qué secciones del menú ve cada rol |
| `src/app/login/` | Página y acciones de inicio y cierre de sesión |
| `src/app/(crm)/` | Las páginas del CRM con su menú lateral |

## Seguridad en tres capas

1. **Menú:** cada rol ve solo sus secciones.
2. **Página:** `exigirRol()` devuelve al inicio a quien escriba a mano una dirección que no le corresponde.
3. **Base de datos:** Row Level Security. Aunque las dos primeras fallen, Supabase solo entrega las filas permitidas. La app usa la llave publicable, nunca la secreta.
