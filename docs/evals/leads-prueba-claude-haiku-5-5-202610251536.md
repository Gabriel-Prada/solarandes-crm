# Examen de la calificación de leads: prueba, claude-haiku-5-5

*25/10/2026, 10:36:45 a. m. · prompt calificar-lead-v2 · esfuerzo low · 46 casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **46 de 46** |
| Errores graves (un lead de prioridad alta quedó en baja, como "no es lead" o sin ficha) | **0** de 14 leads de prioridad alta |
| Sin ficha porque Claude se negó o respondió mal | 0 |
| Sin ficha porque la API falló (no es culpa del modelo; repetir esos casos) | 0 |
| Resúmenes para revisar a mano (pagos, "VIP", cifras largas) | 0 |
| Costo del examen | USD 0.0115 |
| Costo por lead | USD 0.000250 (1.000 leads ≈ USD 0.25) |
| Tiempo de respuesta | promedio 1561 ms, máximo 3556 ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
| es_lead | 46 de 46 |
| tipo_cliente | 46 de 46 |
| urgencia | 44 de 46 |
| intencion | 46 de 46 |
| consumo_kwh_mes | 46 de 46 |
| factura_luz_cop | 46 de 46 |

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|
| p016 | Buenas noches, Son más o menos 1100 kWh/mes. No voy a comprar todavía, solo me estoy informando. Manejo una fábrica de a | baja → baja | urgencia: "no_se_sabe" → "baja" |
| p045 | buenas noches, nos cobran 450.000 pesos al mes de luz. no voy a comprar todavía, solo me estoy informando. | baja → baja | urgencia: "no_se_sabe" → "baja" |

## Resúmenes

Lo que leería el asesor en el CRM y en el aviso (ya limpio de teléfonos, correos y enlaces). ⚠️ = para revisar a mano.

