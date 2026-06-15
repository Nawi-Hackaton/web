/* =========================================================
   Ñawi — Máquina de estados conversacional (port de engine.ts)
   JavaScript plano. Depende de NawiData y NawiIntents (window).
   ========================================================= */
"use strict";

(function () {
  const D = window.NawiData;
  const { classifyGlobal, matchOption, extractDni, extractFileNumber } = window.NawiIntents;
  const {
    DEMO_CITIZEN, PROCEDURES, SIM_FILES, digitByDigit,
    getFileDate, getFileLastMovement, getFileObservation, getFileOffice,
    getFileProcedureName, getFileStatus, getProcedureEstimate, getProcedureName,
    getProcedureOffice, getProcedureRequirements, getProcedureCost,
  } = D;

  // Mapa trámite → dependencia real del GORE (para emitir el trámite en QELLQA).
  const PROC_DEP = {
    "certificado-trabajo": 3, "constancia-no-adeudo": 1, "certificado-habilidad": 3,
    "solicitud-informacion": 1, "licencia-salud": 2, "autorizacion-recursos": 5,
    "registro-organizaciones": 1, "beca-estudios": 4,
  };
  function depNombre(idd) {
    const d = (D.DEPENDENCIAS || []).find((x) => x.iddependencia === idd);
    return d ? d.nombre : "";
  }

  // ---------- i18n ----------
  function t(lang, es, qu) { return lang === "qu" ? qu : es; }
  function ts(s, es, qu) { return t(s.language, es, qu); }

  const CUE = {
    web_es: "Ahora puedes decir la opción que prefieras.",
    web_say_es: "Ahora puedes hablar.",
    wa_es: "Responde seleccionando una opción o escribiendo el número.",
    web_qu: "Kunan munasqayki akllanata niykuwaq.",
    web_say_qu: "Kunan rimayta atinki.",
    wa_qu: "Huk akllanata akllay utaq yupayta qillqay.",
  };

  function speakingCue(channel, kind, lang) {
    kind = kind || "options";
    lang = lang || "es";
    if (lang === "qu") {
      if (channel === "web") return kind === "say" ? CUE.web_say_qu : CUE.web_qu;
      return CUE.wa_qu;
    }
    if (channel === "web") return kind === "say" ? CUE.web_say_es : CUE.web_es;
    return CUE.wa_es;
  }

  function initialState(channel) {
    return {
      channel, targetChannel: "web", language: "es", voiceMode: false, step: "language",
      turns: [], history: [], collected: {}, confirmed: {},
      identityValidated: false, unclearCount: 0, currentOptions: [],
      facialModuleOpen: false,
    };
  }

  // ---------- Helpers ----------
  const id = () => Math.random().toString(36).slice(2, 10);
  const now = () => (window.NawiClock ? window.NawiClock() : 0);

  function optionsBlock(opts) { return opts.map((o, i) => (i + 1) + ". " + o.label + ".").join(" "); }

  function buildSpokenPrompt(channel, body, opts, cueKind, lang) {
    cueKind = cueKind || "options"; lang = lang || "es";
    if (opts.length === 0) {
      return channel === "web" ? body + " " + speakingCue(channel, "say", lang) : body;
    }
    const optionsTitle = t(lang, "Opciones disponibles:", "Akllanapaq kaykunam kachkan:");
    return [body, optionsTitle + " " + optionsBlock(opts), speakingCue(channel, cueKind, lang)].join(" ");
  }

  function valueOrFallback(value, fallback) {
    fallback = fallback || "no registrado";
    return value && value.trim().length > 0 ? value : fallback;
  }

  function fileNumberForVoice(fileNumber, lang) {
    return fileNumber.split("-").map((part) => {
      if (/^\d+$/.test(part)) return digitByDigit(part, lang);
      if (/^[a-zA-Z]+$/.test(part)) return part.toUpperCase().split("").join(" ");
      return part;
    }).join(" guion ");
  }

  function procedureRequirementsSpoken(p, lang) {
    const procedureName = getProcedureName(p, lang);
    const requirements = getProcedureRequirements(p, lang)
      .map((req, i) => t(lang, "Requisito " + (i + 1) + ": " + req + ".", "Munasqa " + (i + 1) + ": " + req + "."))
      .join(" ");
    return [
      t(lang, "Datos del trámite " + procedureName + ".", procedureName + " ruraypa willakuynin."),
      requirements,
      t(lang, "Costo: " + getProcedureCost(p, lang) + ".", "Chanin: " + getProcedureCost(p, lang) + "."),
      t(lang, "Plazo: " + getProcedureEstimate(p, lang) + ".", "Pacha: " + getProcedureEstimate(p, lang) + "."),
      t(lang, "Oficina responsable: " + getProcedureOffice(p, lang) + ".", "Kamachiq oficina: " + getProcedureOffice(p, lang) + "."),
      t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna."),
    ].join(" ");
  }

  function finalSummarySpoken(data, p, lang) {
    const procedureName = getProcedureName(p, lang);
    return [
      t(lang, "Resumen antes de enviar.", "Manaraq apachispa pisiyachisqa willakuy."),
      t(lang, "Nombre: " + valueOrFallback(data.fullName) + ".", "Suti: " + valueOrFallback(data.fullName) + "."),
      t(lang, "DNI: " + (data.dni ? digitByDigit(data.dni, lang) : "no registrado") + ".", "DNI: " + (data.dni ? digitByDigit(data.dni, lang) : "mana qillqasqa") + "."),
      t(lang, "Trámite: " + procedureName + ".", "Ruray: " + procedureName + "."),
      t(lang, "Motivo: " + valueOrFallback(data.motivo, "sin motivo específico") + ".", "Imarayku: " + valueOrFallback(data.motivo, "mana sut'i imaraykuyuq") + "."),
      t(lang, "Adjunto: " + valueOrFallback(data.attachment, "sin adjunto") + ".", "Yapasqa qillqa: " + valueOrFallback(data.attachment, "mana yapasqa qillqayuq") + "."),
      t(lang, "Identidad: validada para esta demo.", "Identidad: kay demopaq chiqaqchasqa."),
      t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna."),
    ].join(" ");
  }

  function receiptSpoken(fileNumber, p, data, lang) {
    const procedureName = getProcedureName(p, lang);
    return [
      t(lang, "Constancia simulada generada.", "Demo constancia ruwasqañam."),
      t(lang, "Número de expediente: " + fileNumberForVoice(fileNumber, lang) + ".", "Expediente yupay: " + fileNumberForVoice(fileNumber, lang) + "."),
      t(lang, "Trámite: " + procedureName + ".", "Ruray: " + procedureName + "."),
      t(lang, "A nombre de: " + valueOrFallback(data.fullName) + ".", "Sutipi: " + valueOrFallback(data.fullName) + "."),
      t(lang, "DNI: " + (data.dni ? digitByDigit(data.dni, lang) : "no registrado") + ".", "DNI: " + (data.dni ? digitByDigit(data.dni, lang) : "mana qillqasqa") + "."),
      t(lang, "Oficina: " + getProcedureOffice(p, lang) + ".", "Oficina: " + getProcedureOffice(p, lang) + "."),
      t(lang, "Plazo estimado: " + getProcedureEstimate(p, lang) + ".", "Unay pacha: " + getProcedureEstimate(p, lang) + "."),
      t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna."),
    ].join(" ");
  }

  function fileStatusSpoken(file, lang) {
    return [
      t(lang, "Detalle del expediente.", "Expedientepa sut'inchaynin."),
      t(lang, "Número de expediente: " + fileNumberForVoice(file.number, lang) + ".", "Expediente yupay: " + fileNumberForVoice(file.number, lang) + "."),
      t(lang, "Trámite: " + getFileProcedureName(file, lang) + ".", "Ruray: " + getFileProcedureName(file, lang) + "."),
      t(lang, "Estado actual: " + getFileStatus(file, lang) + ".", "Kunan kaynin: " + getFileStatus(file, lang) + "."),
      t(lang, "Fecha de ingreso: " + getFileDate(file, lang) + ".", "Yaykusqan p'unchay: " + getFileDate(file, lang) + "."),
      t(lang, "Oficina actual: " + getFileOffice(file, lang) + ".", "Kunan oficina: " + getFileOffice(file, lang) + "."),
      t(lang, "Último movimiento: " + getFileLastMovement(file, lang) + ".", "Qhipa kuyuy: " + getFileLastMovement(file, lang) + "."),
      getFileObservation(file, lang) ? t(lang, "Observación: " + getFileObservation(file, lang) + ".", "Qhawarisqa: " + getFileObservation(file, lang) + ".") : "",
      t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna."),
    ].filter(Boolean).join(" ");
  }

  function fileListSpoken(files, lang) {
    if (files.length === 0) {
      return t(lang, "No se encontraron trámites vinculados. Datos simulados para demostración.", "Manam watasqa ruraykunata tarirqanichu. Demo hinalla willakuykuna.");
    }
    const items = files.map((file, i) => t(
      lang,
      "Trámite " + (i + 1) + ". Expediente " + fileNumberForVoice(file.number, lang) + ". " + getFileProcedureName(file, lang) + ". Estado: " + getFileStatus(file, lang) + ".",
      "Ruray " + (i + 1) + ". Expediente " + fileNumberForVoice(file.number, lang) + ". " + getFileProcedureName(file, lang) + ". Kaynin: " + getFileStatus(file, lang) + ".",
    )).join(" ");
    return [t(lang, "Tus trámites vinculados.", "Qampa watasqa ruraynikikuna."), items, t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna.")].join(" ");
  }

  function notificationSpoken(file, lang) {
    return [
      t(lang, "Novedad simulada.", "Demo musuq willakuy."),
      t(lang, "Expediente: " + fileNumberForVoice(file.number, lang) + ".", "Expediente: " + fileNumberForVoice(file.number, lang) + "."),
      t(lang, "Trámite: " + getFileProcedureName(file, lang) + ".", "Ruray: " + getFileProcedureName(file, lang) + "."),
      t(lang, "Estado actual: " + getFileStatus(file, lang) + ".", "Kunan kaynin: " + getFileStatus(file, lang) + "."),
      t(lang, "Oficina actual: " + getFileOffice(file, lang) + ".", "Kunan oficina: " + getFileOffice(file, lang) + "."),
      t(lang, "Último movimiento: " + getFileLastMovement(file, lang) + ".", "Qhipa kuyuy: " + getFileLastMovement(file, lang) + "."),
      getFileObservation(file, lang) ? t(lang, "Observación: " + getFileObservation(file, lang) + ".", "Qhawarisqa: " + getFileObservation(file, lang) + ".") : "",
      t(lang, "Datos simulados para demostración.", "Demo hinalla willakuykuna."),
    ].filter(Boolean).join(" ");
  }

  function inlineCardToSpoken(card, lang) {
    switch (card.kind) {
      case "requirements": return procedureRequirementsSpoken(card.procedure, lang);
      case "summary": return finalSummarySpoken(card.data, card.proc, lang);
      case "receipt": return receiptSpoken(card.fileNumber, card.proc, card.data, lang);
      case "file-status": return fileStatusSpoken(card.file, lang);
      case "file-list": return fileListSpoken(card.files, lang);
      case "notification": return notificationSpoken(card.file, lang);
      default: return "";
    }
  }

  function nawi(state, text, options, extras) {
    extras = extras || {};
    const customSpoken = extras.spoken;
    const restExtras = Object.assign({}, extras);
    delete restExtras.spoken;
    const cardSpoken = restExtras.card ? inlineCardToSpoken(restExtras.card, state.language) : "";
    const fullSpokenText = [text, cardSpoken].filter((p) => p.trim().length > 0).join(" ");
    return Object.assign({
      id: id(), from: "nawi", text,
      spoken: customSpoken != null ? customSpoken : buildSpokenPrompt(state.channel, fullSpokenText, options, "options", state.language),
      options, at: now(),
    }, restExtras);
  }

  // ---------- Step builders ----------
  const STEP_BUILDERS = {
    language: (s) => nawi(s,
      "Hola, soy Ñawi, tu asistente del Gobierno Regional de Cusco. Rimaykullayki, ñoqam kani Ñawi.\n¿En qué idioma prefieres continuar? ¿Ima simipitak rimanki munawaq?",
      [
        { id: "es", label: "Español", synonyms: ["espanol", "español", "castellano", "opcion uno", "opción uno", "uno"], tone: "primary" },
        { id: "qu", label: "Quechua / Runa Simi", synonyms: ["quechua", "runa simi", "runasimi", "runa", "opcion dos", "opción dos", "dos"] },
      ]),

    welcome: (s) => nawi(s,
      ts(s, "¿Cómo prefieres usar Ñawi?",
        "¿Imaynatam Ñawita llamk'achiyta munanki?"),
      [
        { id: "voice", label: ts(s, "Ñawi habla automáticamente", "Ñawi kikinmanta rimanqa"), synonyms: ["voz", "con voz", "automatico", "automático", "habla", "microfono", "micrófono", "rimay", "opcion uno", "opción uno", "uno"], tone: "primary" },
        { id: "novoice", label: ts(s, "Yo elijo cuándo escuchar", "Ñuqa akllani hayk'aq uyariyta"), synonyms: ["sin voz", "manual", "yo elijo", "sin guia", "sin guía", "mana rimay", "opcion dos", "opción dos", "dos"] },
      ]),

    "whatsapp-handoff": (s) => nawi(s,
      ts(s, "Perfecto. Vas a continuar con Ñawi por WhatsApp. Toca el botón para abrir el chat: tus preferencias de idioma y audio ya van incluidas, y allí validaremos tu identidad para iniciar tu trámite.",
        "Allinmi. Ñawiwan WhatsApp nisqapi qatinki. Botón ñit'iy chatta kichanaykipaq: simiyki hinaspa audio akllasqaykiqa chaypiñam, hinaspa chaypi identidadniykita chiqaqchasun."),
      [
        { id: "back", label: ts(s, "Volver", "Kutiy") },
      ],
      { whatsappHandoff: { language: s.language, voiceMode: s.voiceMode } }),

    menu: (s) => nawi(s,
      ts(s, "Hola, soy Ñawi, tu asistente del Gobierno Regional de Cusco. ¿Qué deseas hacer hoy?", "Allin hamusqayki. Ñawi kani, Gobierno Regional de Cusco yanapaq. Kunan imata ruwanayta munanki?"),
      [
        { id: "req", label: ts(s, "Consultar requisitos", "Munasqakunata tapuy"), synonyms: ["requisitos", "munasqakuna"] },
        { id: "start", label: ts(s, "Iniciar trámite", "Rurayta qallariy"), synonyms: ["iniciar", "qallariy"] },
        { id: "status", label: ts(s, "Ver estado de mi trámite", "Rurayniypa kayninta qhaway"), synonyms: ["estado", "ver estado", "kaynin", "qhaway"] },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay"), synonyms: ["persona", "humano", "runa"] },
      ]),

    // Lista directa de trámites: al elegir "Consultar requisitos" mostramos de una vez todos
    // los trámites disponibles para que el ciudadano elija uno y vea sus requisitos.
    "req-list": (s) => nawi(s,
      ts(s, "Estos son los trámites sobre los que te puedo dar los requisitos. Elige uno para ver qué necesitas.",
        "Kaykunamantam munasqakunata niykiman. Hukninta akllay, imata munasqaykita qhawanaykipaq."),
      PROCEDURES.map((p) => ({ id: p.id, label: getProcedureName(p, s.language), synonyms: (p.synonyms || []).concat([p.name.toLowerCase()]) }))
        .concat([
          { id: "describe", label: ts(s, "No está en la lista / describirlo", "Manam listapichu / willaykuy"), synonyms: ["no esta", "otro", "describir"] },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        ])),

    "req-ask": (s) => nawi(s,
      ts(s, "Dime qué necesitas hacer, aunque no sepas el nombre exacto del trámite. Por ejemplo: necesito una constancia, quiero presentar un documento, o quiero hacer una solicitud.",
        "Imata ruwanayta munasqaykita niway, ruraypa sutinta mana yachaspa hinapas. Kay hina niwaq: constanciata munani, qillqata haywayta munani, utaq solicitudta ruwani."),
      [
        { id: "no-se", label: ts(s, "No sé el nombre del trámite", "Ruraypa sutinta manam yachanichu"), synonyms: ["no se", "mana yachanichu"] },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
      ]),

    "req-category": (s) => nawi(s,
      ts(s, "No hay problema. Te ayudaré a encontrarlo. ¿Cuál se parece más a lo que necesitas?",
        "Ama llakikuychu. Tarinaykipaq yanapasqayki. Kaykunamanta mayqinqa aswan rikch'akun?"),
      [
        { id: "constancia", label: ts(s, "Necesito una constancia", "Constanciata munani") },
        { id: "documento", label: ts(s, "Quiero presentar un documento", "Qillqata haywayta munani") },
        { id: "expediente", label: ts(s, "Quiero consultar un expediente", "Expedienteta tapuyta munani") },
        { id: "solicitud", label: ts(s, "Quiero hacer una solicitud general", "Solicitud generalta ruwani") },
        { id: "ninguna", label: ts(s, "Ninguna de estas", "Manam kaykunachu") },
      ]),

    "req-suggest": (s) => {
      const cat = s.collected.category;
      const matches = cat ? PROCEDURES.filter((p) => p.category === cat) : PROCEDURES;
      return nawi(s,
        ts(s, "Encontré estas opciones parecidas. Elige una para ver los requisitos.",
          "Kay rikch'aq ruraykunata tarirqani. Hukninta akllay, munasqakunata qhawanaykipaq."),
        matches.map((p) => ({ id: p.id, label: getProcedureName(p, s.language), synonyms: (p.synonyms || []).concat([p.name.toLowerCase()]) }))
          .concat([{ id: "ninguna", label: ts(s, "Ninguna de estas", "Manam kaykunachu") }]));
    },

    "req-confirm-proc": (s) => {
      const p = PROCEDURES.find((x) => x.id === s.collected.procedureId);
      const procedureName = getProcedureName(p, s.language);
      return nawi(s,
        ts(s, "Entendí que quieres consultar: " + procedureName + ". ¿Es correcto?", "Kayta tapuyta munanki nispa hamut'arqani: " + procedureName + ". Chaychu?"),
        [
          { id: "yes", label: ts(s, "Sí, ver requisitos", "Arí, munasqakunata qhaway"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
          { id: "other", label: ts(s, "No, elegir otro trámite", "Mana, huk rurayta akllay"), synonyms: ["no", "mana"] },
          { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        ]);
    },

    "req-result": (s) => {
      const p = PROCEDURES.find((x) => x.id === s.collected.procedureId);
      const procedureName = getProcedureName(p, s.language);
      return nawi(s,
        ts(s, "Esta es información referencial de demostración sobre el trámite: " + procedureName + ". Es pública y no requiere validar identidad. ¿Qué quieres hacer ahora?",
          "Kayqa demostracion willakuymi kay ruraymanta: " + procedureName + ". Llaqta willakuymi, identidadta chiqaqchayta mana munanchu. Kunan imata ruwanayta munanki?"),
        [
          { id: "other", label: ts(s, "Consultar otro trámite", "Huk rurayta tapuy"), tone: "primary" },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
          { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
        ],
        { card: { kind: "requirements", procedure: p }, simulatedNote: true });
    },

    "start-explain": (s) => nawi(s,
      ts(s, "Para iniciar un trámite a tu nombre, primero debo proteger tus datos y validar tu identidad. Te guiaré paso a paso.",
        "Sutiykipi rurayta qallarinapaq, ñawpaqta willakuykikunata waqaychanaymi, hinaspa identidadniykita chiqaqchanaymi. Sapa kutillata yanapasqayki."),
      [
        { id: "ok", label: ts(s, "Continuar", "Qatiy"), synonyms: ["continuar", "continúa", "continua", "sigue", "siguiente", "adelante", "qatiy"], tone: "primary" },
        { id: "back", label: ts(s, "Volver al menú", "Menuman kutiy") },
      ]),

    privacy: (s) => nawi(s,
      ts(s, "Antes de empezar, validaré tu identidad para atenderte de forma segura. Usaré tu nombre y tu DNI, solo para esta atención. ¿Aceptas continuar?",
        "Manaraq qallarispa, identidadniykita chiqaqchasaq waqaychasqa atinaypaq. Sutiykita DNIykitawan llamk'achisaq, kay atencionllapaq. Qatiyta chaskinkichu?"),
      [
        { id: "accept", label: ts(s, "Sí, acepto", "Arí, chaskini"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "reject", label: ts(s, "No acepto", "Mana chaskinichu"), synonyms: ["no", "mana"], tone: "danger" },
        { id: "repeat", label: ts(s, "Repetir aviso", "Willakuyta hukmanta niy") },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
      ]),

    "ask-name": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "Dime tus nombres y apellidos completos.", "Hunt'a sutiykita, tayta mamaykipa sutiyuq ima, niway."),
      spoken: s.language === "qu"
        ? "Hunt'a sutiykita, tayta mamaykipa sutiyuq ima, niway. Rimayta, qillqayta utaq teclado llamk'achiyta atinki. Kunan rimayta atinki."
        : "Dime tus nombres y apellidos completos. Puedes hablar, escribir o usar el teclado. Ahora puedes hablar.",
      options: [
        { id: "demo", label: ts(s, "Usar dato demo: " + DEMO_CITIZEN.fullName, "Demo willakuyta llamk'achiy: " + DEMO_CITIZEN.fullName) },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ],
      at: now(),
    }),

    "confirm-name": (s) => nawi(s,
      ts(s, "Entendí: " + s.collected.fullName + ". ¿Es correcto?", "Kayta hamut'arqani: " + s.collected.fullName + ". Allinchu?"),
      [
        { id: "yes", label: ts(s, "Sí, es correcto", "Arí, allinmi"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "no", label: ts(s, "No, corregir nombre", "Mana, sutita allinchay"), synonyms: ["no", "mana"] },
        { id: "repeat", label: ts(s, "Repetir dato", "Willakuyta hukmanta niy") },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ]),

    "ask-dni": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "Ahora dime tu DNI de ocho dígitos.", "Kunan pusaq yupayniyuq DNIykita niway."),
      spoken: s.language === "qu"
        ? "Kunan pusaq yupayniyuq DNIykita niway. Kunan rimayta atinki."
        : "Ahora dime tu DNI de ocho dígitos. Ahora puedes hablar.",
      options: [
        { id: "demo", label: ts(s, "Usar DNI demo: " + DEMO_CITIZEN.dni, "Demo DNI-ta llamk'achiy: " + DEMO_CITIZEN.dni) },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ],
      at: now(),
    }),

    "confirm-dni": (s) => nawi(s,
      ts(s, "Entendí el DNI: " + s.collected.dni + ". Te lo repito dígito por dígito: " + digitByDigit(s.collected.dni || "", s.language) + ". ¿Es correcto?",
        "DNIykita hamut'arqani: " + s.collected.dni + ". Huk yupaymanta huk yupaykama kutichisqayki: " + digitByDigit(s.collected.dni || "", s.language) + ". Allinchu?"),
      [
        { id: "yes", label: ts(s, "Sí, es correcto", "Arí, allinmi"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "no", label: ts(s, "No, corregir DNI", "Mana, DNI-ta allinchay"), synonyms: ["no", "mana"] },
        { id: "repeat", label: ts(s, "Repetir DNI", "DNI-ta hukmanta niy") },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ]),

    "identity-summary": (s) => nawi(s,
      ts(s, "Entonces, la atención quedará vinculada a: " + s.collected.fullName + ", con DNI " + s.collected.dni + ". Para proteger tus datos, ahora validaremos tu identidad con la cámara. ¿Deseas continuar?",
        "Chaynaqa kay atencionqa kay runaman watasqa kanqa: " + s.collected.fullName + ", DNI " + s.collected.dni + ". Willakuykikunata waqaychanapaq, kunan identidadniykita camarawan chiqaqchasun. Qatiyta munankichu?"),
      [
        { id: "yes", label: ts(s, "Sí, validar identidad", "Arí, identidadta chiqaqchay"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "fix-name", label: ts(s, "Corregir nombre", "Sutita allinchay") },
        { id: "fix-dni", label: ts(s, "Corregir DNI", "DNI-ta allinchay") },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ]),

    "facial-consent": (s) => nawi(s,
      ts(s, "Validación de identidad. En el sistema final, Ñawi comparará tu rostro con la base biométrica de RENIEC, con tu consentimiento previo y cumpliendo la Ley 29733 de protección de datos personales, para confirmar que eres tú quien hace el trámite. En esta demostración, esa verificación con RENIEC está representada como una maqueta: no se compara tu rostro con ninguna base oficial ni se guardan imágenes ni datos biométricos. ¿Aceptas continuar?",
        "Identidad chiqaqchay. Tukukuq sistemapiqa Ñawiqa uyaykita RENIEC nisqapa base biométrica nisqanwan tupachinqa, ñawpaqta qan chaskichkaptiyki, hinaspa Ley 29733 willakuy waqaychay kamachikuyta hunt'aspa, qanpuni rurayta ruwachkasqaykita chiqaqchanapaq. Kay demostracionpiqa chay RENIEC chiqaqchayqa maqueta hinallam: manam uyaykita mayqin base oficial nisqawanpas tupachinchu, nitaq rikch'aykunata utaq datos biométricos nisqata waqaychanchu. Qatiyta chaskinkichu?"),
      [
        { id: "yes", label: ts(s, "Sí, validar identidad", "Arí, identidadta chiqaqchay"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "nocam", label: ts(s, "No puedo usar cámara", "Manam camarata llamk'achiyta atinichu") },
        { id: "no", label: ts(s, "No acepto", "Mana chaskinichu"), synonyms: ["no", "mana"], tone: "danger" },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
      ]),

    "facial-module": (s) => nawi(s, ts(s, "Abriendo módulo de validación facial simulado…", "Demo hina uya chiqaqchay módulo kichakuchkan..."), []),

    "facial-result": (s) => nawi(s, ts(s, "Identidad validada para esta demo.", "Identidadniyki kay demopaq chiqaqchasqañam."),
      [{ id: "continue", label: ts(s, "Continuar", "Qatiy"), synonyms: ["continuar", "continúa", "continua", "sigue", "siguiente", "adelante", "qatiy"], tone: "primary" }]),

    "facial-result-fail": (s) => nawi(s,
      ts(s, "No se pudo validar tu identidad en esta demo. Puedes reintentar, usar otro método o hablar con una persona.",
        "Kay demopi identidadniykita mana chiqaqchayta atirqanichu. Hukmanta rurayta, huk ñanta llamk'achiyta, utaq runawan rimayta atinki."),
      [
        { id: "retry", label: ts(s, "Reintentar validación", "Hukmanta chiqaqchay"), tone: "primary" },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]),

    "facial-cancelled": (s) => nawi(s,
      ts(s, "Validación cancelada. No se mostró ni envió información personal.", "Chiqaqchayqa saqisqam. Manam willakuy personal rikuchisqachu nitaq apachisqachu."),
      [
        { id: "retry", label: ts(s, "Reintentar validación", "Hukmanta chiqaqchay"), tone: "primary" },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]),

    "post-validation": (s) => {
      if (s.flowOrigin === "status") {
        return nawi(s,
          ts(s, "Identidad validada para esta demo. Buscaré trámites vinculados a " + s.confirmed.fullName + ", DNI " + s.confirmed.dni + ". ¿Tienes tu número de expediente?",
            "Identidadniyki kay demopaq chiqaqchasqañam. " + s.confirmed.fullName + ", DNI " + s.confirmed.dni + ", payman watasqa ruraykunata maskasaq. Expediente yupayniyki kanchu?"),
          [
            { id: "have", label: ts(s, "Sí, dictar expediente", "Arí, expediente yupayta niy") },
            { id: "no-have", label: ts(s, "No lo tengo, buscar mis trámites vinculados", "Manam kanchu, rurayniykunata maskay") },
            { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
            { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
          ]);
      }
      const pid = s.collected.procedureId;
      if (pid) {
        const p = PROCEDURES.find((x) => x.id === pid);
        const procedureName = getProcedureName(p, s.language);
        return nawi(s,
          ts(s, "Identidad validada para esta demo. Continuaremos con: " + procedureName + ", a nombre de " + s.confirmed.fullName + ", DNI " + s.confirmed.dni + ". ¿Es correcto?",
            "Identidadniyki kay demopaq chiqaqchasqañam. Kay ruraywan qatisun: " + procedureName + ", " + s.confirmed.fullName + " sutipi, DNI " + s.confirmed.dni + ". Allinchu?"),
          [
            { id: "yes", label: ts(s, "Sí, continuar", "Arí, qatiy"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
            { id: "other", label: ts(s, "No, elegir otro trámite", "Mana, huk rurayta akllay") },
            { id: "reqs", label: ts(s, "Consultar requisitos primero", "Ñawpaqta munasqakunata tapuy") },
            { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
          ]);
      }
      return nawi(s, ts(s, "¿Qué trámite quieres iniciar?", "Ima rurayta qallariyta munanki?"),
        PROCEDURES.map((p) => ({ id: p.id, label: getProcedureName(p, s.language), synonyms: (p.synonyms || []).concat([p.name.toLowerCase()]) }))
          .concat([{ id: "no-se", label: ts(s, "No sé cuál necesito", "Mayqinta munasqayta manam yachanichu") }]));
    },

    "choose-procedure": (s) => nawi(s, ts(s, "¿Qué trámite quieres iniciar?", "Ima rurayta qallariyta munanki?"),
      PROCEDURES.map((p) => ({ id: p.id, label: getProcedureName(p, s.language), synonyms: (p.synonyms || []).concat([p.name.toLowerCase()]) }))
        .concat([{ id: "no-se", label: ts(s, "No sé cuál necesito", "Mayqinta munasqayta manam yachanichu") }])),

    "show-requirements": (s) => {
      const p = PROCEDURES.find((x) => x.id === s.collected.procedureId);
      const procedureName = getProcedureName(p, s.language);
      return nawi(s,
        ts(s, "Antes de iniciar, estos son los requisitos de " + procedureName + ". ¿Quieres continuar con este trámite?",
          procedureName + " rurayta qallarinapaq kay munasqakunam kachkan. Kay ruraywan qatiyta munankichu?"),
        [
          { id: "yes", label: ts(s, "Sí, continuar", "Arí, qatiy"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
          { id: "other", label: ts(s, "Consultar otro trámite", "Huk rurayta tapuy") },
          { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
          { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
        ],
        { card: { kind: "requirements", procedure: p } });
    },

    "ask-motivo": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "Cuéntame el asunto o motivo de tu solicitud. Este dato es obligatorio.", "Mañakuyki imarayku kasqanta willaway. Kay willakuyqa kananpunim."),
      spoken: s.language === "qu"
        ? "Mañakuyki imarayku kasqanta willaway. Kunan rimayta atinki."
        : "Cuéntame el asunto o motivo de tu solicitud. Ahora puedes hablar.",
      options: [{ id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" }],
      at: now(),
    }),

    "ask-attachment": (s) => nawi(s,
      ts(s, "¿Deseas adjuntar un documento simulado a este trámite?", "Kay rurayman huk demo qillqata yapayta munankichu?"),
      [
        { id: "yes", label: ts(s, "Sí, adjuntar (simulado)", "Arí, qillqata yapay demo hina"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "no", label: ts(s, "No adjuntar", "Ama qillqata yapaychu"), synonyms: ["no", "mana"] },
      ]),

    "ask-celular": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "¿Cuál es tu número de celular para contacto?", "¿Ima celular yupayniyuq kanki willanapaq?"),
      spoken: s.language === "qu" ? "¿Ima celular yupayniyuq kanki? Kunan rimayta atinki." : "¿Cuál es tu número de celular para contacto? Ahora puedes hablar.",
      options: [{ id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" }],
      at: now(),
    }),

    "ask-correo": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "¿Cuál es tu correo electrónico? Ahí llegará tu número de expediente.", "¿Ima correo electrónico kanki? Chayman expediente yupayniyki chayanqa."),
      spoken: s.language === "qu" ? "¿Ima correo electrónico kanki? Kunan rimayta atinki." : "¿Cuál es tu correo electrónico? Ahí llegará tu número de expediente. Ahora puedes hablar.",
      options: [{ id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" }],
      at: now(),
    }),

    "ask-adjunto": (s) => nawi(s,
      ts(s, "¿Quieres adjuntar tu documento en PDF? Súbelo aquí, o usa el documento que Ñawi genera por ti.",
        "Qillqaykita PDF hina yapayta munankichu? Kaypi sapiy, utaq Ñawi ruwasqa qillqata llamk'achiy."),
      [
        { id: "demo", label: ts(s, "Usar documento de Ñawi", "Ñawipa qillqanta llamk'achiy"), tone: "primary" },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ],
      { attachUpload: true }),

    "tramite-dep": (s) => nawi(s,
      ts(s, "Vamos a iniciar tu trámite. ¿A qué dependencia va dirigido? Puedes decirlo por voz, escribirlo (por ejemplo: Agricultura, Salud, Educación) o elegir de la lista.",
        "Rurayniykita qallarisun. ¿Maypaqmi? Rimaspa, qillqaspa utaq listamanta akllaspa niway."),
      (D.DEPENDENCIAS || []).map((d) => ({ id: String(d.iddependencia), label: d.nombre, synonyms: [(d.abrev || "").toLowerCase(), (d.nombre.split(" - ")[1] || "").toLowerCase()] }))
        .concat([{ id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") }])),

    "tramite-tipodoc": (s) => nawi(s,
      ts(s, "¿Qué tipo de documento vas a presentar? Si lo sabes, dímelo por voz o escríbelo (por ejemplo: solicitud, carta, informe). Si no, elige uno de la lista.",
        "¿Ima laya qillqatam haywanki? Yachaspaqa rimay utaq qillqay (solicitud, carta, informe). Mana yachaspaqa listamanta akllay."),
      (D.TIPOS_DOC_COMUNES || []).map((t) => ({ id: t.nombre, label: t.nombre, synonyms: t.synonyms || [] }))
        .concat([{ id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") }])),

    "final-summary": (s) => {
      const sendOpts = [
        { id: "send", label: ts(s, "Sí, enviar", "Arí, apachiy"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "fix", label: ts(s, "Corregir un dato", "Huk willakuyta allinchay") },
        { id: "repeat", label: ts(s, "Repetir resumen", "Pisiyachisqa willakuyta hukmanta niy") },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ];
      // Trámite por formulario real (dependencia + tipo de documento): resumen en texto.
      if (s.collected.iddependencia) {
        const c = s.collected;
        const asunto = (s.confirmed.motivo && s.confirmed.motivo !== "—") ? s.confirmed.motivo : "—";
        const resumen = "Antes de enviar, reviso tus datos. Nombre: " + (s.confirmed.fullName || c.fullName || "—")
          + ". Dependencia: " + (c.dependencia_nombre || "—")
          + ". Tipo de documento: " + (c.tipodoc_nombre || "SOLICITUD")
          + ". Asunto: " + asunto
          + ". Celular: " + (c.celular || "—")
          + ". Correo: " + (c.correo || "—")
          + ". ¿Está todo correcto?";
        return nawi(s, ts(s, resumen, resumen), sendOpts, { simulatedNote: true });
      }
      const p = PROCEDURES.find((x) => x.id === s.collected.procedureId);
      return nawi(s,
        ts(s, "Antes de enviar, voy a revisar tus datos. ¿Está todo correcto?", "Manaraq apachispa, willakuykikunata qhawasaq. Llapan allinchu?"),
        sendOpts,
        { card: { kind: "summary", data: s.confirmed, proc: p }, simulatedNote: true });
    },

    submitted: (s) => {
      const p = PROCEDURES.find((x) => x.id === s.collected.procedureId);
      const dni = s.confirmed.dni || s.collected.dni;
      // En web emitimos el trámite REAL en QELLQA: el widget lee el marcador realTramite,
      // llama al backend y muestra el número de expediente real que devuelve el GORE.
      if (s.channel === "web" && dni && s.collected.iddependencia) {
        const idd = s.collected.iddependencia;
        const asunto = (s.confirmed.motivo && s.confirmed.motivo !== "—") ? s.confirmed.motivo : (s.collected.tipodoc_nombre || "Solicitud");
        const realTramite = {
          dni: dni, iddependencia: idd, dependencia_nombre: s.collected.dependencia_nombre || depNombre(idd),
          tipodoc_nombre: s.collected.tipodoc_nombre || "SOLICITUD",
          asunto: asunto, nrofolios: 1,
          celular: s.collected.celular || "", correo: s.collected.correo || "",
        };
        return nawi(s,
          ts(s, "Voy a registrar tu trámite en el sistema del Gobierno Regional de Cusco. En un momento te doy tu número de expediente real.",
            "Rurayniykita Gobierno Regional de Cusco sistemapi churasaq. Pisi pachallapi chiqaq expediente yupayniykita qusqayki."),
          [
            { id: "status-real", label: ts(s, "Consultar estado del expediente", "Expedientepa kayninta tapuy"), tone: "primary" },
            { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
            { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
          ],
          { realTramite: realTramite });
      }
      const fileNumber = "EXP-2026-0089";
      return nawi(s,
        ts(s, "Listo. Tu solicitud fue registrada en esta demo. Tu número de expediente simulado es: " + fileNumber + ". Guarda este número para consultar el estado de tu trámite.",
          "Listo. Mañakuyki kay demopi registrasqañam. Expediente yupay simuladoqa " + fileNumberForVoice(fileNumber, s.language) + ". Kay yupayta waqaychay, rurayniykipa kayninta tapunaykipaq."),
        [
          { id: "status", label: ts(s, "Ver estado ahora", "Kunan kayninta qhaway"), tone: "primary" },
          { id: "copy", label: ts(s, "Copiar número de expediente", "Expediente yupayta copiay") },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
          { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
        ],
        { card: { kind: "receipt", fileNumber: fileNumber, proc: p, data: s.confirmed }, simulatedNote: true });
    },

    "status-explain": (s) => nawi(s,
      ts(s, "Para mostrar el estado de un trámite necesito validar tu identidad, porque esta información puede ser personal.",
        "Huk ruraypa kayninta rikuchinaypaq identidadniykita chiqaqchanaymi, kay willakuyqa personal kanman."),
      [
        { id: "ok", label: ts(s, "Continuar", "Qatiy"), synonyms: ["continuar", "continúa", "continua", "sigue", "siguiente", "adelante", "qatiy"], tone: "primary" },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
      ]),

    "status-have-file": (s) => nawi(s, ts(s, "¿Tienes tu número de expediente?", "Expediente yupayniyki kanchu?"),
      [
        { id: "have", label: ts(s, "Sí, dictar expediente", "Arí, expediente yupayta niy") },
        { id: "no-have", label: ts(s, "No lo tengo, buscar mis trámites", "Manam kanchu, rurayniykunata maskay") },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]),

    // --- Estado REAL (sistema QELLQA del GORE): pide expediente + dependencia + año. ---
    "status-real-exp": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "Consultaré el estado real de tu expediente en el sistema del GORE Cusco. Dime el número de tu expediente, solo los dígitos.",
        "Rurayniykipa chiqaq kayninta GORE Cusco sistemapi qhawasaq. Expediente yupayniykita niway, yupaykunallata."),
      spoken: s.language === "qu"
        ? "Expediente yupayniykita niway, yupaykunallata. Kunan rimayta atinki."
        : "Dime el número de tu expediente, solo los dígitos. Ahora puedes hablar.",
      options: [{ id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") }],
      at: now(),
    }),

    "status-real-dep": (s) => nawi(s,
      ts(s, "¿En qué dependencia presentaste tu trámite? Elige una.", "¿Maypi rurayniykita churarqanki? Hukninta akllay."),
      (D.DEPENDENCIAS || []).map((d) => ({ id: String(d.iddependencia), label: d.nombre, synonyms: [(d.abrev || "").toLowerCase()] }))
        .concat([{ id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") }])),

    "status-real-anio": (s) => nawi(s,
      ts(s, "¿De qué año es el expediente?", "¿Ima watamantam expediente?"),
      [
        { id: "2026", label: ts(s, "Es de 2026", "2026 watamanta"), synonyms: ["2026"], tone: "primary" },
        { id: "2025", label: ts(s, "Es de 2025", "2025 watamanta"), synonyms: ["2025"] },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
      ]),

    "status-real-result": (s) => nawi(s,
      ts(s, "Estoy consultando el estado real de tu expediente en el sistema del GORE Cusco…",
        "Rurayniykipa chiqaq kayninta GORE Cusco sistemapi qhawachkani…"),
      [
        { id: "status-real", label: ts(s, "Consultar otro expediente", "Huk expedienteta tapuy"), tone: "primary" },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ],
      { realStatus: { nro: s.collected.estadoNro, dep: s.collected.estadoDep, anio: s.collected.estadoAnio } }),

    "status-ask-file": (s) => ({
      id: id(), from: "nawi",
      text: ts(s, "Dime tu número de expediente. Formato: EXP guión cuatro dígitos guión año.", "Expediente yupayniykita niway. Formato: EXP guion tawa yupay guion wata."),
      spoken: s.language === "qu"
        ? "Expediente yupayniykita niway. Kunan rimayta atinki."
        : "Dime tu número de expediente. Ahora puedes hablar.",
      options: [
        { id: "demo", label: ts(s, "Usar EXP-2026-0089 (demo)", "EXP-2026-0089 llamk'achiy demo") },
        { id: "demo2", label: ts(s, "Usar EXP-2026-9999 (no vinculado)", "EXP-2026-9999 llamk'achiy mana watasqa") },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
      ],
      at: now(),
    }),

    "status-confirm-file": (s) => nawi(s,
      ts(s, "Entendí el expediente: " + s.collected.fileNumber + ". ¿Es correcto?", "Kay expediente yupayta hamut'arqani: " + s.collected.fileNumber + ". Allinchu?"),
      [
        { id: "yes", label: ts(s, "Sí, consultar ese expediente", "Arí, kay expedienteta tapuy"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "no", label: ts(s, "No, corregir expediente", "Mana, expedienteta allinchay"), synonyms: ["no", "mana"] },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
      ]),

    "status-show": (s) => {
      const f = SIM_FILES.find((x) => x.number === s.collected.fileNumber);
      if (!f) {
        return nawi(s, ts(s, "No encontré ese expediente en la demo.", "Kay demopi chay expedienteta mana tarirqanichu."),
          [
            { id: "retry", label: ts(s, "Intentar otra vez", "Hukmanta kallpachakuy") },
            { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
          ]);
      }
      if (f.ownerDni !== s.confirmed.dni) {
        return nawi(s,
          ts(s, "Por privacidad, no puedo mostrar información de un expediente que no está vinculado a tu identidad validada.",
            "Privacidadrayku, manam rikuchiyta atinichu kay expediente willakuyta, identidadniykiman mana watasqa kaptin."),
          [
            { id: "other", label: ts(s, "Consultar otro expediente", "Huk expedienteta tapuy") },
            { id: "list", label: ts(s, "Buscar mis trámites", "Rurayniykunata maskay") },
            { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
            { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
          ]);
      }
      const opts = [
        { id: "last", label: ts(s, "Ver último movimiento", "Qhipa kuyuyta qhaway") },
        { id: "other", label: ts(s, "Consultar otro expediente", "Huk expedienteta tapuy") },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ];
      if (f.status === "Observado") {
        opts.unshift({ id: "fix", label: ts(s, "Corregir ahora", "Kunan allinchay"), tone: "primary" });
      }
      return nawi(s,
        ts(s, "Tu trámite " + getFileProcedureName(f, s.language) + ", expediente " + f.number + ", está " + getFileStatus(f, s.language) + ".",
          "Rurayniyki " + getFileProcedureName(f, s.language) + ", expediente " + fileNumberForVoice(f.number, s.language) + ", kayninqa " + getFileStatus(f, s.language) + "."),
        opts, { card: { kind: "file-status", file: f }, simulatedNote: true });
    },

    "status-list": (s) => {
      const mine = SIM_FILES.filter((f) => f.ownerDni === s.confirmed.dni);
      return nawi(s,
        ts(s, "Encontré " + mine.length + " trámites vinculados a " + s.confirmed.fullName + ". Elige uno para ver el detalle.",
          "Kaypi " + mine.length + " ruraykunata tarirqani, " + s.confirmed.fullName + " sutiman watasqa. Hukninta akllay sut'inchayta qhawanaykipaq."),
        mine.map((f) => ({ id: f.number, label: f.number + " — " + getFileProcedureName(f, s.language) + " — " + getFileStatus(f, s.language) }))
          .concat([
            { id: "other", label: ts(s, "Consultar otro expediente", "Huk expedienteta tapuy") },
            { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
          ]),
        { card: { kind: "file-list", files: mine }, simulatedNote: true });
    },

    observed: (s) => {
      const f = SIM_FILES.find((x) => x.number === s.collected.fileNumber);
      const observation = getFileObservation(f, s.language) || "";
      return nawi(s,
        ts(s, "Tu trámite fue observado. " + observation + " Puedes corregirlo desde aquí.",
          "Rurayniykiqa observado kachkan. " + observation + " Kaymanta allinchayta atinki."),
        [
          { id: "fix", label: ts(s, "Corregir ahora", "Kunan allinchay"), tone: "primary" },
          { id: "repeat", label: ts(s, "Repetir observación", "Qhawarisqata hukmanta niy") },
          { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        ]);
    },

    "correct-attach": (s) => nawi(s,
      ts(s, "Para subsanar, simula adjuntar el documento solicitado. ¿Deseas adjuntar la solicitud simple firmada?",
        "Allinchanapaq, mañakusqa qillqata demo hina yapay. Solicitud simple firmada nisqata yapayta munankichu?"),
      [
        { id: "yes", label: ts(s, "Sí, adjuntar (simulado)", "Arí, yapay demo hina"), synonyms: ["si", "sí", "ari", "arí"], tone: "primary" },
        { id: "describe", label: ts(s, "Describir corrección por voz", "Allinchayta rimaywan willay") },
        { id: "back", label: ts(s, "Volver atrás", "Qhipaman kutiy") },
        { id: "cancel", label: ts(s, "Cancelar", "Saqiy"), tone: "danger" },
      ]),

    "correct-done": (s) => nawi(s, ts(s, "Subsanación registrada en esta demo.", "Subsanación kay demopi registrasqañam."),
      [
        { id: "status", label: ts(s, "Ver estado actualizado", "Musuq kayninta qhaway"), tone: "primary" },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]),

    "human-support": (s) => nawi(s,
      ts(s, "Puedo orientarte con los datos de la Mesa de Partes del Gobierno Regional de Cusco. Dirección: Avenida Tomasa Ttito Condemayta 1101, Wanchaq, Cusco. Atención presencial: lunes a viernes de 8:00 a.m. a 4:30 p.m. También está la Ventanilla Virtual, disponible las 24 horas, en gob.pe barra regioncusco. Teléfono referencial: 084-000000.",
        "Gobierno Regional de Cusco Mesa de Partes nisqapa willakuyninwan yanapayta atini. Maypi: Avenida Tomasa Ttito Condemayta 1101, Wanchaq, Cusco. Atencionqa lunesmanta vierneskama, pusaq pacha tutamanta tawa treinta tardekama. Ventanilla Virtual nisqapas tukuy p'unchaw kachkan, gob.pe barra regioncusco nisqapi. Telefono: cero ocho cuatro, cero cero cero cero cero cero."),
      [
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy"), tone: "primary" },
        { id: "req", label: ts(s, "Consultar requisitos", "Munasqakunata tapuy") },
        { id: "retry", label: ts(s, "Reintentar validación", "Hukmanta chiqaqchay") },
        { id: "end", label: ts(s, "Finalizar", "Tukuy") },
      ]),

    notification: (s) => {
      const f = SIM_FILES.find((x) => x.number === "EXP-2026-0089");
      return nawi(s,
        ts(s, "Novedad en tu trámite: el expediente " + f.number + " tiene una actualización.",
          "Rurayniykipi musuq willakuy kachkan: expediente " + fileNumberForVoice(f.number, s.language) + " huk musuq willakuyuqmi."),
        [
          { id: "details", label: ts(s, "Ver detalles", "Sut'inchayta qhaway"), tone: "primary" },
          { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
          { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
        ],
        { card: { kind: "notification", file: f }, simulatedNote: true });
    },

    cancelled: (s) => nawi(s, ts(s, "Proceso cancelado. No se envió nada.", "Procesoqa saqisqam. Manam imapas apachisqachu."),
      [{ id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy"), tone: "primary" }]),
  };

  function buildTurnFor(state, step) {
    const b = STEP_BUILDERS[step];
    return b ? b(state) : nawi(state, ts(state, "Continuemos.", "Qatisun."), []);
  }

  // ---------- Engine ----------
  function pushNawi(state, step) {
    const turn = buildTurnFor(Object.assign({}, state, { step }), step);
    turn.step = step;
    const history = state.step !== step && state.step !== "facial-module"
      ? state.history.concat([state.step]) : state.history;
    return Object.assign({}, state, {
      step, history,
      turns: state.turns.concat([turn]),
      currentOptions: turn.options || [],
      unclearCount: 0,
      facialModuleOpen: step === "facial-module",
    });
  }

  function pushUser(state, text, asVoiceNote) {
    return Object.assign({}, state, {
      turns: state.turns.concat([{ id: id(), from: "user", text, isVoiceNote: !!asVoiceNote, transcription: asVoiceNote ? text : undefined, at: now() }]),
    });
  }

  function unclear(state) {
    const next = state.unclearCount + 1;

    // 1ra vez: pedir reformular, SIN mostrar el menú todavía.
    if (next === 1) {
      const turn = nawi(state,
        ts(state, "No entendí bien, ¿puedes explicarme de otra forma?",
          "Manam allintachu hap'irqani. ¿Huk hinata willawayta atinkichu?"),
        []);
      return Object.assign({}, state, { turns: state.turns.concat([turn]), unclearCount: 1 });
    }

    // 2da vez: mostrar el menú de opciones.
    if (next === 2) {
      const turn = buildTurnFor(Object.assign({}, state, { step: "menu" }), "menu");
      turn.step = "menu";
      return Object.assign({}, state, {
        step: "menu", history: [],
        turns: state.turns.concat([turn]),
        currentOptions: turn.options || [],
        unclearCount: 2,
      });
    }

    // 3ra vez seguida: derivar a una persona (pushNawi resetea el contador a 0).
    return pushNawi(state, "human-support");
  }

  function goBack(state) {
    const prev = state.history[state.history.length - 1];
    if (!prev) return pushNawi(state, "menu");
    const history = state.history.slice(0, -1);
    return pushNawi(Object.assign({}, state, { history }), prev);
  }

  function askCancel(state) {
    const turn = nawi(state,
      ts(state, "¿Quieres cancelar este proceso? Si cancelas, no se enviará nada.", "Kay procesota saqiyta munankichu? Saqispaqa manam imapas apachisqachu kanqa."),
      [
        { id: "cancel-yes", label: ts(state, "Sí, cancelar", "Arí, saqiy"), tone: "danger" },
        { id: "cancel-no", label: ts(state, "No, continuar", "Mana, qatiy"), tone: "primary" },
        { id: "back", label: ts(state, "Volver atrás", "Qhipaman kutiy") },
      ]);
    return Object.assign({}, state, { turns: state.turns.concat([turn]), currentOptions: turn.options || [] });
  }

  function handleSelect(state, optionId) {
    if (optionId === "cancel-yes") {
      return pushNawi(Object.assign({}, state, { collected: {}, identityValidated: false, confirmed: {}, history: [] }), "cancelled");
    }
    if (optionId === "cancel-no") return pushNawi(state, state.step);
    if (optionId === "back") return goBack(state);
    if (optionId === "menu") return pushNawi(Object.assign({}, state, { history: [], flowOrigin: undefined }), "menu");
    if (optionId === "repeat") return pushNawi(state, state.step);
    if (optionId === "human") return pushNawi(state, "human-support");
    if (optionId === "retry") {
      if (state.step === "facial-result-fail" || state.step === "facial-cancelled") return pushNawi(state, "facial-module");
      return pushNawi(state, state.step);
    }
    if (optionId === "end") return pushNawi(state, "cancelled");
    // Consultar otro expediente (estado real): reinicia el mini-flujo de seguimiento.
    if (optionId === "status-real") return pushNawi(Object.assign({}, state, { collected: {} }), "status-real-exp");

    switch (state.step) {
      case "language": {
        const lang = optionId === "qu" ? "qu" : "es";
        if (state.channel === "web") return pushNawi(Object.assign({}, state, { language: lang }), "welcome");
        return pushNawi(Object.assign({}, state, { language: lang }), "menu");
      }
      case "welcome": {
        if (optionId !== "voice" && optionId !== "novoice") break;
        const s2 = Object.assign({}, state, { voiceMode: optionId === "voice" });
        // Tras elegir idioma y audio: si el canal destino es WhatsApp, mostramos el botón
        // de redirección; si es web, arrancamos la validación de identidad (onboarding).
        if (state.targetChannel === "whatsapp") return pushNawi(s2, "whatsapp-handoff");
        return pushNawi(Object.assign({}, s2, { flowOrigin: "onboarding" }), "privacy");
      }
      case "menu":
        if (optionId === "req") return pushNawi(Object.assign({}, state, { flowOrigin: undefined, collected: {} }), "req-list");
        if (optionId === "start") {
          // La identidad ya se validó en el onboarding: vamos directo a elegir la dependencia
          // (formulario real de la Mesa de Partes Virtual: dependencia → tipo de documento).
          if (state.identityValidated) return pushNawi(Object.assign({}, state, { flowOrigin: "start-procedure", collected: {} }), "tramite-dep");
          return pushNawi(Object.assign({}, state, { flowOrigin: "start-procedure" }), "start-explain");
        }
        if (optionId === "status") {
          // En web, el seguimiento usa el sistema real del GORE (público, sin validar identidad).
          if (state.channel === "web") return pushNawi(Object.assign({}, state, { flowOrigin: "status", collected: {} }), "status-real-exp");
          return pushNawi(Object.assign({}, state, { flowOrigin: "status" }), "status-explain");
        }
        break;
      case "status-real-dep":
        if ((D.DEPENDENCIAS || []).some((d) => String(d.iddependencia) === optionId)) {
          return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { estadoDep: parseInt(optionId, 10) }) }), "status-real-anio");
        }
        break;
      case "status-real-anio":
        if (/^\d{4}$/.test(optionId)) {
          return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { estadoAnio: parseInt(optionId, 10) }) }), "status-real-result");
        }
        break;
      case "req-list":
        if (optionId === "describe") return pushNawi(state, "req-ask");
        if (PROCEDURES.find((p) => p.id === optionId)) {
          return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { procedureId: optionId }) }), "req-result");
        }
        break;
      case "req-ask":
        if (optionId === "no-se") return pushNawi(state, "req-category");
        break;
      case "req-category": {
        if (optionId === "ninguna") return pushNawi(state, "human-support");
        return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { category: optionId }) }), "req-suggest");
      }
      case "req-suggest": {
        if (optionId === "ninguna") return pushNawi(state, "human-support");
        if (PROCEDURES.find((p) => p.id === optionId)) {
          return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { procedureId: optionId }) }), "req-confirm-proc");
        }
        break;
      }
      case "req-confirm-proc":
        if (optionId === "yes") return pushNawi(state, "req-result");
        if (optionId === "other") return pushNawi(state, "req-category");
        break;
      case "req-result":
        if (optionId === "start") return pushNawi(Object.assign({}, state, { flowOrigin: "start-procedure" }), "start-explain");
        if (optionId === "other") return pushNawi(state, "req-ask");
        if (optionId === "copy") return state;
        break;
      case "start-explain":
        if (optionId === "ok") return pushNawi(state, "privacy");
        break;
      case "privacy":
        if (optionId === "accept") return pushNawi(state, "ask-name");
        if (optionId === "reject") return pushNawi(state, "cancelled");
        if (optionId === "repeat") return pushNawi(state, "privacy");
        break;
      case "ask-name":
        if (optionId === "demo") return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { fullName: DEMO_CITIZEN.fullName }) }), "confirm-name");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "confirm-name":
        if (optionId === "yes") return pushNawi(Object.assign({}, state, { confirmed: Object.assign({}, state.confirmed, { fullName: state.collected.fullName }) }), "ask-dni");
        if (optionId === "no") return pushNawi(state, "ask-name");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "ask-dni":
        if (optionId === "demo") return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { dni: DEMO_CITIZEN.dni }) }), "confirm-dni");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "confirm-dni":
        if (optionId === "yes") return pushNawi(Object.assign({}, state, { confirmed: Object.assign({}, state.confirmed, { dni: state.collected.dni }) }), "identity-summary");
        if (optionId === "no") return pushNawi(state, "ask-dni");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "identity-summary":
        if (optionId === "yes") return pushNawi(state, "facial-consent");
        if (optionId === "fix-name") return pushNawi(state, "ask-name");
        if (optionId === "fix-dni") return pushNawi(state, "ask-dni");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "facial-consent":
        if (optionId === "yes") return pushNawi(state, "facial-module");
        if (optionId === "nocam" || optionId === "no") return pushNawi(state, "human-support");
        break;
      case "facial-result":
        if (optionId === "continue") return pushNawi(state, "post-validation");
        break;
      case "post-validation":
        if (state.flowOrigin === "status") {
          if (optionId === "have") return pushNawi(state, "status-ask-file");
          if (optionId === "no-have") return pushNawi(state, "status-list");
        } else {
          if (optionId === "yes") return pushNawi(state, "show-requirements");
          if (optionId === "other") return pushNawi(state, "choose-procedure");
          if (optionId === "reqs") return pushNawi(state, "req-list");
          if (PROCEDURES.find((p) => p.id === optionId)) return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { procedureId: optionId }) }), "show-requirements");
          if (optionId === "no-se") return pushNawi(state, "req-category");
        }
        break;
      case "choose-procedure":
        if (PROCEDURES.find((p) => p.id === optionId)) return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { procedureId: optionId }) }), "show-requirements");
        if (optionId === "no-se") return pushNawi(state, "req-category");
        break;
      case "tramite-dep": {
        const dep = (D.DEPENDENCIAS || []).find((d) => String(d.iddependencia) === optionId);
        if (dep) return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { iddependencia: dep.iddependencia, dependencia_nombre: dep.nombre }) }), "tramite-tipodoc");
        break;
      }
      case "tramite-tipodoc": {
        const tipo = (D.TIPOS_DOC_COMUNES || []).find((t) => t.nombre === optionId);
        if (tipo) return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { tipodoc_nombre: tipo.nombre }) }), "ask-motivo");
        break;
      }
      case "show-requirements":
        if (optionId === "yes") return pushNawi(state, "ask-motivo");
        if (optionId === "other") return pushNawi(state, "choose-procedure");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "ask-motivo":
        if (optionId === "cancel") return askCancel(state);
        break;
      case "ask-attachment":
        // En web recolectamos celular y correo (requeridos para el trámite real) antes del resumen.
        if (optionId === "yes") return pushNawi(Object.assign({}, state, { confirmed: Object.assign({}, state.confirmed, { attachment: "solicitud_simulada.pdf" }) }), state.channel === "web" ? "ask-celular" : "final-summary");
        if (optionId === "no") return pushNawi(Object.assign({}, state, { confirmed: Object.assign({}, state.confirmed, { attachment: "—" }) }), state.channel === "web" ? "ask-celular" : "final-summary");
        break;
      case "ask-celular":
        if (optionId === "cancel") return askCancel(state);
        break;
      case "ask-correo":
        if (optionId === "cancel") return askCancel(state);
        break;
      case "ask-adjunto":
        if (optionId === "demo" || optionId === "uploaded") return pushNawi(state, "final-summary");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "final-summary":
        if (optionId === "send") return pushNawi(state, "submitted");
        if (optionId === "fix") return pushNawi(state, "ask-motivo");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "submitted":
        if (optionId === "status") return pushNawi(Object.assign({}, state, { flowOrigin: "status", collected: Object.assign({}, state.collected, { fileNumber: "EXP-2026-0089" }) }), "status-confirm-file");
        if (optionId === "copy") {
          if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText("EXP-2026-0089").catch(() => {});
          return state;
        }
        break;
      case "status-explain":
        if (optionId === "ok") {
          if (state.identityValidated) return pushNawi(state, "status-have-file");
          return pushNawi(state, "privacy");
        }
        break;
      case "status-have-file":
        if (optionId === "have") return pushNawi(state, "status-ask-file");
        if (optionId === "no-have") return pushNawi(state, "status-list");
        break;
      case "status-ask-file":
        if (optionId === "demo") return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { fileNumber: "EXP-2026-0089" }) }), "status-confirm-file");
        if (optionId === "demo2") return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { fileNumber: "EXP-2026-9999" }) }), "status-confirm-file");
        break;
      case "status-confirm-file":
        if (optionId === "yes") return pushNawi(state, "status-show");
        if (optionId === "no") return pushNawi(state, "status-ask-file");
        break;
      case "status-show":
        if (optionId === "fix") return pushNawi(state, "correct-attach");
        if (optionId === "other") return pushNawi(state, "status-ask-file");
        if (optionId === "list") return pushNawi(state, "status-list");
        if (optionId === "last") return pushNawi(state, "status-show");
        break;
      case "status-list": {
        const f = SIM_FILES.find((x) => x.number === optionId);
        if (f) return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { fileNumber: f.number }) }), "status-show");
        if (optionId === "other") return pushNawi(state, "status-ask-file");
        break;
      }
      case "correct-attach":
        if (optionId === "yes" || optionId === "describe") return pushNawi(state, "correct-done");
        if (optionId === "cancel") return askCancel(state);
        break;
      case "correct-done":
        if (optionId === "status") return pushNawi(state, "status-show");
        break;
      case "notification":
        if (optionId === "details") {
          if (!state.identityValidated) return pushNawi(Object.assign({}, state, { flowOrigin: "status", collected: Object.assign({}, state.collected, { fileNumber: state.notifiedFor }) }), "status-explain");
          return pushNawi(Object.assign({}, state, { collected: Object.assign({}, state.collected, { fileNumber: state.notifiedFor }) }), "status-show");
        }
        break;
      case "cancelled":
        if (optionId === "menu") return pushNawi(Object.assign({}, state, { collected: {}, history: [] }), "menu");
        break;
    }
    return state;
  }

  // ---------- Comprensión de texto libre (E1/E3/E4) ----------
  const _norm = (s) => String(s).toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[¿¡?.!,]/g, "").trim();

  // Pasos donde NO se debe reinterpretar texto libre (decisiones sí/no, recolección).
  const BLOCKED_FREE = [
    "language", "welcome", "privacy", "confirm-name", "confirm-dni", "identity-summary",
    "facial-consent", "show-requirements", "ask-attachment", "final-summary",
    "status-confirm-file", "start-explain",
  ];
  const OUT_OF_SCOPE = [
    "pasaporte", "renovar mi dni", "sacar mi dni", "reniec", "municipalidad",
    "sunat", "sunarp", "migraciones", "brevete", "licencia de conducir",
    "recibo de luz", "recibo de agua", "antecedentes penales", "antecedentes policiales",
  ];
  const TERCERO = [
    "mi vecino", "de mi vecino", "de otra persona", "otra persona", "de un familiar",
    "de mi amigo", "de mi amiga", "ajeno", "de alguien", "de mi papa", "de mi papá",
  ];

  function matchProcedure(t) {
    for (const p of PROCEDURES) {
      const cands = [p.name].concat(p.synonyms || []).map(_norm);
      if (cands.some((c) => c && t.indexOf(c) !== -1)) return p.id;
    }
    return null;
  }

  function inlineTurn(s, text, options) {
    const turn = nawi(s, text, options);
    return Object.assign({}, s, { turns: s.turns.concat([turn]), currentOptions: turn.options || [] });
  }

  function outOfScope(s) {
    return inlineTurn(s,
      ts(s, "Ese trámite no corresponde al Gobierno Regional de Cusco, así que no puedo ayudarte con eso. Te recomiendo acudir a la entidad correspondiente, por ejemplo RENIEC, la municipalidad o el ministerio del caso. ¿Puedo ayudarte con un trámite del GORE Cusco?",
        "Chay rurayqa manam Gobierno Regional de Cuscoqpachu, chayrayku manam yanapayta atikuchu. Chay ruraypaq huk wasimanmi riy: RENIEC, municipalidad utaq ministerio. ¿GORE Cusco ruraywanchu yanapaykiman?"),
      [
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy"), tone: "primary" },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]);
  }

  function tercero(s) {
    return inlineTurn(s,
      ts(s, "Por privacidad, solo puedo mostrarte el estado de tus propios trámites, no los de otra persona. Si es tu trámite, con gusto te ayudo a consultarlo.",
        "Privacidadrayku, qampa kikiyki ruraynikikunallatam rikuchiyta atiyki, manam huk runaqtachu. Qampa rurayniyki kaqtinqa, kusisqa yanapasqayki."),
      [
        { id: "status", label: ts(s, "Ver mis trámites", "Rurayniykunata qhaway"), tone: "primary" },
        { id: "menu", label: ts(s, "Volver al menú", "Menuman kutiy") },
        { id: "human", label: ts(s, "Hablar con una persona", "Runawan rimay") },
      ]);
  }

  function understand(s, txt) {
    const t = _norm(txt);
    if (OUT_OF_SCOPE.some((w) => t.indexOf(w) !== -1)) return outOfScope(s);
    if (TERCERO.some((w) => t.indexOf(w) !== -1)) return tercero(s);
    const pid = matchProcedure(t);
    if (pid) {
      return pushNawi(Object.assign({}, s, { flowOrigin: undefined, collected: Object.assign({}, s.collected, { procedureId: pid }) }), "req-result");
    }
    if (/requisito|que necesito|que piden|que documentos|documentos para/.test(t)) {
      return pushNawi(Object.assign({}, s, { flowOrigin: undefined, collected: {} }), "req-list");
    }
    if (/estado|como va|seguimiento|expediente|mi tramite/.test(t)) {
      if (s.channel === "web") return pushNawi(Object.assign({}, s, { flowOrigin: "status", collected: {} }), "status-real-exp");
      return pushNawi(Object.assign({}, s, { flowOrigin: "status" }), "status-explain");
    }
    if (/iniciar|empezar|hacer un tramite|presentar|nueva solicitud|tramitar/.test(t)) {
      return pushNawi(Object.assign({}, s, { flowOrigin: "start-procedure" }), "start-explain");
    }
    return null;
  }

  function reducer(state, action) {
    switch (action.type) {
      case "INIT": return pushNawi(initialState(action.channel), "language");
      case "RESET": return pushNawi(Object.assign(initialState(state.channel), { targetChannel: state.targetChannel }), "language");
      case "SET_VOICE_MODE": return Object.assign({}, state, { voiceMode: action.voiceMode });
      case "SET_TARGET_CHANNEL": return Object.assign({}, state, { targetChannel: action.targetChannel || "web" });
      case "GOTO": return pushNawi(state, action.step);
      case "TRIGGER_NOTIFICATION": {
        if (state.notifiedFor) return state;
        const next = pushNawi(state, "notification");
        return Object.assign({}, next, { notifiedFor: "EXP-2026-0089", flowOrigin: "notification" });
      }
      case "FACIAL_RESULT": {
        const after = pushUser(Object.assign({}, state, { facialModuleOpen: false }), action.success ? "[Validación facial exitosa]" : "[Validación facial fallida]");
        if (action.success) {
          const validated = Object.assign({}, after, {
            identityValidated: true,
            confirmed: Object.assign({}, after.confirmed, { fullName: after.collected.fullName, dni: after.collected.dni }),
          });
          // En el onboarding, tras validar la identidad vamos al menú; dentro de un flujo
          // (trámite/estado) seguimos con post-validation como antes.
          return pushNawi(validated, after.flowOrigin === "onboarding" ? "menu" : "post-validation");
        }
        return pushNawi(after, "facial-result-fail");
      }
      case "FACIAL_PIN_SUCCESS": {
        const after = pushUser(Object.assign({}, state, { facialModuleOpen: false }), "[Identidad validada por PIN simulado]");
        const validated = Object.assign({}, after, {
          identityValidated: true,
          confirmed: Object.assign({}, after.confirmed, { fullName: after.collected.fullName, dni: after.collected.dni }),
        });
        return pushNawi(validated, "post-validation");
      }
      case "FACIAL_CANCEL": {
        const after = pushUser(Object.assign({}, state, { facialModuleOpen: false }), "[Validación cancelada por el usuario]");
        return pushNawi(after, "facial-cancelled");
      }
      case "SELECT": return handleSelect(state, action.optionId);
      case "SUBMIT_TEXT": {
        const txt = action.text.trim();
        if (!txt) return state;
        let s = pushUser(state, txt, action.asVoiceNote);
        const g = classifyGlobal(txt);
        if (g === "back") return goBack(s);
        if (g === "cancel") return askCancel(s);
        if (g === "repeat") return pushNawi(s, s.step);
        if (g === "menu") return pushNawi(Object.assign({}, s, { history: [], collected: {} }), "menu");
        if (g === "help") return pushNawi(Object.assign({}, s, { flowOrigin: undefined }), "human-support");

        switch (s.step) {
          case "ask-name": {
            const name = txt.replace(/\s+/g, " ").trim();
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { fullName: name }) });
            return pushNawi(s, "confirm-name");
          }
          case "ask-dni": {
            const dni = extractDni(txt);
            if (!dni) {
              const turn = nawi(s, ts(s, "El DNI debe tener 8 dígitos y solo números. ¿Me lo repites, por favor?", "DNIqa pusaq yupayniyuqmi, yupaykunallawan. ¿Hukmanta niwankichu?"), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { dni }) });
            return pushNawi(s, "confirm-dni");
          }
          case "status-ask-file": {
            const fn = extractFileNumber(txt);
            if (!fn) {
              const turn = nawi(s, ts(s, "No reconocí el número. Formato esperado: EXP-XXXX-AAAA.", "Manam yupayta riqsirqanichu. Formatoqa kay hinam kanan: EXP-XXXX-AAAA."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { fileNumber: fn }) });
            return pushNawi(s, "status-confirm-file");
          }
          case "ask-motivo": {
            if (txt.trim().length < 3) {
              const turn = nawi(s, ts(s, "El asunto es obligatorio. Cuéntame brevemente para qué es tu solicitud.", "Imaraykuqa kananpunim. Pisillata willaway imapaq kasqanta."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { motivo: txt }), confirmed: Object.assign({}, s.confirmed, { motivo: txt }) });
            return pushNawi(s, s.channel === "web" ? "ask-celular" : "ask-attachment");
          }
          case "tramite-dep": {
            const tl = _norm(txt);
            const dep = (D.DEPENDENCIAS || []).find((d) => {
              const nombre = _norm(d.nombre);
              return tl && (nombre.indexOf(tl) !== -1 || tl.indexOf(_norm(d.abrev)) !== -1 || _norm(d.abrev) === tl);
            });
            if (!dep) {
              const turn = nawi(s, ts(s, "No identifiqué la dependencia. Dímela otra vez o elígela de la lista, por ejemplo Agricultura o Salud.", "Manam dependenciata riqsirqanichu. Hukmanta niway utaq listamanta akllay."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            return pushNawi(Object.assign({}, s, { collected: Object.assign({}, s.collected, { iddependencia: dep.iddependencia, dependencia_nombre: dep.nombre }) }), "tramite-tipodoc");
          }
          case "tramite-tipodoc": {
            const tl = _norm(txt);
            const tipo = (D.TIPOS_DOC_COMUNES || []).find((t) =>
              tl && (_norm(t.nombre).indexOf(tl) !== -1 || (t.synonyms || []).some((sy) => tl.indexOf(_norm(sy)) !== -1)));
            if (!tipo) {
              const turn = nawi(s, ts(s, "No reconocí ese tipo de documento. Puedes decir, por ejemplo: solicitud, carta, informe u oficio; o elige de la lista.", "Manam chay laya qillqata riqsirqanichu. Niy: solicitud, carta, informe; utaq listamanta akllay."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            return pushNawi(Object.assign({}, s, { collected: Object.assign({}, s.collected, { tipodoc_nombre: tipo.nombre }) }), "ask-motivo");
          }
          case "ask-celular": {
            const cel = (txt.match(/\d+/g) || []).join("");
            if (cel.length < 6) {
              const turn = nawi(s, ts(s, "Necesito un número de celular válido (al menos 6 dígitos). ¿Me lo repites?", "Allin celular yupaytam munani. ¿Hukmanta niwankichu?"), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { celular: cel }) });
            return pushNawi(s, "ask-correo");
          }
          case "ask-correo": {
            const correo = txt.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
              const turn = nawi(s, ts(s, "Ese correo no parece válido. Escríbelo completo, por ejemplo nombre@correo.com.", "Chay correoqa manam allinchu. Hunt'ata qillqay, kay hina: suti@correo.com."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { correo: correo }) });
            return pushNawi(s, "ask-adjunto");
          }
          case "status-real-exp": {
            const num = (txt.match(/\d+/g) || []).join("");
            if (!num) {
              const turn = nawi(s, ts(s, "Dime el número de expediente, solo los dígitos.", "Expediente yupayta niway, yupaykunallata."), s.currentOptions);
              return Object.assign({}, s, { turns: s.turns.concat([turn]) });
            }
            s = Object.assign({}, s, { collected: Object.assign({}, s.collected, { estadoNro: parseInt(num, 10) }) });
            return pushNawi(s, "status-real-dep");
          }
          case "status-real-dep": {
            const optId = matchOption(txt, s.currentOptions);
            if (optId && (D.DEPENDENCIAS || []).some((d) => String(d.iddependencia) === optId)) {
              return pushNawi(Object.assign({}, s, { collected: Object.assign({}, s.collected, { estadoDep: parseInt(optId, 10) }) }), "status-real-anio");
            }
            const turn = nawi(s, ts(s, "No identifiqué la dependencia. Elige una de la lista o di su nombre corto, por ejemplo GERAGRI.", "Manam dependenciata riqsirqanichu. Hukninta akllay."), s.currentOptions);
            return Object.assign({}, s, { turns: s.turns.concat([turn]) });
          }
          case "status-real-anio": {
            const y = (txt.match(/\d{4}/) || [])[0];
            const anio = y ? parseInt(y, 10) : 2026;
            return pushNawi(Object.assign({}, s, { collected: Object.assign({}, s.collected, { estadoAnio: anio }) }), "status-real-result");
          }
          default: {
            const optId = matchOption(txt, s.currentOptions);
            if (optId) return handleSelect(s, optId);
            if (g === "yes" && s.currentOptions.find((o) => o.id === "yes")) return handleSelect(s, "yes");
            if (g === "no" && s.currentOptions.find((o) => o.id === "no")) return handleSelect(s, "no");
            if (s.step === "final-summary" && g === "yes") return handleSelect(s, "send");
            if (s.step === "final-summary" && g === "no") return handleSelect(s, "fix");
            if (BLOCKED_FREE.indexOf(s.step) === -1) {
              const understood = understand(s, txt);
              if (understood) return understood;
            }
            return unclear(s);
          }
        }
      }
    }
    return state;
  }

  window.NawiEngine = { initialState, reducer, buildTurnFor };
})();
