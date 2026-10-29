# Revisión a ciegas de los casos de prueba (2026-10-25)

Decisión D2 del [plan de la fase 4](../../../docs/plan-fase-4.md): un revisor aparte, con la memoria en blanco, llenó la ficha de los 50 casos de prueba viendo solo el mensaje, lo que decía el formulario y las mismas definiciones que usa el prompt. No vio las respuestas del examen, ni el prompt, ni lo que contesta Haiku.

**Resultado:** coincidimos en 44 de 50 casos, en todos los campos. En los 6 restantes, la respuesta de cada uno aparecía como alternativa válida del otro: no hubo ningún choque de fondo.

| Caso | Campo | Examen | Revisor | Qué se hizo |
|---|---|---|---|---|
| p007 (factura de 900 mil, "ya no aguanto más") | urgencia | alta | no se sabe | Ya se aceptaban las dos. El enojo no es una fecha |
| p033 ("antes de diciembre") | urgencia | media | alta | Ya se aceptaban las dos. Depende del día en que se lea |
| p042 y p046 (plantillas) | intención | solo información | quiere un sistema | **Corregido en el generador:** "solo tengo curiosidad" junto con una fecha cercana se contradice; en esas plantillas ahora valen las dos lecturas (también afectó a p010) |
| p048 ("5 kW para la finca") | tipo | hogar | no se sabe | Ya se aceptaban las dos |
| p049 ("un trabajo del colegio") | es lead / intención | sí, solo información | no, otra | **Corregido en el generador:** el revisor tiene razón, un estudiante haciendo una tarea no es un lead. La frase se cambió por una que sí es "solo información" |

Dudas del revisor que no cambiaron nada (su respuesta principal coincidió con el examen): consumos sin decir "al mes" (p002), "es para ir mirando" junto con "quiero precio" (varios: queda quiere un sistema con urgencia baja), y "no voy a comprar todavía" sin plazo (urgencia no se sabe).
