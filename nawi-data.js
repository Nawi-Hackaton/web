/* =========================================================
   Ñawi — Datos del asistente (web).
   Fuente de verdad de los trámites: data/documentos/tupa_demo.txt
   (información PÚBLICA del GORE Cusco). Los expedientes son simulados
   para la demo y NO contienen datos personales reales.

   Quechua (Runa Simi): el TUPA no incluye traducción. Por exactitud, el
   CONTENIDO de trámites y expedientes se muestra en español también en QU
   (campos *Qu omitidos -> los getters hacen fallback al español). Los textos
   de interfaz del asistente sí están en quechua real (ver nawi-engine.js).
   Pendiente: traducción profesional de los trámites por un hablante nativo.
   ========================================================= */
"use strict";

const DEMO_CITIZEN = {
  fullName: "María Quispe Mamani",
  dni: "12345678",
  maskedDni: "••••••78",
  phone: "+51 900 000 000",
};

const ALT_CITIZEN = {
  fullName: "Ciudadano no vinculado",
  dni: "00000000",
};

// Los 8 trámites del TUPA del GORE Cusco (tupa_demo.txt).
const PROCEDURES = [
  {
    id: "certificado-trabajo",
    name: "Certificado de trabajo",
    category: "constancia",
    synonyms: ["papel de trabajo", "constancia laboral", "constancia de trabajo", "certificado laboral"],
    requirements: [
      "Solicitud dirigida al Gerente Regional de Trabajo, indicando el motivo.",
      "Copia simple del DNI vigente del solicitante.",
    ],
    cost: "Gratuito",
    estimate: "5 días hábiles",
    office: "Gerencia Regional de Trabajo y Promoción del Empleo",
  },
  {
    id: "constancia-no-adeudo",
    name: "Constancia de no adeudo",
    category: "constancia",
    synonyms: ["constancia de no deuda", "certificado de no adeudo", "no adeudo"],
    requirements: [
      "Solicitud simple dirigida al Gerente Regional de Administración y Finanzas.",
      "Copia simple del DNI vigente.",
      "Indicar el motivo por el cual se solicita la constancia.",
    ],
    cost: "Gratuito",
    estimate: "3 días hábiles",
    office: "Gerencia Regional de Administración y Finanzas",
  },
  {
    id: "certificado-habilidad",
    name: "Certificado de habilidad profesional",
    category: "constancia",
    synonyms: ["habilidad profesional", "certificado de colegiatura", "estar hábil"],
    requirements: [
      "Solicitud dirigida al Gerente Regional de Trabajo.",
      "Copia simple del DNI vigente.",
      "Copia del título profesional o constancia de egresado.",
      "Recibo de pago por derecho de trámite.",
    ],
    cost: "Gratuito",
    estimate: "7 días hábiles",
    office: "Gerencia Regional de Trabajo y Promoción del Empleo",
  },
  {
    id: "solicitud-informacion",
    name: "Solicitud de información pública",
    category: "documento",
    synonyms: ["acceso a la información", "pedir información", "solicitar documentos públicos", "transparencia"],
    requirements: [
      "Solicitud indicando claramente qué información se requiere.",
      "Copia simple del DNI del solicitante.",
      "Indicar el formato deseado: digital o físico.",
      "Correo electrónico o dirección para la notificación.",
    ],
    cost: "Gratuito (puede haber costo de reproducción de copias físicas)",
    estimate: "7 días hábiles",
    office: "Oficina de Transparencia y Acceso a la Información Pública",
  },
  {
    id: "licencia-salud",
    name: "Licencia de funcionamiento para establecimientos de salud privados",
    category: "solicitud",
    synonyms: ["licencia de salud", "autorización para clínica", "permiso para establecimiento de salud"],
    requirements: [
      "Solicitud dirigida al Director de la Gerencia Regional de Salud.",
      "Copia simple del DNI del representante legal.",
      "Copia de la escritura pública de constitución de la empresa, si aplica.",
      "Plano de distribución del establecimiento a escala 1/50.",
      "Memoria descriptiva del establecimiento.",
      "Lista de equipos y mobiliario médico.",
      "Currículum vitae del director médico responsable.",
      "Copia del título médico y especialidad del director médico.",
      "Recibo de pago por derecho de inspección.",
    ],
    cost: "Sujeto a tasa por inspección (consultar en ventanilla)",
    estimate: "30 días hábiles",
    office: "Gerencia Regional de Salud de Cusco",
  },
  {
    id: "autorizacion-recursos",
    name: "Autorización para aprovechamiento de recursos naturales",
    category: "solicitud",
    synonyms: ["permiso para recursos naturales", "autorización ambiental", "permiso de extracción"],
    requirements: [
      "Solicitud dirigida al Gerente Regional de Recursos Naturales.",
      "Copia del DNI o RUC del solicitante.",
      "Memoria descriptiva de la actividad a desarrollar.",
      "Estudio de impacto ambiental, para proyectos de mediana o gran escala.",
      "Croquis de ubicación del área de aprovechamiento.",
      "Recibo de pago por derecho de trámite.",
    ],
    cost: "Variable según el tipo de recurso y escala (consultar en ventanilla)",
    estimate: "30 días hábiles",
    office: "Gerencia Regional de Recursos Naturales y Gestión del Medio Ambiente",
  },
  {
    id: "registro-organizaciones",
    name: "Registro de organizaciones sociales y comunidades campesinas",
    category: "solicitud",
    synonyms: ["registro de comunidad", "inscripción de organización social", "registro comunal", "registro de organización social"],
    requirements: [
      "Solicitud dirigida al Gerente Regional de Desarrollo Social.",
      "Acta de constitución o actualización de la organización, con firmas originales.",
      "Lista de integrantes con DNI y firmas.",
      "Copia del DNI del representante legal o presidente.",
      "Estatutos de la organización aprobados en asamblea.",
      "Copia del acta de elección de la junta directiva vigente.",
    ],
    cost: "Gratuito",
    estimate: "15 días hábiles",
    office: "Gerencia Regional de Desarrollo Social",
  },
  {
    id: "beca-estudios",
    name: "Visa de estudios para programas de becas regionales",
    category: "solicitud",
    synonyms: ["beca regional", "apoyo educativo", "beca de estudios cusco", "beca"],
    requirements: [
      "Solicitud de postulación en el formato establecido.",
      "Copia del DNI del postulante.",
      "Partida de nacimiento original o copia legalizada.",
      "Certificado de estudios del último año cursado.",
      "Constancia de domicilio en la región Cusco, mínimo 2 años de residencia.",
      "Declaración jurada de ingresos familiares.",
      "Dos fotografías tamaño pasaporte.",
    ],
    cost: "Gratuito",
    estimate: "45 días hábiles (proceso de selección)",
    office: "Gerencia Regional de Educación de Cusco",
  },
];

