# Reporte de la migración del Excel heredado

Generado el 2026-10-23 con `scripts/migracion/reporte.py`. Todos los datos son ficticios.

## En una frase

El Excel tenía 327 filas de clientes, que resultaron ser 280 personas. 279 ya están en el CRM, con 92 notas que antes solo vivían en el Excel; 1 caso(s) quedan para que los decida una persona. El CRM no tiene duplicados.

| | |
|---|---|
| Filas en el Excel | 337 |
| Filas que no eran clientes (título, encabezados, vacías, total) | 10 |
| Filas de clientes | 327 |
| Personas distintas, después de unir duplicados | 280 |
| Duplicados unidos | 47 filas, en 43 personas |
| Personas que ya están en el CRM | 279 |
| Personas nuevas pendientes de crear | 0 |
| Notas del Excel guardadas en el CRM | 92 |
| Notas pendientes de guardar | 0 |
| Casos para revisar | 1 |
| Duplicados en el CRM | 0 |

## 1. Limpieza, campo por campo

Regla: la limpieza nunca inventa datos. Si un valor no se entiende, queda vacío y se anota.

| Campo | Entendido | De ellos, deducido de la hoja | Escrito pero ilegible | Sin dato |
|---|---|---|---|---|
| Teléfono | 303 de 327 | 0 | 8 | 16 |
| Correo | 276 de 327 | 0 | 18 | 33 |
| Ciudad | 314 de 327 | 88 | 0 | 13 |
| Tipo de cliente | 310 de 327 | 0 | 0 | 17 |
| Consumo | 297 de 327 | 0 | 0 | 30 |
| Asesor | 318 de 327 | 88 | 0 | 9 |
| Fecha | 304 de 327 | 0 | 0 | 23 |
| Estado | 327 de 327 | 0 | 0 | 0 |

"Deducido de la hoja": la hoja "Medellín (Vale)" no tiene columnas de ciudad ni asesor. Si la celda está vacía, se asume lo que dice el nombre de la hoja (Medellín, Valentina). Es una suposición razonable, y por eso se cuenta aparte.

## 2. Duplicados

327 filas → 280 personas. Dos filas se unen solas si comparten teléfono o correo, o el mismo nombre y la misma ciudad, y nada se contradice. Ante la duda, van a revisión: unir a dos personas distintas es peor que dejar un duplicado.

- Personas que aparecían más de una vez: 43
- Parejas que quedaron en duda: 0

Unir filas repetidas también completa datos: si una fila no tenía teléfono y su repetida sí, la persona queda con teléfono. Lo que sigue faltando después de unir:

| Dato | Personas sin él |
|---|---|
| Teléfono | 16 |
| Correo | 34 |
| Ciudad | 8 |
| Tipo de cliente | 14 |
| Consumo | 21 |
| Asesor | 7 |
| Fecha | 20 |

## 3. Conciliación con el CRM

Cada persona se buscó en el CRM con las mismas reglas de los duplicados. Si ya estaba, solo se completa lo que el CRM tiene vacío (nunca se sobrescribe: el CRM es más reciente que el Excel) y sus notas pasan a actividades, a nombre del asesor dueño del cliente.

- Ya están en el CRM: 279
- Notas del Excel guardadas en el CRM: 92 (pendientes: 0)
- Datos vacíos del CRM que el Excel aún puede completar: 0
- Diferencias entre el Excel y el CRM (no se cambian): 0
- Personas nuevas pendientes de crear: 0
- No se pudieron ubicar: 1

  - **Colegio Rodriguez** (Medellín (Vale), fila 58): se parece a más de un contacto del CRM o hay dudas: C0059 Jaime Prieto Cardona (misma empresa y misma ciudad); C0665 Paola Cardona (misma empresa y misma ciudad)

## 4. Verificación: duplicados en el CRM

Se compararon los 1005 contactos del CRM entre sí con las mismas reglas: **0 duplicados**. El CRM no tiene duplicados.

4 pareja(s) se llaman igual, pero sus datos se contradicen: son homónimos.

- C0097 y C0805, Luis Sánchez: mismo nombre, pero distinto teléfono, correo
- C0119 y C0753, José Álvarez: mismo nombre, pero distinto teléfono, correo, ciudad
- C0551 y C0688, Carlos Martínez: mismo nombre, pero distinto teléfono, correo
- C0610 y C0861, Carolina Rojas: mismo nombre, pero distinto teléfono, correo, ciudad

## 5. Cómo sabemos que está bien

Como los datos son ficticios, existe un archivo con la respuesta correcta de cada fila (`data/heredado/respuestas_migracion.csv`). Las reglas no se sacaron de él: solo se usa para calificar.

| Prueba | Resultado |
|---|---|
| Datos llenados con un valor equivocado | 0 |
| Teléfonos recuperados, de las filas donde se podía | 303 de 303 |
| Correos recuperados, de las filas donde se podía | 276 de 276 |
| Fichas que mezclan a dos personas | 0 |
| Personas repartidas en más de una ficha | 0 |
| Personas asociadas al contacto correcto del CRM | 279 de 279 |

## Para revisar

La lista completa está en `data/migracion/para_revisar.csv` (1 caso(s)).
