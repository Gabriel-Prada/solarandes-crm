/**
 * Lo que "sabe" SolarAndes para responder preguntas frecuentes (fase 6, pieza 2; decisión E del plan).
 *
 * SolarAndes es una empresa FICTICIA: estas políticas (garantías, tiempos, formas de pago) son datos
 * inventados para el ejercicio, coherentes con docs/requisitos.md. Lo que toca leyes o regulación de
 * Colombia se dice en general y sin cifras, porque cambia y no es la empresa quien lo decide.
 *
 * Cada fragmento trata un solo tema. El asistente busca los que sirven para la pregunta (buscar.ts) y
 * responde solo con ellos. Si cambias un fragmento, vuelve a correr el examen.
 */

export type Fragmento = {
  id: string;
  titulo: string;
  /** Palabras que la gente usa para preguntar por este tema y que quizá no aparecen en el texto */
  sinonimos: string[];
  texto: string;
};

export const VERSION_CONOCIMIENTO = "2026-10-30";

export const CONOCIMIENTO: Fragmento[] = [
  {
    id: "empresa",
    titulo: "Quiénes somos",
    sinonimos: ["empresa", "quienes son", "experiencia", "confiable", "donde estan"],
    texto:
      "SolarAndes S.A.S. instala sistemas de energía solar para hogares y pequeños negocios (panaderías, talleres, oficinas, restaurantes). Tiene 4 años de experiencia y opera en Bogotá, Medellín y Cali. Hace entre 8 y 15 instalaciones al mes.",
  },
  {
    id: "ciudades",
    titulo: "Dónde instalamos",
    sinonimos: ["cobertura", "zona", "municipio", "pueblo", "otra ciudad", "barranquilla", "cartagena", "pereira", "bucaramanga"],
    texto:
      "Por ahora SolarAndes instala solo en Bogotá, Medellín y Cali. Fuera de esas tres ciudades no hacemos instalaciones; si la persona está en otra ciudad, se le puede tomar el dato por si la cobertura crece.",
  },
  {
    id: "como_funciona",
    titulo: "Cómo funciona un sistema solar",
    sinonimos: ["funcionamiento", "inversor", "medidor", "red", "conectado", "noche", "de noche"],
    texto:
      "Los sistemas que instala SolarAndes van conectados a la red eléctrica. Los paneles convierten la luz del sol en electricidad, el inversor la vuelve apta para la casa o el negocio y lo que no se alcanza a producir se sigue tomando de la red, como hoy. De noche no hay producción solar: la casa usa la energía de la red. Se instala un medidor que cuenta la energía en las dos direcciones.",
  },
  {
    id: "nublado",
    titulo: "Días nublados y lluvia",
    sinonimos: ["nubes", "lluvia", "invierno", "llueve", "clima", "sol"],
    texto:
      "Con nubes o lluvia los paneles producen menos, pero no dejan de producir. Por eso el cálculo usa las horas de sol pico promedio de cada ciudad (Bogotá 4,0, Medellín 4,5 y Cali 4,8 al día), que ya incluyen los días nublados del año.",
  },
  {
    id: "precio",
    titulo: "Cómo se calcula el precio",
    sinonimos: ["cuanto cuesta", "valor", "cotizacion", "presupuesto", "costo", "precio"],
    texto:
      "El precio depende del consumo mensual en kWh (aparece en la factura de luz) y de la ciudad. Se calcula la potencia necesaria, se redondea al número de paneles de 550 W y se cobra un precio llave en mano por kWp instalado (equipos, instalación y trámites). Un solo precio para todo el sistema, según su tamaño: si el sistema es de hasta 10 kWp, 4.500.000 pesos por kWp; si es de más de 10 kWp, todo el sistema va a 3.800.000 pesos por kWp (no se cobra por tramos). El asistente da una pre-cotización de referencia; el precio final lo confirma el asesor después de la visita técnica.",
  },
  {
    id: "rangos",
    titulo: "Rangos de precio",
    sinonimos: ["mas o menos", "aproximado", "rango", "promedio", "cuanto vale"],
    texto:
      "Como referencia, una instalación de hogar cuesta entre 5 y 40 millones de pesos y la de un negocio entre 35 y 180 millones, según el consumo.",
  },
  {
    id: "proceso",
    titulo: "Cómo es el proceso",
    sinonimos: ["pasos", "como empiezo", "que sigue", "procedimiento", "contratar"],
    texto:
      "El proceso tiene cinco pasos: 1) un asesor habla con la persona; 2) visita técnica gratuita para medir el techo y revisar el consumo; 3) cotización formal en un plazo de 2 días hábiles después de la visita; 4) firma y anticipo; 5) instalación y trámite de conexión con la empresa de energía.",
  },
  {
    id: "visita",
    titulo: "La visita técnica",
    sinonimos: ["visita", "tecnico", "medir", "inspeccion", "ir a mi casa", "agendar"],
    texto:
      "La visita técnica es gratuita y sin compromiso. Un técnico de SolarAndes revisa el techo (espacio, orientación, sombras y estructura) y el consumo de energía. Dura alrededor de una hora y se hace de lunes a viernes entre las 8 a. m. y las 5 p. m. Conviene tener a mano una factura de luz reciente.",
  },
  {
    id: "tiempos",
    titulo: "Cuánto se demora la instalación",
    sinonimos: ["demora", "cuanto tarda", "tiempo", "dias", "plazo", "cuando"],
    texto:
      "La instalación de un hogar toma de 1 a 3 días de trabajo; la de un negocio, de 1 a 2 semanas según el tamaño. Antes de que el sistema entregue energía a la red hay un trámite de conexión con la empresa de energía de la zona, que suele tomar de 1 a 2 meses y no depende de SolarAndes.",
  },
  {
    id: "tramites",
    titulo: "Trámites y permisos",
    sinonimos: ["permiso", "tramite", "papeleo", "operador de red", "empresa de energia", "enel", "epm", "emcali", "legal"],
    texto:
      "El precio llave en mano incluye los trámites de conexión ante la empresa de energía de la zona. SolarAndes los hace por el cliente; el cliente solo firma los documentos que se necesiten.",
  },
  {
    id: "garantias",
    titulo: "Garantías",
    sinonimos: ["garantia", "cuanto duran", "vida util", "se dana", "falla", "respaldo"],
    texto:
      "Garantías de SolarAndes: los paneles tienen 12 años de garantía de producto y 25 años de garantía de producción (siguen produciendo al menos el 80 % de lo inicial); el inversor, 10 años; la instalación, 2 años. Las garantías de los equipos las respalda el fabricante y SolarAndes hace el trámite.",
  },
  {
    id: "mantenimiento",
    titulo: "Mantenimiento",
    sinonimos: ["limpieza", "limpiar", "mantener", "cuidado", "revision"],
    texto:
      "Un sistema solar necesita poco mantenimiento: limpiar los paneles cada 6 meses (más seguido si hay mucho polvo) y una revisión general al año. SolarAndes ofrece un plan de mantenimiento opcional; su precio lo informa el asesor.",
  },
  {
    id: "pagos",
    titulo: "Formas de pago",
    sinonimos: ["pagar", "pago", "anticipo", "cuotas", "credito", "financiacion", "financiar", "tarjeta", "transferencia"],
    texto:
      "La forma de pago habitual es 50 % de anticipo al firmar y 50 % al terminar la instalación, por transferencia bancaria. Para financiar, SolarAndes trabaja con entidades aliadas: la aprobación depende del estudio de crédito de cada entidad y las condiciones las informa el asesor. El asistente no puede ofrecer descuentos ni condiciones especiales.",
  },
  {
    id: "techo",
    titulo: "Qué techo se necesita",
    sinonimos: ["techo", "cubierta", "teja", "terraza", "espacio", "metros", "area", "plancha"],
    texto:
      "Sirven la mayoría de techos: placa de concreto, teja de barro, teja metálica o de fibrocemento. Cada panel de 550 W ocupa unos 2,6 metros cuadrados, así que un sistema de 3,3 kWp (6 paneles) necesita alrededor de 16 metros cuadrados sin sombra. En la visita el técnico revisa si la estructura aguanta el peso; si el techo no es apto, se le dice al cliente.",
  },
  {
    id: "apartamentos",
    titulo: "Apartamentos y conjuntos",
    sinonimos: ["apartamento", "conjunto", "edificio", "propiedad horizontal", "administracion", "arriendo", "arrendado"],
    texto:
      "En apartamentos y conjuntos la cubierta suele ser una zona común: se necesita la autorización de la administración o de la asamblea. Si la vivienda es arrendada, se necesita la autorización del dueño.",
  },
  {
    id: "baterias",
    titulo: "Baterías",
    sinonimos: ["bateria", "almacenar", "guardar energia", "aislado", "finca", "sin red", "off grid"],
    texto:
      "SolarAndes instala sobre todo sistemas conectados a la red, sin baterías. Los sistemas con baterías (para tener respaldo o para lugares sin red) se cotizan de forma especial con un asesor, porque cambian mucho el precio.",
  },
  {
    id: "apagones",
    titulo: "Qué pasa si se va la luz",
    sinonimos: ["apagon", "se va la luz", "corte", "respaldo", "emergencia"],
    texto:
      "Un sistema conectado a la red se apaga solo cuando se va la luz de la red, por seguridad de quienes trabajan en las redes. Para tener energía durante un apagón se necesitan baterías, que se cotizan aparte con un asesor.",
  },
  {
    id: "ahorro",
    titulo: "Cuánto se ahorra",
    sinonimos: ["ahorro", "ahorrar", "factura", "recuperar", "retorno", "inversion", "se paga solo", "cuanto me ahorro"],
    texto:
      "El sistema se dimensiona para producir en promedio la energía que la persona consume al mes, así que reduce buena parte de la factura de luz. Cuánto se ahorra y en cuánto tiempo se recupera la inversión depende de la tarifa, del consumo y de la regulación vigente: el asistente no da esas cifras; el asesor presenta un estimado con los datos reales después de la visita.",
  },
  {
    id: "excedentes",
    titulo: "Excedentes de energía",
    sinonimos: ["excedente", "vender energia", "sobrante", "entregar a la red", "autogeneracion"],
    texto:
      "En Colombia la regulación permite a quien genera su propia energía entregar a la red la que le sobra. Cómo se reconoce ese excedente depende de la regulación vigente y de la empresa de energía de la zona; el asesor lo explica para cada caso.",
  },
  {
    id: "beneficios",
    titulo: "Beneficios tributarios",
    sinonimos: ["impuestos", "beneficio", "deduccion", "iva", "renta", "incentivo", "ley"],
    texto:
      "La ley colombiana tiene incentivos tributarios para inversiones en energías renovables. Si aplican y cuánto, depende de cada persona o empresa y de las normas vigentes: SolarAndes no da asesoría tributaria; lo recomendable es consultarlo con un contador.",
  },
  {
    id: "horario",
    titulo: "Horario de atención",
    sinonimos: ["horario", "a que hora", "atienden", "asesor", "llamar", "hablar con alguien", "persona", "humano"],
    texto:
      "Los asesores de SolarAndes atienden de lunes a viernes de 8 a. m. a 6 p. m. Fuera de ese horario, el asistente toma la solicitud y un asesor contacta a la persona el siguiente día hábil.",
  },
  {
    id: "datos",
    titulo: "Datos personales",
    sinonimos: ["privacidad", "mis datos", "habeas data", "borrar mis datos", "proteccion de datos"],
    texto:
      "SolarAndes usa los datos de contacto solo para atender la solicitud, según la Ley 1581 de protección de datos. Las conversaciones con el asistente se borran a los 30 días. Para consultar, corregir o borrar sus datos, la persona puede pedírselo a un asesor.",
  },
];
