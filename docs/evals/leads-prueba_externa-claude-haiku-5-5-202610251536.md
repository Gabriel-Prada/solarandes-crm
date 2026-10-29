# Examen de la calificación de leads: prueba_externa, claude-haiku-5-5

*25/10/2026, 10:36:58 a. m. · prompt calificar-lead-v2 · esfuerzo low · 14 casos*

| Qué | Resultado |
|---|---|
| Prioridad correcta | **14 de 14** |
| Errores graves (un lead de prioridad alta quedó en baja, como "no es lead" o sin ficha) | **0** de 6 leads de prioridad alta |
| Sin ficha porque Claude se negó o respondió mal | 0 |
| Sin ficha porque la API falló (no es culpa del modelo; repetir esos casos) | 0 |
| Resúmenes para revisar a mano (pagos, "VIP", cifras largas) | 0 |
| Costo del examen | USD 0.0039 |
| Costo por lead | USD 0.000282 (1.000 leads ≈ USD 0.28) |
| Tiempo de respuesta | promedio 1781 ms, máximo 3752 ms |

## Aciertos por campo

| Campo | Acertó |
|---|---|
| es_lead | 14 de 14 |
| tipo_cliente | 14 de 14 |
| urgencia | 14 de 14 |
| intencion | 14 de 14 |
| consumo_kwh_mes | 14 de 14 |
| factura_luz_cop | 14 de 14 |

## Dónde falló

| Caso | Mensaje | Prioridad (correcta → obtenida) | Campos que no coincidieron |
|---|---|---|---|


## Resúmenes

Lo que leería el asesor en el CRM y en el aviso (ya limpio de teléfonos, correos y enlaces). ⚠️ = para revisar a mano.

| Caso | Resumen |
|---|---|
| e001 | Panadería en Belén (Medellín), hornos eléctricos, paga $850.000/mes de luz. Quiere cotización de paneles solares para techo propio. |
| e002 | Familia recién mudada a casa en Ciudad Jardín (Cali) pide cotización de paneles solares y posible batería; instalaría el próximo año. Consu… |
| e003 | Vive en arriendo en apto piso 6 de Chapinero; pregunta si puede poner panel pequeño en balcón y precio. Paga ~120 mil/mes; debe consultar a… |
| e004 | Hogar en Suba (7 personas). Solo averigua precios, sin decisión; quizás más adelante. Paga unos 2 millones bimestrales de luz (≈1 millón/me… |
| e005 | Importadora Voltaica del Pacífico ofrece paneles, inversores y baterías al por mayor para instaladoras; es proveedor, no cliente. |
| e006 | Técnico electricista con experiencia en paneles solares busca empleo en SolarAndes (Cali); pide dónde enviar hoja de vida. |
| e007 | Finca lechera (San Pedro de los Milagros) quiere cotizar solar con respaldo por cortes; inversión en el 1er semestre del otro año. 1300 kWh… |
| e008 | Hogar en Cali (casa de dos pisos, barrio El Ingenio) que paga ~380.000 COP/mes de luz. Quiere sistema solar como regalo; visita esta semana. |
| e009 | Hogar con paneles instalados hace 2 años por otra empresa cerrada; inversor con error hace 3 semanas, no genera. Paga ~290.000 COP/mes. Pid… |
| e010 | Administradora de conjunto P.H. quiere cotizar paneles solares para zonas comunes; factura mensual de 4,2 millones; necesita dos cotizacion… |
| e011 | Iglesia en Bosa (Bogotá) paga unos 700 mil/mes de luz; pastor quiere entender paneles y costo aproximado. Sin afán, evaluarán colecta. |
| e012 | Pide duplicado de factura de energía de su casa porque no le llegó y vence el viernes; no es cliente de solar ni pregunta por sistema. |
| e013 | Pregunta precio instalado de un kit solar de 3 kW en Cali. No dice si es hogar o negocio ni cuándo lo necesita. |
| e014 | Restaurante en Cali (El Peñón) con cuarto frío, 3 neveras y aires; paga $2.350.000 de luz al mes. Quiere instalar este mismo mes. |