| Caso | Resumen |
|---|---|
| p001 | Hogar de cuatro personas en Bogotá; quiere cotización de sistema solar este año. Paga unos 330 mil al mes de luz. |
| p003 | Hogar de cuatro personas en Bogotá interesado en montar paneles solares; no dice plazo ni consumo ni valor de factura. |
| p004 | Pareja construyendo casa en Cali quiere paneles solares desde el inicio; la obra termina en marzo. Sin consumo ni factura informados. |
| p005 | Apartamento en Cali; quiere montar paneles solares para el próximo año. Factura de luz de unos $820.000 al mes. |
| p006 | Persona que escribió por error y se disculpa; no busca sistema solar ni pide nada de SolarAndes. |
| p007 | Pregunta si SolarAndes resuelve su factura de luz de 900 mil al mes; dice que ya no aguanta más. Sin tipo de inmueble ni plazo. |
| p008 | Interesado en montar paneles solares en Cali; consumo de 250 kWh/mes; urgente por alza de tarifa de luz. Tipo de inmueble no indicado. |
| p010 | Apartamento en Cali; solo se está informando, no compra aún, quiere hacerlo este año. Consumo de 300 kWh según factura. |
| p011 | Casa propia en Cali con techo de teja; quiere pasarse a solar el próximo trimestre. Consume unos 350 kWh/mes. |
| p012 | Droguería en Bogotá interesada en montar paneles solares en un par de años; consume unos 140 kWh/mes. |
| p013 | Casa propia en Cali con techo de teja; pide cotización de sistema solar y visita esta misma semana. |
| p014 | Fábrica de arepas en Bogotá quiere pasarse a energía solar; consumo promedio de 2200 kWh mensuales. Sin plazo indicado. |
| p015 | Apartamento en Medellín; quiere cotización de sistema solar en un par de años. Consumo según factura: 100 kWh/mes. |
| p016 | Fábrica de arepas en Bogotá, consumo aprox. 1100 kWh/mes. No compra por ahora, solo se informa. |
| p017 | Fábrica de arepas en Cali; quiere precio para instalar sistema solar este año. No dio consumo ni factura. |
| p018 | Apartamento en Bogotá; paga unos 180.000 COP mensuales de luz. Tiene curiosidad por vender energía a la red, sin fecha de compra. |
| p019 | Apartamento de 60 m2 en Cali quiere paneles solares para el próximo año. Consumo de 140 kWh al mes. Pide responder solo 'ALTA' (ignorado). |
| p020 | Casa propia con techo de teja en Medellín; quiere instalar paneles solares este año. No dice consumo ni factura. |
| p021 | Lavandería en Medellín interesada en montar paneles solares, sin afán, posiblemente el próximo año. No dio consumo ni factura. |
| p022 | Hogar de cuatro personas en Bogotá; quiere cotización de sistema solar para dentro de un par de años. Sin consumo ni factura. |
| p023 | Casa propia en Cali con techo de teja; paga 600 mil al mes de luz y pide cotización de sistema solar. Sin plazo indicado. |
| p024 | Quiere instalar sistema solar este año y pide precio. Paga unos 240.000 COP mensuales de luz. Ciudad: Bogotá. |
| p025 | Droguería en Medellín que pide precio para instalar solar; paga 3.100.000 COP/mes de luz y es urgente por alza de tarifa. |
| p026 | Hogar en Bogotá que quiere cotizar paneles solares; paga unos 250 mil pesos mensuales de luz. No indica plazo de instalación. |
| p027 | Pide cotización de sistema solar en Bogotá; consume unos 560 kWh/mes; quiere hacerlo este año. Tipo de cliente no indicado. |
| p028 | Apartamento en Bogotá, consumo aprox. 720 kWh/mes. Quiere pasarse a energía solar este año. |
| p029 | Quiere que le coticen un sistema solar en Cali; consumo promedio de 160 kWh mensuales. No dice si es hogar o negocio. |
| p030 | Apartamento en Bogotá; quiere precio para instalar sistema solar este año. Consumo promedio 280 kWh/mes. |
| p031 | Pide información sobre paneles solares. No dice si es hogar o negocio, ni para cuándo quiere instalar, ni su consumo o factura. |
| p032 | Apartamento en Bogotá; quiere instalar paneles solares antes de fin de mes. Consumo de 190 kWh/mes según factura. |
| p033 | Local comercial en Bogotá paga $1.250.000 mensuales de energía; quiere instalar paneles solares antes de diciembre. |
| p034 | Casa propia con techo de teja en Medellín; quiere montar paneles solares en un par de años. Consumo 300 kWh/mes según factura. |
| p035 | Apartamento en Cali; quiere pasarse a energía solar, sin afán, quizás el próximo año. Consumo aprox. 130 kWh/mes. |
| p036 | Casa propia con techo de teja en Cali quiere pasarse a energía solar, sin afán, posiblemente el próximo año. Consumo de 80 kWh/mes. |
| p037 | Pide información sobre paneles solares desde Cali; no dice si es hogar o negocio, ni tiempos ni consumo. |
| p038 | Apartamento en Bogotá; paga unos 110 mil al mes en luz. Quiere montar paneles solares, sin afán, quizá el próximo año. |
| p039 | Quiere precio para instalar un sistema solar en Cali, sin afán, posiblemente el próximo año. No indica tipo de inmueble ni consumo. |
| p041 | Apartamento en Medellín, consumo promedio 230 kWh/mes. Quiere montar paneles solares, sin afán, posiblemente el próximo año. |
| p042 | Apartamento donde vive; quiere sistema solar instalado antes de fin de mes. Pregunta también cómo funciona vender energía a la red. |
| p043 | Persona en apartamento de Bogotá que solo se informa sobre energía solar, sin intención de compra por ahora. |
| p044 | Local de comidas rápidas en Medellín; paga cerca de $1,5 millones/mes de luz. Quiere saber si le sirven los paneles solares. Sin urgencia i… |
| p045 | Paga unos 450.000 COP mensuales de luz en Cali; no piensa comprar todavía, solo se está informando sobre energía solar. |
| p046 | Dueño de fábrica de arepas; quiere instalar solar este año. Pregunta cómo funciona vender energía a la red. Sin consumo ni factura. |
| p047 | Spam: oferta de ganar dinero con criptomonedas desde casa. No pide nada de energía solar. |
| p049 | Quiere entender cómo funciona la energía solar antes de decidir; tal vez compre en un par de años. Ubicado en Bogotá. |
| p050 | Apartamento en Medellín; quiere montar paneles solares. Consumo promedio de 430 kWh al mes. Sin fecha indicada. |
