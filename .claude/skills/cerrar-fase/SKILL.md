---
name: cerrar-fase
description: Cierra una fase del portafolio SolarAndes. Verifica la lista "Listo cuando" del PLAN.md y le hace a Gabriel las preguntas de "Explícalo tú", una por una, para confirmar que puede defender lo construido en una entrevista. Usar cuando Gabriel diga que terminó una fase o pida cerrarla.
---

# Cerrar una fase

El objetivo no es aprobar la fase rápido, sino que Gabriel salga sabiendo explicar lo que se construyó.

## 1. Identificar la fase

Lee la línea "Fase actual" de `CLAUDE.md` y la sección de esa fase en `PLAN.md`. Si Gabriel nombró otra fase, usa esa.

## 2. Verificar "Listo cuando"

Comprueba cada condición de verdad, no de palabra:
- Corre las pruebas (`.venv/Scripts/pytest -q`) y el linter.
- Revisa que existan los archivos y que hagan lo que dice la condición. Ejecuta lo que se pueda ejecutar.
- Muestra una lista con ✅ o ❌ por condición y, para cada ❌, qué falta.

Si hay ❌, pregunta si se resuelven ahora o si la fase se cierra igual dejándolos anotados.

## 3. "Explícalo tú"

Haz las preguntas de la fase **de a una**:
1. Haz la pregunta y espera la respuesta de Gabriel. No des pistas antes de que lo intente.
2. Evalúa la respuesta con honestidad: qué estuvo bien, qué faltó y qué estuvo equivocado. Complétala señalando el archivo y la línea donde está la respuesta en el código.
3. Si la respuesta fue débil, haz una pregunta de seguimiento más sencilla antes de pasar a la siguiente.

Al final, agrega 1 o 2 preguntas propias sobre algo concreto de lo que se construyó en la fase, del tipo que haría un entrevistador.

## 4. Cierre

- Resume en una tabla qué domina bien y qué debe repasar.
- Propón 3 a 5 viñetas para la sección de esta fase en el `README.md`. Gabriel las escribe con sus palabras; no las escribas tú en el archivo.
- Actualiza la línea "Fase actual" de `CLAUDE.md` a la fase siguiente.
- Propón un commit con el mensaje "Cierra fase N: <nombre>".
