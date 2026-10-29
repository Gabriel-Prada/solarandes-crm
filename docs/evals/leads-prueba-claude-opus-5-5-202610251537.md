# Examen de la calificación de leads: prueba, claude-opus-5-5

*25/10/2026, 10:37:57 a. m. · prompt calificar-lead-v2 · esfuerzo low · 46 casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **46 de 46** |
| Errores graves (un lead de prioridad alta quedó en baja, como "no es lead" o sin ficha) | **0** de 14 leads de prioridad alta |
| Sin ficha porque Claude se negó o respondió mal | 0 |
| Sin ficha porque la API falló (no es culpa del modelo; repetir esos casos) | 0 |
| Resúmenes para revisar a mano (pagos, "VIP", cifras largas) | 0 |
| Costo del examen | USD 0.4451 |
| Costo por lead | USD 0.009677 (1.000 leads ≈ USD 9.68) |
| Tiempo de respuesta | promedio 2543 ms, máximo 2944 ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
| es_lead | 46 de 46 |
| tipo_cliente | 46 de 46 |
| urgencia | 43 de 46 |
| intencion | 46 de 46 |
| consumo_kwh_mes | 46 de 46 |
| factura_luz_cop | 46 de 46 |

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|
| p016 | Buenas noches, Son más o menos 1100 kWh/mes. No voy a comprar todavía, solo me estoy informando. Manejo una fábrica de a | baja → baja | urgencia: "no_se_sabe" → "baja" |
| p043 | no voy a comprar todavía, solo me estoy informando. para el apartamento donde vivo. | baja → baja | urgencia: "no_se_sabe" → "baja" |
| p045 | buenas noches, nos cobran 450.000 pesos al mes de luz. no voy a comprar todavía, solo me estoy informando. | baja → baja | urgencia: "no_se_sabe" → "baja" |

## Resúmenes

Lo que leería el asesor en el CRM y en el aviso (ya limpio de teléfonos, correos y enlaces). ⚠️ = para revisar a mano.

