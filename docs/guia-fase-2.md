# Guía de la fase 2: migración de datos

Qué se construyó, cómo funciona y por qué se tomó cada decisión. Está escrita para explicar el proyecto en una entrevista **sin necesidad de hablar de código**: casi todo aquí es criterio.

**Demo:** https://solarandes-crm.vercel.app (Contactos → Importar CSV, como gerente) · **Reporte:** [reporte-migracion.md](reporte-migracion.md)

---

## 1. La idea en 30 segundos

> Antes del CRM, los asesores de SolarAndes llevaban sus clientes en un Excel desordenado: dos hojas distintas, teléfonos en diez formatos, ciudades escritas como "Bta" o "Cali - Valle" y la misma persona repetida dos o tres veces. Construí un proceso que lee ese Excel, limpia cada dato sin inventar nada, une a las personas repetidas, las busca en el CRM y les pasa sus notas, dejando en una lista lo que una persona tiene que decidir. Después llevé esa misma limpieza al CRM: la gerente sube un CSV, ve una vista previa fila por fila y confirma. Un reporte muestra las cifras y comprueba que el CRM no quedó con duplicados.

---

## 2. El problema: el Excel heredado

`data/heredado/clientes_heredado.xlsx` simula lo que llega en casi todo proyecto de CRM:

| Problema | Ejemplo |
|---|---|
| Dos hojas con columnas distintas | "Clientes BOG-CALI" y "Medellín (Vale)", que no tiene ciudad ni asesor |
| Filas que no son clientes | Un título encima del encabezado, un encabezado repetido, filas vacías, "TOTAL CLIENTES" |
| Teléfonos en muchos formatos | `3056695760.0`, `(+57) 311-194-36-88`, `573185859154`, y algunos con un dígito de menos |
| Ciudades, tipos y asesores escritos a mano | "Bta", "Bogota DC", "Mde"; "Casa", "Residencial"; "ANDRÉS", "A. Rojas", "Cami" |
| La misma persona repetida | "Mauricio Hernández" y "Mauricio  Hernández " con el mismo celular |
| Nombres con el apellido primero | "MOSQUERA ALDAIR" |

**Un detalle clave:** esas 280 personas **ya estaban en el CRM** (son los clientes más antiguos). Si se hubieran cargado tal cual, el CRM habría quedado lleno de duplicados. Por eso la migración no "carga": **concilia** (ver el paso 4).

---

## 3. Las piezas: una cadena de pasos

Funciona como un flujo de n8n: cada paso recibe filas, hace una sola cosa y entrega filas al siguiente.

| Paso | Qué hace | Archivo |
|---|---|---|
| 1. Leer | Une las dos hojas con las mismas columnas y descarta lo que no es cliente | [leer_excel.py](../scripts/migracion/leer_excel.py) |
| 2. Normalizar | Deja cada dato en el formato del CRM | [normalizar.py](../scripts/migracion/normalizar.py) |
| 3. Duplicados | Decide qué filas son la misma persona y las une | [duplicados.py](../scripts/migracion/duplicados.py) |
| 4. Conciliar y cargar | Busca a cada persona en el CRM y le agrega lo que falta | [conciliar.py](../scripts/migracion/conciliar.py), [migrar.py](../scripts/migracion/migrar.py) |
| 5. Reporte | Cifras de todo el proceso y la lista para revisar | [reporte.py](../scripts/migracion/reporte.py) |
| 6. Importar CSV | La misma limpieza, dentro del CRM, para la gerente | [apps/crm/src/lib/importar/](../apps/crm/src/lib/importar/) |

**¿Por qué en código y no en n8n?** Comparar nombres "parecidos" y probar miles de casos es más fácil de escribir y de verificar en código. Además, había un archivo con la respuesta correcta de cada fila (`data/heredado/respuestas_migracion.csv`, porque los datos son ficticios), y con pruebas automáticas se pudo medir el acierto exacto. n8n queda para la fase 3.

---

## 4. Las reglas, paso a paso

### Paso 2: limpiar sin inventar