// Expedientes simulados para la demo (coherentes con el GORE, sin datos reales).
const SIM_FILES = [
  {
    number: "EXP-2026-0089",
    ownerName: DEMO_CITIZEN.fullName,
    ownerDni: DEMO_CITIZEN.dni,
    procedureId: "certificado-trabajo",
    procedureName: "Certificado de trabajo",
    date: "08 de junio de 2026",
    office: "Gerencia Regional de Trabajo y Promoción del Empleo",
    lastMovement: "Documento recibido y derivado para revisión a la Gerencia Regional de Trabajo.",
    status: "En revisión",
  },
  {
    number: "EXP-2026-0064",
    ownerName: DEMO_CITIZEN.fullName,
    ownerDni: DEMO_CITIZEN.dni,
    procedureId: "solicitud-informacion",
    procedureName: "Solicitud de información pública",
    date: "02 de junio de 2026",
    office: "Mesa de Partes",
    lastMovement: "Trámite resuelto favorablemente. La información está lista para su entrega.",
    status: "Aprobado",
  },
  {
    number: "EXP-2026-0051",
    ownerName: DEMO_CITIZEN.fullName,
    ownerDni: DEMO_CITIZEN.dni,
    procedureId: "registro-organizaciones",
    procedureName: "Registro de organización social",
    date: "28 de mayo de 2026",
    office: "Gerencia Regional de Desarrollo Social",
    lastMovement: "Falta el acta de elección de junta directiva firmada por todos los miembros.",
    status: "Observado",
    observation: "Falta el acta de elección de junta directiva firmada por todos los miembros.",
  },
  {
    number: "EXP-2026-9999",
    ownerName: "Persona no vinculada",
    ownerDni: "00000000",
    procedureId: "solicitud-informacion",
    procedureName: "Solicitud de información pública",
    date: "01 de junio de 2026",
    office: "Mesa de Partes",
    lastMovement: "Documento recibido.",
    status: "Recibido",
  },
];

// ---------- Helpers i18n (fallback al español si no hay campo *Qu) ----------
function getProcedureName(p, lang) { return lang === "qu" ? (p.nameQu || p.name) : p.name; }
function getProcedureRequirements(p, lang) { return lang === "qu" ? (p.requirementsQu || p.requirements) : p.requirements; }
function getProcedureEstimate(p, lang) { return lang === "qu" ? (p.estimateQu || p.estimate) : p.estimate; }
function getProcedureOffice(p, lang) { return lang === "qu" ? (p.officeQu || p.office) : p.office; }
function getProcedureCost(p, lang) { return lang === "qu" ? (p.costQu || p.cost) : p.cost; }
function getFileProcedureName(f, lang) { return lang === "qu" ? (f.procedureNameQu || f.procedureName) : f.procedureName; }
function getFileDate(f, lang) { return lang === "qu" ? (f.dateQu || f.date) : f.date; }
function getFileOffice(f, lang) { return lang === "qu" ? (f.officeQu || f.office) : f.office; }
function getFileLastMovement(f, lang) { return lang === "qu" ? (f.lastMovementQu || f.lastMovement) : f.lastMovement; }
function getFileStatus(f, lang) { return lang === "qu" ? (f.statusQu || f.status) : f.status; }
function getFileObservation(f, lang) { return lang === "qu" ? (f.observationQu || f.observation) : f.observation; }

