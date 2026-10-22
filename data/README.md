# Datos de SolarAndes

Todos los datos son **ficticios** y los produce `scripts/datos/generar_datos.py` con una semilla fija. Si se borran, se regeneran idénticos.

## `generados/`: el negocio "verdadero"

Un año de operación (21/10/2025 a 21/10/2026). Es lo que se cargará al CRM en la fase 1.

| Archivo | Filas aprox. | Contenido |
|---|---|---|
| `usuarios.csv` | 6 | Gerente, 3 asesores, técnico y contadora |
| `productos.csv` | 8 | Catálogo: paneles, inversores, baterías y servicios |
| `contactos.csv` | 1.000 | Hogares (75 %) y negocios (25 %) en Bogotá, Medellín y Cali |
| `oportunidades.csv` | 1.000 | Una venta posible por contacto, más algunas ampliaciones. Cerca del 12 % se gana |
| `actividades.csv` | 4.500 | Llamadas, WhatsApp, correos, visitas, notas y tareas |
| `cotizaciones.csv` | 480 | Calculadas con la fórmula de `docs/requisitos.md`; algunas con versión ajustada |

Detalles útiles para las demos:
- Hay oportunidades abiertas en todas las etapas, y algunas **sin seguimiento** desde hace más de 7 días (para las alertas de la fase 3).
- Los correos usan dominios `example.*`, que no pertenecen a nadie. Los teléfonos son inventados, pero **pueden coincidir con números reales**: las automatizaciones solo deben escribirles a números de prueba autorizados.

## `heredado/`: el Excel desordenado (fase 2)

`clientes_heredado.xlsx` simula lo que llevaban los asesores antes del CRM: los 280 contactos más antiguos, con:

- Dos hojas con columnas distintas. La de Medellín no tiene ciudad ni asesor y empieza con un título encima del encabezado.
- Duplicados de la misma persona escritos de otra forma.
- Teléfonos, ciudades, tipos de cliente, consumos y fechas en muchos formatos.
- Correos en mayúsculas, con espacios o incompletos, y teléfonos a los que les falta un dígito.
- Filas vacías, un encabezado repetido en la mitad y una fila de "TOTAL" al final.

`respuestas_migracion.csv` dice qué contacto real hay detrás de cada fila y si su teléfono y su correo se pueden recuperar. Con ese archivo se mide qué tan bien funciona la migración de la fase 2.