La regla de oro: **la limpieza nunca inventa datos.** Si un teléfono tiene 9 dígitos, no se adivina cuál falta; si un correo dice `nombre@example`, no se adivina si era `.com` o `.net`. El dato queda vacío y se anota el problema.

**¿Por qué?** Un dato vacío se nota y alguien lo completa. Un dato equivocado (el teléfono de otra persona) pasa desapercibido y hace daño.

Dos decisiones que conviene saber defender:
- **"No contesta" es "perdido", pero sin motivo.** Según los requisitos, "contactado" es que un asesor habló con el cliente; si no contesta, nadie habló con él. Pero el motivo real de la pérdida no se sabe (en el Excel hay quien no contestaba porque aplazó la decisión).
- **Ciudad y asesor de la hoja de Medellín se deducen del nombre de la hoja.** Es una suposición razonable, y por eso el reporte la cuenta aparte (88 filas).

### Paso 3: ¿son la misma persona?

Se compara cada fila con todas las demás, de a dos (unas 53.000 parejas). No todas las pistas valen lo mismo:

| Pista | Peso |
|---|---|
| Mismo celular o mismo correo | **Fuerte** |
| Mismo nombre (sin importar orden, mayúsculas ni tildes) | **Débil**: "Juan Pérez" hay muchos. Necesita además la misma ciudad |
| Un dato que se contradice (dos celulares, correos, empresas o ciudades distintos) | **Frena** la unión, aunque el nombre sea igual |

Cada pareja queda en uno de tres resultados: **seguro** (se unen solos), **duda** (va a revisión) o **no son la misma**.

Ejemplos que conviene saber explicar:

| Caso | Resultado | Por qué |
|---|---|---|
| "Aldair Mosquera" y "MOSQUERA ALDAIR", mismo celular | Seguro | Mismo celular y el mismo nombre en otro orden |
| "Ana Ruiz" y "Pedro Ruiz", mismo celular | Revisión | Puede ser una familia en la misma casa o dos clientes distintos: eso lo decide una persona |
| "David Sánchez" y "David Sánchez Gómez", celulares distintos | No son la misma | El celular contradice al nombre |
| "Juan Pérez" y "Juan Perez", sin celular, correo ni ciudad en común | Revisión | Un nombre igual es poca prueba |

**La trampa de la cadena.** Si A = B y B = C, los tres son una persona aunque A y C nunca se comparen. Pero una fila **sin nombre** puede hacer de puente: "Ana Ruiz" (celular X), una fila sin nombre (celular X) y "Pedro Ruiz" (celular X) terminarían unidos. Por eso se agrupa en dos tiempos: primero se arman los grupos y después **se revisa cada grupo completo**; si dos de sus filas no se pueden unir, el grupo no se une y va a revisión. Así, además, el resultado no depende del orden de las filas.

**¿Qué pasa si te equivocas?** Hay dos errores, y no pesan igual:
- **Unir a dos personas distintas** es grave: se mezclan sus datos y una puede quedar con el asesor equivocado, sin que nadie lo note.
- **Dejar una persona repetida** es leve: se ve y se arregla después.

Por eso, ante la duda, revisión.

### Paso 4: conciliar con el CRM

Cada persona del Excel se busca en el CRM **con la misma función del paso 3**: no hay dos versiones de "¿es la misma persona?".

- **Si ya está**: solo se completa lo que el CRM tiene vacío. Nunca se sobrescribe, porque el CRM es más reciente que el Excel. Sus notas pasan a actividades ("Nota del Excel heredado: …"), a nombre del asesor dueño del cliente.
- **Si no está**: se crea solo si tiene todo lo obligatorio, y si su celular no es ya de otra persona.
- **Si hay dudas**: a revisión.

Tres ideas para la entrevista:
- **Ensayo primero.** `migrar.py` por defecto solo muestra lo que haría; con `--aplicar` guarda. Y todo va en una sola transacción: o entra todo, o nada.
- **Idempotencia.** Correrla dos veces da el mismo resultado: la segunda vez no encuentra nada pendiente. Es como presionar varias veces el botón del ascensor.
- **Entra por la misma puerta que la app.** El script no escribe como administrador saltándose las reglas: la base de datos "se hace pasar" por el asesor de cada cliente, así que se aplican los mismos permisos (RLS) que en el CRM.