| Caso | Resumen |
|---|---|
| p001 | Hogar de 4 personas en Bogotá pide cotización de sistema solar para este año; paga 330 mil COP/mes de luz. |
| p003 | Hogar de 4 personas en Bogotá interesado en instalar paneles solares; sin plazo ni consumo indicado. |
| p004 | Casa en construcción en Cali; quieren dejarla con paneles solares desde el inicio. La obra termina en marzo. Sin datos de consumo. |
| p005 | Apartamento en Cali, interesado en instalar paneles solares el próximo año, sin afán. Paga $820.000 de luz. |
| p006 | Mensaje equivocado, la persona dice que se equivocó de número. No es lead. |
| p007 | Paga 900 mil de luz al mes en Bogotá, cansado del costo; pregunta si le pueden solucionar con energía solar. |
| p008 | Interesado en instalar paneles solares en Cali, urgente por alza de tarifa; consumo 250 kWh/mes. |
| p010 | Apartamento en Cali, solo se informa por ahora; piensa instalar este año. Consumo 300 kWh/mes. |
| p011 | Casa propia en Cali, techo de teja, quiere sistema solar; arrancar el próximo trimestre; consume ~350 kWh/mes |
| p012 | Droguería en Bogotá interesada en instalar paneles solares, quizás en un par de años. Consumo aprox. 140 kWh/mes. |
| p013 | Casa propia en Cali con techo de teja; pide cotización de sistema solar y visita esta misma semana. Consumo y factura no indicados. |
| p014 | Fábrica de arepas en Bogotá quiere pasarse a energía solar; consume 2200 kWh/mes. Sin plazo indicado. |
| p015 | Apartamento en Medellín pide cotización de sistema solar, sin afán (en un par de años). Consumo 100 kWh/mes. |
| p016 | Fábrica de arepas en Bogotá, consume ~1100 kWh/mes; solo se está informando, no piensa comprar todavía. |
| p017 | Fábrica de arepas en Cali pide precio para instalar sistema solar este año; no indica consumo ni factura. |
| p018 | Apartamento en Bogotá, paga 180 mil/mes de luz; por curiosidad pregunta cómo funciona vender energía a la red |
| p019 | Apartamento de 60 m2 en Cali quiere paneles solares para el próximo año; consumo 140 kWh/mes. |
| p020 | Casa propia en Medellín con techo de teja, quiere instalar paneles solares este año. Sin datos de consumo ni factura. |
| p021 | Lavandería en Medellín interesada en instalar paneles solares, sin afán, posiblemente el próximo año. Consumo y factura no indicados. |
| p022 | Hogar de 4 personas en Bogotá pide cotización de sistema solar; piensa instalar en un par de años. Sin datos de consumo. |
| p023 | Casa propia en Cali con techo de teja pide cotización de sistema solar; paga 600 mil/mes de luz, sin plazo definido. |
| p024 | Pide cotización para instalar sistema solar en Bogotá este año; paga 240.000 COP/mes de luz. |
| p025 | Droguería en Medellín pide cotización para instalar sistema solar, urgente por alza de tarifa; paga 3,1 millones de luz al mes |
| p026 | Hogar en Bogotá quiere cotizar paneles solares; paga 250 mil de luz al mes; sin plazo indicado. |
| p027 | Pide cotización de sistema solar en Bogotá, consumo aprox. 560 kWh/mes, quiere instalar este año. |
| p028 | Apartamento en Bogotá, quiere pasarse a energía solar este año. Consumo aprox. 720 kWh/mes. |
| p029 | Pide cotización de sistema solar en Cali; consumo promedio 160 kWh/mes; sin plazo ni tipo de inmueble indicado. |
| p030 | Apartamento en Bogotá pide cotización de instalación solar para este año; consume 280 kWh/mes. |
| p031 | Interesado en Medellín pide información sobre paneles solares; sin datos de consumo, factura ni plazos. |
| p032 | Apartamento en Bogotá quiere instalar paneles antes de fin de mes; consumo 190 kWh/mes. |
| p033 | Local comercial en Bogotá paga $1.250.000/mes de luz; quiere instalar paneles solares antes de diciembre |
| p034 | Casa propia en Medellín, techo de teja, consume 300 kWh/mes; interesado en paneles quizás en un par de años. |
| p035 | Apartamento en Cali quiere pasarse a solar, sin afán (para el otro año). Consumo aprox. 130 kWh/mes. |
| p036 | Casa propia en Cali, techo de teja, quiere pasarse a solar; consume 80 kWh/mes; sin afán, para el próximo año. |
| p037 | Pide información de paneles solares en Cali; no indica tipo de inmueble, plazos ni consumo. |
| p038 | Apartamento en Bogotá, interesado en instalar paneles solares, sin afán (próximo año). Paga 110 mil/mes de luz. |
| p039 | Pide precio para instalar sistema solar en Cali, sin afán, posiblemente el próximo año. Sin datos de consumo ni factura. |
| p041 | Apartamento en Medellín, interesado en instalar paneles solares el próximo año, sin afán. Consumo 230 kWh/mes. |
| p042 | Apartamento en Cali, quiere sistema solar instalado antes de fin de mes; pregunta cómo funciona vender energía a la red. |
| p043 | Apartamento en Bogotá; solo se está informando, aún no piensa comprar. Sin datos de consumo ni factura. |
| p044 | Local de comidas rápidas en Medellín, paga ~1,5 millones/mes de luz; quiere saber si le sirven paneles solares. Sin fecha. |
| p045 | Persona en Cali que solo se está informando sobre energía solar, aún no comprará. Paga 450.000 COP/mes de luz. |
| p046 | Fábrica de arepas en Medellín quiere instalar sistema solar este año; pregunta cómo funciona vender energía a la red. |
| p047 | Spam: oferta de ganar dinero con criptomonedas, nada relacionado con energía solar. |
| p049 | Quiere entender cómo funciona la energía solar antes de comprar; posible compra en un par de años. Bogotá. |
| p050 | Apartamento en Medellín, interesado en instalar paneles solares; consumo 430 kWh/mes; sin plazo indicado. |