function digitByDigit(num, lang) {
  const map = {
    "0": { es: "cero", qu: "ch'usaq" }, "1": { es: "uno", qu: "huk" },
    "2": { es: "dos", qu: "iskay" }, "3": { es: "tres", qu: "kimsa" },
    "4": { es: "cuatro", qu: "tawa" }, "5": { es: "cinco", qu: "pichqa" },
    "6": { es: "seis", qu: "suqta" }, "7": { es: "siete", qu: "qanchis" },
    "8": { es: "ocho", qu: "pusaq" }, "9": { es: "nueve", qu: "isqun" },
  };
  return String(num).split("").map((d) => (map[d] ? map[d][lang] : d)).join(", ");
}

// Dependencias REALES del GORE Cusco (sistema QELLQA). El chat web puede traerlas en vivo
// con GET /api/qellqa/dependencias; esta lista es el respaldo offline coherente con la API.
// El seguimiento real de un expediente requiere: número de expediente + dependencia + año.
const DEPENDENCIAS = [
  { iddependencia: 1, abrev: "GORE", nombre: "GORE - Sede Central del Gobierno Regional de Cusco" },
  { iddependencia: 2, abrev: "GERESA", nombre: "GERESA - Gerencia Regional de Salud" },
  { iddependencia: 3, abrev: "GRTPE", nombre: "GRTPE - Gerencia Regional de Trabajo y Promoción del Empleo" },
  { iddependencia: 4, abrev: "GEREDU", nombre: "GEREDU - Gerencia Regional de Educación" },
  { iddependencia: 5, abrev: "GREMH", nombre: "GREMH - Gerencia Regional de Energía, Minas e Hidrocarburos" },
  { iddependencia: 6, abrev: "GERAGRI", nombre: "GERAGRI - Gerencia Regional de Agricultura" },
  { iddependencia: 7, abrev: "GEREPRO", nombre: "GEREPRO - Gerencia Regional de la Producción" },
  { iddependencia: 8, abrev: "GERCETUR", nombre: "GERCETUR - Gerencia Regional de Comercio Exterior y Turismo" },
  { iddependencia: 9, abrev: "GRVCS", nombre: "GRVCS - Gerencia Regional de Vivienda, Construcción y Saneamiento" },
  { iddependencia: 10, abrev: "IMA", nombre: "IMA - Instituto de Manejo de Agua y Medio Ambiente" },
  { iddependencia: 11, abrev: "COPESCO", nombre: "COPESCO - Plan COPESCO Regional" },
  { iddependencia: 12, abrev: "MERISS", nombre: "MERISS - Proyecto Especial Regional Plan MERISS" },
  { iddependencia: 13, abrev: "GRTC", nombre: "GRTC - Gerencia Regional de Transportes y Comunicaciones" },
  { iddependencia: 14, abrev: "ZIMA", nombre: "ZIMA - Proyecto Especial Regional" },
  { iddependencia: 15, abrev: "UERSSC-VRAEM", nombre: "UERSSC-VRAEM - Unidad Ejecutora del VRAEM" },
];

// Tipos de documento más comunes (nombres reales de QELLQA). El backend resuelve el id real
// vía el GET de tipo-documentos. Sirven como botones de apoyo y para calzar lo que diga el usuario.
const TIPOS_DOC_COMUNES = [
  { nombre: "SOLICITUD", synonyms: ["solicitud", "solicito", "pedido"] },
  { nombre: "CARTA", synonyms: ["carta"] },
  { nombre: "INFORME", synonyms: ["informe"] },
  { nombre: "OFICIO", synonyms: ["oficio"] },
  { nombre: "CONSTANCIA", synonyms: ["constancia"] },
  { nombre: "MEMORIAL", synonyms: ["memorial"] },
  { nombre: "DECLARACION JURADA", synonyms: ["declaracion jurada", "declaración jurada", "declaracion", "jurada"] },
  { nombre: "ACTA", synonyms: ["acta"] },
];

window.NawiData = {
  DEMO_CITIZEN, ALT_CITIZEN, PROCEDURES, SIM_FILES, DEPENDENCIAS, TIPOS_DOC_COMUNES,
  getProcedureName, getProcedureRequirements, getProcedureEstimate, getProcedureOffice,
  getProcedureCost, getFileProcedureName, getFileDate, getFileOffice, getFileLastMovement,
  getFileStatus, getFileObservation, digitByDigit,
};