### Paso 5: un reporte que dice lo que mide

[reporte-migracion.md](reporte-migracion.md) se genera con un comando. La lección de su revisión: **un reporte tiene que ser honesto también cuando las cosas van mal.** Por ejemplo, separa lo guardado de lo pendiente, y si alguien recarga los datos y las notas desaparecen, avisa en negrita "la migración no está al día". Una frase escrita a mano que no sale de los datos, algún día miente.

### Paso 6: importar CSV desde el CRM

Contactos → Importar CSV, solo para la gerente:
1. Sube el archivo y elige el canal para las filas que no lo traen (una persona decide; el programa no inventa).
2. Ve la **vista previa**: cada fila dice "Se crea", "Ya existe", "Repetida", "Revisar" o "Error", con el motivo.
3. Confirma, y solo se crean las filas listas.

Decisiones importantes:
- **Al confirmar, el servidor vuelve a analizar todo desde cero.** No confía en la vista previa, que vive en el navegador y se puede alterar. Y si el CRM cambió mientras tanto (un asesor creó a ese cliente a mano), el análisis nuevo lo detecta.
- **Si cambias el archivo o el canal después de la vista previa, la vista previa se oculta.** Así no se puede importar algo que nadie revisó.
- **Lee los CSV de Excel en español**, que no usan UTF-8 sino otra codificación (Windows-1252). Sin eso, "Medellín" llegaría como "Medell�n".
- **Valores por defecto visibles:** sin tipo, con empresa es negocio y sin empresa es hogar; sin asesor, el de la ciudad.

**¿Cuándo usar la pantalla y cuándo la migración?** La pantalla es para **leads nuevos** (por ejemplo, de una feria): a un cliente que ya existe lo salta. La migración es para un **Excel viejo** con clientes que ya están: les agrega sus notas.

---

## 5. Una regla, dos lenguajes

La migración está en Python; el CRM, en TypeScript. Para la pantalla de importar, la limpieza se **tradujo** a TypeScript. Duplicar código tiene un riesgo: que las dos copias se separen.

La solución: [tests/casos_compartidos/limpieza.json](../tests/casos_compartidos/limpieza.json), un archivo con casos y su respuesta correcta ("Bta" → Bogotá, "la familia que comparte celular" → revisión…). **Las pruebas de los dos lenguajes leen el mismo archivo.** Si alguien cambia una regla en un lado y no en el otro, alguna prueba falla.

Y funcionó en las dos direcciones: al revisar la versión de TypeScript apareció un error que **también tenía Python** (una persona "nueva" cuyo celular ya era de otro contacto habría hecho fallar la migración completa).

---

## 6. Las cifras

| | |
|---|---|
| Filas en el Excel | 337 (10 no eran clientes) |
| Filas de clientes → personas | 327 → 280 |
| Personas que aparecían más de una vez | 43 |
| Datos llenados con un valor equivocado | **0** |
| Teléfonos y correos recuperados, de los que se podían | 303 de 303 y 276 de 276 |
| Personas asociadas al contacto correcto del CRM | 279 de 279 |
| Notas del Excel guardadas en el CRM | 92 |
| Para revisar | 1 (el Colegio Rodríguez: en el CRM hay dos personas de ese colegio y la fila no dice cuál) |
| Duplicados en el CRM | **0** |

**¿Cómo se sabe que está bien?** Como los datos son ficticios, existe la respuesta correcta de cada fila y se calificó el 100 %. En un proyecto real eso no existe; lo que se hace es tomar una muestra de 30 a 50 filas, revisarlas a mano y compararlas con lo que hizo el programa.

---

## 7. Calidad: pruebas y revisiones

- **Pruebas:** 164 en Python (incluidas las que comparan contra el archivo de respuestas y las que escriben en la base real dentro de una transacción que se deshace) y 55 en el CRM.
- **Revisión de código antes de cada commit.** Encontró errores que las pruebas no veían:

