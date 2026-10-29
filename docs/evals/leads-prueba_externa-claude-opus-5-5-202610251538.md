# Examen de la calificación de leads: prueba_externa, claude-opus-5-5

*25/10/2026, 10:38:12 a. m. · prompt calificar-lead-v2 · esfuerzo low · 14 casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **14 de 14** |
| Errores graves (un lead de prioridad alta quedó en baja, como "no es lead" o sin ficha) | **0** de 6 leads de prioridad alta |
| Sin ficha porque Claude se negó o respondió mal | 0 |
| Sin ficha porque la API falló (no es culpa del modelo; repetir esos casos) | 0 |
| Resúmenes para revisar a mano (pagos, "VIP", cifras largas) | 0 |
| Costo del examen | USD 0.1418 |
| Costo por lead | USD 0.010127 (1.000 leads ≈ USD 10.13) |
| Tiempo de respuesta | promedio 2620 ms, máximo 3174 ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
| es_lead | 14 de 14 |
| tipo_cliente | 14 de 14 |
| urgencia | 13 de 14 |
| intencion | 14 de 14 |
| consumo_kwh_mes | 14 de 14 |
| factura_luz_cop | 14 de 14 |

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|
| e010 | Buenas tardes, escribo como administradora del conjunto. Queremos evaluar paneles solares para las zonas comunes (2 asce | alta → alta | urgencia: "media" → "alta" |

## Resúmenes

Lo que leería el asesor en el CRM y en el aviso (ya limpio de teléfonos, correos y enlaces). ⚠️ = para revisar a mano.

| Caso | Resumen |
|---|---|
| e001 | Panadería en Belén, Medellín, con hornos eléctricos; pide cotización de paneles en techo de local propio. Paga $850.000/mes |
| e002 | Casa en Cali, consume 650 kWh/mes por aire acondicionado; pide cotización de paneles y quizá batería, sin afán, el próximo año |
| e003 | Apto arrendado en Chapinero, piso 6 con balcón; pregunta si es posible un panel pequeño y precio aprox. Paga 120 mil/mes. Debe consultar du… |
| e004 | Casa en Suba (Bogotá), 7 personas; solo averigua precios sin plan concreto. Paga ~1 millón/mes de luz (2 millones bimestral) |
| e005 | Proveedor mayorista de paneles, inversores y baterías en Cali ofrece catálogo y precios a instaladores. No es cliente. |
| e006 | Tecnólogo electricista en Cali con trabajo en alturas y 3 años montando paneles busca empleo; pregunta dónde enviar hoja de vida |
| e007 | Finca lechera con ordeño y tanque de frío; quiere cotizar solar con respaldo; invertiría 1er semestre del próximo año; 1300 kWh/mes, $1,2M |
| e008 | Casa de dos pisos en Cali (El Ingenio), paga $380.000/mes de luz; quiere visita esta semana y contratar paneles ya, regalo de Navidad |
| e009 | Casa con paneles de otra empresa (cerrada); inversor con error hace 3 semanas, no genera. Pide revisión urgente. Paga ~290 mil/mes |
| e010 | Conjunto residencial en Medellín pide cotización formal solar para zonas comunes; asamblea en marzo; factura $4.200.000/mes. |
| e011 | Iglesia en Bosa con techo grande, paga 700 mil/mes; quiere saber cómo funcionan los paneles y costo aproximado, sin afán |
| e012 | Pide duplicado de su factura de energía de la casa (vence el viernes); se equivocó de empresa, no busca sistema solar. |
| e013 | Pregunta precio de kit solar de 3 kW instalado en Cali; sin datos de consumo, factura ni plazos. |
| e014 | Restaurante en Cali con cuarto frío, neveras y aires; paga $2.350.000 de luz; quiere instalar este mismo mes |
