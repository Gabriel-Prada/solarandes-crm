# Examen de la calificación de leads: prueba, claude-opus-5-5

*25/10/2026, 10:21:15 a. m. · prompt calificar-lead-v2 · esfuerzo low · 50 casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **49 de 50** |
| Errores graves (un lead de prioridad alta quedó en baja o como "no es lead") | **1** de 15 leads de prioridad alta |
| Sin ficha (rechazo, respuesta inválida o error) | 0 |
| Costo del examen | USD 0.4871 |
| Costo por lead | USD 0.009742 (1.000 leads ≈ USD 9.74) |
| Tiempo de respuesta | promedio 2723 ms, máximo 4168 ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
| es_lead | 50 de 50 |
| tipo_cliente | 50 de 50 |
| urgencia | 49 de 50 |
| intencion | 49 de 50 |
| consumo_kwh_mes | 50 de 50 |
| factura_luz_cop | 50 de 50 |

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|
| p016 | Buenas noches, Son más o menos 1100 kWh/mes. No voy a comprar todavía, solo me estoy informando. Manejo una fábrica de a | baja → baja | urgencia: "no_se_sabe" → "baja" |
| p021 | Nada urgente, es para ir mirando. Estoy interesado en montar paneles. Tenemos una lavandería. | alta → baja | intencion: "quiere_sistema" → "solo_informacion" |