| Qué encontró | La lección |
|---|---|
| "No contesta" quedaba como "contactado" en 99 filas | La prueba más importante ("nunca inventa") no revisaba la etapa. Una prueba solo protege lo que revisa |
| Una fila sin nombre podía unir a dos personas | Con los datos de hoy no pasaba, pero el código tiene que aguantar el archivo de mañana |
| El reporte decía "personas creadas" cuando contaba las pendientes | Un reporte debe decir exactamente lo que mide |
| Los CSV de Excel en español perdían las tildes | Probar con el archivo real que usará la gerente, no solo con el de prueba |

- **Prueba manual en el navegador.** Encontró que la página se caía si el archivo cambiaba en el disco después de elegirlo. Ninguna prueba automática lo habría visto.

Para probarlo tú mismo: [data/migracion/prueba_manual.csv](../data/migracion/prueba_manual.csv) trae 12 casos con su resultado esperado en la última columna.

---

## 8. Glosario

| Término | Significado |
|---|---|
| **Migración de datos** | Pasar información de un sistema viejo (aquí, un Excel) a uno nuevo |
| **Normalizar** | Dejar un dato en un solo formato: "Bta" y "Bogota DC" → "Bogotá" |
| **Deduplicar** | Encontrar y unir los registros que son la misma persona |
| **Conciliar** | Comparar dos fuentes de datos (Excel y CRM) y decidir qué hacer con cada registro |
| **Idempotente** | Que hacerlo una vez o varias da el mismo resultado |
| **Ensayo (dry run)** | Correr el proceso mostrando lo que haría, sin guardar nada |
| **Transacción** | Un grupo de cambios que se guardan todos juntos o ninguno |
| **CSV** | Archivo de texto con una fila por línea y las columnas separadas por coma o punto y coma |
| **Codificación** | Cómo se guardan las letras en un archivo (UTF-8, Windows-1252); si no coincide, las tildes salen rotas |
| **Casos compartidos** | Ejemplos con su respuesta correcta que prueban las dos versiones de una regla |

---

## 9. Preguntas probables de entrevista

**¿Cómo decides si dos registros son la misma persona?**
Los comparo de a dos. Si comparten celular o correo y nada se contradice, los uno solos. Si solo coincide el nombre, exijo la misma ciudad, porque nombres iguales hay muchos. Un dato que se contradice frena la unión. Lo dudoso va a una lista que revisa una persona.

**¿Y qué pasa si te equivocas?**
Unir a dos personas distintas es grave: se mezclan sus datos sin que nadie lo note. Dejar un duplicado es leve: se ve y se arregla. Por eso, ante la duda, revisión.

**Dos personas con el mismo celular y distinto nombre, ¿las unes?**
No solas. Puede ser una familia en la misma casa (un solo cliente para una instaladora) o dos clientes distintos. Eso lo decide alguien que conoce el caso; el sistema solo detecta la duda.

**El cliente te entrega otro Excel la próxima semana. ¿Qué haces?**
Miro qué trae. Si son leads nuevos y está ordenado, la gerente lo sube como CSV desde el CRM, revisa la vista previa y confirma. Si es un Excel viejo con clientes que probablemente ya están, uso la migración: ensayo, reporte y solo después se aplica, para no perder sus notas. En los dos casos se puede repetir sin duplicar.

**¿Por qué el servidor vuelve a analizar el archivo al confirmar, si ya hizo la vista previa?**
Porque la vista previa vive en el navegador y se puede alterar: el servidor no le cree. Y porque el CRM pudo cambiar mientras tanto; el análisis nuevo detecta un cliente creado a mano en esos minutos.

**La limpieza está en Python y en TypeScript. ¿No es duplicar código?**
Sí, a propósito: una para la migración y otra para la pantalla. El riesgo es que se separen, y lo controlo con un archivo de casos compartidos que prueban los dos lenguajes.

**¿Cómo sabes que la migración quedó bien?**
Con un reporte de calidad y una calificación contra la respuesta correcta: 0 datos equivocados, 280 de 280 personas y 0 duplicados en el CRM. En un proyecto real, revisaría a mano una muestra de 30 a 50 filas.
