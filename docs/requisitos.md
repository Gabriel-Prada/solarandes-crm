# Requisitos de SolarAndes S.A.S.

*Notas de la reunión inicial con Laura Méndez, gerente general. Empresa y personas ficticias.*

---

## 1. La empresa

SolarAndes instala sistemas de energía solar para **hogares** y **pequeños negocios** (panaderías, talleres, oficinas, restaurantes). Tiene 4 años y opera en **Bogotá, Medellín y Cali**.

- 6 personas: la gerente, 3 asesores comerciales, 1 técnico instalador y 1 contadora externa.
- Cierra entre 8 y 15 instalaciones al mes.
- Una instalación de hogar cuesta entre 5 y 40 millones de pesos; la de un negocio, entre 35 y 180 millones.

> *"Nos llegan muchos interesados, pero no sé cuántos se nos pierden. Cada asesor lleva sus clientes en su celular y en un Excel. Cuando alguien renuncia, se lleva los contactos."* (Laura)

---

## 2. Las personas

| Nombre           | Rol                 | Ciudad        | Usa el sistema para                                       |
| ---------------- | ------------------- | ------------- | --------------------------------------------------------- |
| Laura Méndez     | Gerente             | Bogotá        | Ver todo: ventas, asesores, leads perdidos                |
| Andrés Rojas     | Asesor              | Bogotá        | Sus leads, visitas y cotizaciones                         |
| Valentina Ospina | Asesora             | Medellín      | Ídem                                                      |
| Camilo Torres    | Asesor              | Cali          | Ídem                                                      |
| Jhon Fredy Muñoz | Técnico             | Viaja a las 3 | Ver sus visitas técnicas e instalaciones desde el celular |
| Marcela Díaz     | Contadora (externa) | —             | Registrar facturas de proveedores (fase 4)                |

---

## 3. El proceso de venta

```
nuevo → contactado → visita_agendada → cotizado → negociacion → ganado
                                                              ↘ perdido (desde cualquier etapa)
```

| Etapa | Qué significa | Probabilidad de cierre |
|---|---|---|
| `nuevo` | Llegó el lead, nadie lo ha contactado | 5 % |
| `contactado` | Un asesor habló con él | 15 % |
| `visita_agendada` | Hay fecha para que el técnico mida techo y consumo | 35 % |
| `cotizado` | Se envió la cotización | 50 % |
| `negociacion` | El cliente pidió ajustes, financiación o descuento | 70 % |
| `ganado` | Firmó y pagó el anticipo | 100 % |
| `perdido` | Dijo que no o dejó de responder | 0 % |

**Motivos de pérdida:** precio, eligió a la competencia, no respondió, techo no apto, sin financiación, aplazó la decisión.

### De dónde llegan los leads
| Canal | Porcentaje aproximado |
|---|---|
| Anuncios (Facebook e Instagram) | 40 % |
| WhatsApp directo | 25 % |
| Formulario de la web | 20 % |
| Referidos de clientes | 15 % |

Los referidos se cierran mucho más que los de anuncios.

### Asignación
Cada lead se asigna al asesor de su ciudad. Hoy se hace a mano y a veces nadie lo toma.

---

## 4. Cómo se calcula una cotización

1. El cliente da su **consumo mensual en kWh** (aparece en la factura de luz).
2. Se calcula la potencia necesaria:

   ```
   potencia_kWp = consumo_kWh_mes / (HSP × 30 × 0,8)
   ```
   - **HSP** (horas sol pico, la energía solar promedio al día): Bogotá 4,0 · Medellín 4,5 · Cali 4,8.
   - **0,8** es la eficiencia del sistema (pérdidas por calor, cables e inversor).

3. Se redondea hacia arriba al número de **paneles de 550 W**.
4. Precio "llave en mano" (equipos, instalación y trámites) por kWp instalado:
   - Hasta 10 kWp: **4.500.000 COP/kWp**
   - Más de 10 kWp: **3.800.000 COP/kWp**

**Ejemplo:** un hogar en Bogotá que consume 300 kWh/mes necesita 300 / (4,0 × 30 × 0,8) = 3,13 kWp, es decir 6 paneles (3,3 kWp), por 14.850.000 COP.

> Son cifras de referencia para el ejercicio, no precios reales del mercado.

---

## 5. Problemas que hay que resolver

| # | Problema | Fase que lo resuelve |
|---|---|---|
| P1 | Los clientes están regados en celulares y Excels | 1. CRM |
| P2 | No se sabe cuántos leads llegan ni cuántos se pierden | 1. Panel del gerente |
| P3 | El Excel heredado tiene duplicados y datos mal escritos | 2. Migración |
| P4 | Los leads tardan horas en ser atendidos y se olvidan los seguimientos | 3. Automatizaciones |
| P5 | El técnico se entera tarde de sus visitas | 3. Automatizaciones |
| P6 | Los asesores no saben qué lead atender primero | 4. Calificación con IA |
| P7 | La contadora transcribe facturas a mano | 4. Extractor de facturas |
| P8 | Laura quiere preguntarle cosas al negocio sin abrir reportes | 5. MCP y Skills |
| P9 | Fuera de horario nadie responde por WhatsApp | 6. Chatbot |

---

## 6. Reglas de negocio

- Un **contacto** es una persona o empresa. Puede tener varias **oportunidades** (por ejemplo, amplía su sistema años después).
- Cada contacto tiene un **asesor responsable**, que por defecto es el de su ciudad.
- Toda llamada, mensaje, visita o nota queda registrada como **actividad**.
- Un asesor **solo ve** sus contactos y oportunidades. La gerente ve todo. El técnico solo ve sus visitas.
- Un lead sin actividad en **3 días** es "sin seguimiento"; a los **7 días** se avisa a la gerente.
- Los teléfonos se guardan en formato `+57XXXXXXXXXX` (celular de 10 dígitos que empieza por 3).
- Ciudades válidas: `Bogotá`, `Medellín`, `Cali`.

---

## 7. Requisitos no funcionales

- Todo en español.
- El técnico usa el sistema desde el celular: las pantallas que él ve deben funcionar bien en móvil.
- Los datos de clientes son personales (Ley 1581 de protección de datos): acceso con usuario y contraseña, y cada quien ve solo lo que le corresponde.
- Si una automatización falla, alguien debe enterarse el mismo día.

---

## 8. Glosario

| Término | Significado |
|---|---|
| **Lead** | Persona interesada que todavía no ha comprado |
| **Oportunidad** | Una posible venta concreta a un contacto |
| **Embudo (pipeline)** | Las etapas por las que pasa una oportunidad |
| **kWh** | Kilovatio-hora: la unidad del consumo de energía en la factura de luz |
| **kWp** | Kilovatio pico: la potencia máxima de un sistema solar |
| **HSP** | Horas sol pico: cuánta energía solar recibe un lugar al día, en promedio |
| **Llave en mano** | Precio que incluye equipos, instalación y trámites |
