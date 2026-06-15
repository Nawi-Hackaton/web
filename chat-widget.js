/* =========================================================
   Ñawi — Widget de chat (render + voz + facial + shell)
   Conecta NawiEngine/NawiData con el DOM. Sin frameworks.

   --- CONEXIÓN CON EL BACKEND (PARTE 5) ---
   Hoy el flujo es 100% simulado en el navegador (igual que el prototipo).
   Cuando exista el backend, cada paso marcado abajo haría la llamada real:
     TODO(backend): clasificar intención -> POST /webhook            (al enviar texto libre)
     TODO(backend): buscar en RAG -> se resuelve dentro de /webhook  (requisitos)
     TODO(backend): validar DNI -> POST /api/identity/validate       (paso confirm-dni)
     TODO(backend): generar OTP -> POST /api/identity/otp            (validación de identidad)
     TODO(backend): verificar OTP -> POST /api/identity/verify-otp   (módulo facial / PIN)
     TODO(backend): crear expediente -> POST /api/expedientes        (paso submitted)
     TODO(backend): consultar estado -> GET /api/expedientes/{id}    (status-show)
   ========================================================= */
"use strict";

(function () {
  const D = window.NawiData;
  const ICON = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H8l-4 4V4z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 12a6 6 0 0 0 12 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-7-7 16-2-6-7-3z" fill="currentColor"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2.5-2.5A6 6 0 1 0 18 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12C4.5 7.5 8 5 12 5s7.5 2.5 10 7c-2.5 4.5-6 7-10 7S4.5 16.5 2 12Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.18"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>',
    face: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" fill="currentColor"/></svg>',
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function t(lang, es, qu) { return lang === "qu" ? qu : es; }

  // ---------------- Voz (Web Speech API) ----------------
  const caps = { tts: "speechSynthesis" in window, sr: !!(window.SpeechRecognition || window.webkitSpeechRecognition) };
  let recognition = null;
  let isSpeaking = false;
  if (caps.sr) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = "es-PE";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
  }
  // URL del backend. En local usa localhost; desplegado usa la URL pública de tu backend.
  // >>> Al desplegar, reemplaza PROD_BACKEND por tu dominio (ej. https://nawi-gore.duckdns.org). <<<
  const PROD_BACKEND = "https://nawi-gore.duckdns.org";
  const _esLocal = (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:");
  const BACKEND_URL = _esLocal ? "http://localhost:8000" : PROD_BACKEND;
  // Número de WhatsApp de Ñawi para el botón "click to chat" (E.164 sin "+"). El frontend es
  // estático y no lee el .env: cuando tengan el número real, cámbialo AQUÍ.
  const WHATSAPP_NUMBER = "51963169033";
  let currentAudio = null;     // <audio> activo cuando se usa el TTS del backend (ElevenLabs)
  let backendTtsDown = false;  // si el backend falla una vez, no se reintenta en la sesión
  let ttsAudio = null;         // ÚNICO elemento <audio> reutilizado (se desbloquea con un gesto)
  let audioPrimed = false;     // true una vez que el navegador permite reproducir audio

  // El navegador bloquea audio.play() automático si no hubo un gesto del usuario. Al primer
  // gesto (abrir el chat, clic en una opción) reproducimos un audio silencioso para
  // "desbloquear" el elemento; así el auto-play posterior (tras el fetch a /api/tts) sí suena.
  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  function primeAudio() {
    if (audioPrimed) return;
    try {
      if (!ttsAudio) ttsAudio = new Audio();
      ttsAudio.src = SILENT_WAV;
      const p = ttsAudio.play();
      if (p && p.then) p.then(() => { try { ttsAudio.pause(); ttsAudio.currentTime = 0; } catch (e) {} }).catch(() => {});
      audioPrimed = true;
    } catch (e) {}
  }

  // TTS del navegador (Web Speech API).
  function webSpeak(text, onEnd) {
    if (!caps.tts) { if (onEnd) onEnd(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-PE"; u.rate = 1.1; u.pitch = 1;
      u.onstart = () => { isSpeaking = true; updateTyping(); };
      u.onend = () => { isSpeaking = false; updateTyping(); if (onEnd) onEnd(); };
      u.onerror = () => { isSpeaking = false; updateTyping(); if (onEnd) onEnd(); };
      window.speechSynthesis.speak(u);
    } catch (e) { if (onEnd) onEnd(); }
  }

  // TTS preferente: si voiceMode está activo, usa el backend (ElevenLabs); si el backend
  // falla o no está disponible, cae a Web Speech API automáticamente. En modo manual usa
  // Web Speech directamente.
  function playText(text, onEnd) {
    // TODOS los mensajes (incluido el primero) intentan ElevenLabs por el backend; si el
    // backend falla o no está disponible, se cae a Web Speech API.
    if (backendTtsDown) { webSpeak(text, onEnd); return; }
    fetch(BACKEND_URL + "/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, lang: state.language }),
    })
      .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then((j) => {
        // Reutilizamos el MISMO elemento ya desbloqueado por primeAudio() para que el
        // navegador no bloquee la reproducción automática.
        if (!ttsAudio) ttsAudio = new Audio();
        const audio = ttsAudio;
        audio.src = "data:" + (j.mime || "audio/ogg") + ";base64," + j.audio_base64;
        currentAudio = audio;
        audio.onplay = () => { isSpeaking = true; updateTyping(); };
        audio.onended = () => { isSpeaking = false; currentAudio = null; updateTyping(); if (onEnd) onEnd(); };
        audio.onerror = () => { isSpeaking = false; currentAudio = null; updateTyping(); backendTtsDown = true; webSpeak(text, onEnd); };
        const pr = audio.play();
        if (pr && pr.catch) pr.catch(() => { isSpeaking = false; currentAudio = null; backendTtsDown = true; webSpeak(text, onEnd); });
      })
      .catch(() => { backendTtsDown = true; webSpeak(text, onEnd); });
  }

  function pauseSpeak() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    else { try { window.speechSynthesis.pause(); } catch (e) {} }
  }
  function resumeSpeak() {
    if (currentAudio) { try { currentAudio.play(); } catch (e) {} }
    else { try { window.speechSynthesis.resume(); } catch (e) {} }
  }
  function stopSpeak() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    try { window.speechSynthesis.cancel(); } catch (e) {}
    isSpeaking = false; updateTyping();
  }
  let listening = false;
  function listen(cb) {
    if (!recognition) return false;
    try {
      // El navegador no reconoce quechua; usamos es-PE en ambos casos.
      recognition.lang = (state.language === "qu") ? "es-PE" : "es-PE";
      recognition.onresult = (ev) => { const txt = (ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || ""; if (txt) cb(txt); };
      recognition.onend = () => { listening = false; updateMicBtn(); };
      recognition.onerror = (ev) => {
        listening = false; updateMicBtn();
        const err = ev && ev.error;
        if (err === "not-allowed" || err === "audio-capture" || err === "service-not-allowed") {
          renderNotice("No se pudo usar el micrófono. Escribe tu respuesta.");
          dispatch({ type: "SET_VOICE_MODE", voiceMode: false });
        }
      };
      listening = true; updateMicBtn(); recognition.start(); return true;
    } catch (e) { listening = false; updateMicBtn(); return false; }
  }
  function stopListening() { try { if (recognition) recognition.stop(); } catch (e) {} listening = false; updateMicBtn(); }

  // ---------------- Estado del agente ----------------
  let state = window.NawiEngine.reducer(null, { type: "INIT", channel: "web" });
  let renderedCount = 0;
  let lastSpokenId = null;
  let panelOpen = false;
  let openerEl = null;

  // Estado de audio por burbuja (PROBLEMA 5: máximo 2 botones, según reproducción).
  const audioBars = {};      // turnId -> { el, turn }
  const playedTurns = {};    // turnId -> true (ya se reprodujo al menos una vez)
  let audioTurnId = null;    // burbuja con audio activo
  let audioState = "idle";   // "playing" | "paused" | "idle"

  // ---------------- Sincronización con el backend (RAG + Supabase) ----------------
  // El motor corre en el navegador; esta capa refleja los hitos del flujo en el backend
  // (sesión, usuario, expediente) y trae respuestas reales del RAG. Es "fire-and-forget":
  // si el backend no está, el chat sigue funcionando igual.
  let backendSyncDown = false;
  const sync = {
    sessionId: null, usuarioId: null, sentRegistro: false, sentExpediente: false,
    lastStep: null, ragDone: {}, dniChecked: {}, realPersona: null,
    estadoDone: {}, tramiteDone: {}, attachB64: null, attachNombre: null,
  };

  function resetSync() {
    sync.sessionId = null; sync.usuarioId = null; sync.sentRegistro = false;
    sync.sentExpediente = false; sync.lastStep = null; sync.ragDone = {};
    sync.dniChecked = {}; sync.realPersona = null; sync.estadoDone = {}; sync.tramiteDone = {};
    sync.attachB64 = null; sync.attachNombre = null;
  }
  function ensureSessionId() {
    if (!sync.sessionId) sync.sessionId = "web-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return sync.sessionId;
  }
  function backendPost(path, body) {
    return fetch(BACKEND_URL + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => { backendSyncDown = true; return null; });
  }
  function backendGet(path) {
    return fetch(BACKEND_URL + path)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  // Mientras hay una consulta al backend en curso (estado/trámite/identidad), bloqueamos la
  // escritura para que el usuario no envíe nada antes de que cargue la respuesta.
  let backendBusy = 0;
  function setBusy(delta) { backendBusy = Math.max(0, backendBusy + delta); updateInputBar(); }
  function busy(p) {
    setBusy(1);
    return p.then((v) => { setBusy(-1); return v; }, (e) => { setBusy(-1); throw e; });
  }
  function historialResumen() {
    return state.turns.slice(-8).map((tn) => ({ from: tn.from, text: (tn.text || "").slice(0, 300) }));
  }
  function lastNawiTurn() {
    for (let i = state.turns.length - 1; i >= 0; i--) { if (state.turns[i].from === "nawi") return state.turns[i]; }
    return null;
  }
  // Burbuja informativa de datos reales (RAG, RENIEC, seguimiento). speak=true la lee en voz.
  function infoBubble(eyebrow, text, speak) {
    if (!msgsEl) return;
    const wrap = document.createElement("div");
    wrap.className = "nw-rag";
    wrap.setAttribute("role", "note");
    wrap.innerHTML = '<div class="nw-rag-eyebrow"></div><div class="nw-rag-body"></div>';
    wrap.querySelector(".nw-rag-eyebrow").textContent = eyebrow;
    wrap.querySelector(".nw-rag-body").textContent = text;
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if (speak && state.voiceMode) playText(text);
  }
  function ragAnswerBubble(answer) {
    infoBubble("Información referencial de demostración (documentos del GORE Cusco)", answer, true);
  }
  function syncBackend() {
    if (backendSyncDown) return;
    const sid = ensureSessionId();

    // 1) Sesión: persistir/actualizar en cada cambio de paso del flujo.
    if (state.step !== sync.lastStep) {
      sync.lastStep = state.step;
      backendPost("/api/session", {
        session_id: sid, estado_flujo: state.step,
        datos: state.collected || {}, historial: historialResumen(),
      });
    }

    // 2) Registro: cuando ya hay nombre y DNI confirmados (tabla usuarios).
    const conf = state.confirmed || {};
    if (!sync.sentRegistro && conf.fullName && conf.dni) {
      sync.sentRegistro = true;
      backendPost("/api/registro", { session_id: sid, nombre: conf.fullName, dni: conf.dni })
        .then((j) => { if (j && j.usuario_id) sync.usuarioId = j.usuario_id; });
    }

    // 3) Expediente: al enviar el trámite (paso submitted) (tabla expedientes).
    if (!sync.sentExpediente && state.step === "submitted") {
      sync.sentExpediente = true;
      const p = (D.PROCEDURES || []).find((x) => x.id === (state.collected || {}).procedureId);
      const nombreTramite = p ? D.getProcedureName(p, "es") : "Trámite web";
      const crearExp = (uid) => backendPost("/api/expediente", {
        usuario_id: uid, nombre_tramite: nombreTramite, numero_expediente: "EXP-2026-0089",
      });
      if (sync.usuarioId) crearExp(sync.usuarioId);
      else if (conf.fullName && conf.dni) {
        backendPost("/api/registro", { session_id: sid, nombre: conf.fullName, dni: conf.dni })
          .then((j) => { if (j && j.usuario_id) { sync.usuarioId = j.usuario_id; crearExp(j.usuario_id); } });
      }
    }

    // 4) RAG real: cuando se muestra una tarjeta de requisitos, traer la respuesta de los
    // documentos y mostrarla como burbuja complementaria.
    const last = lastNawiTurn();
    if (last && last.card && last.card.kind === "requirements" && !sync.ragDone[last.id]) {
      sync.ragDone[last.id] = true;
      const p = last.card.procedure;
      const query = "Requisitos, costo y plazo para " + (p ? D.getProcedureName(p, "es") : "el trámite");
      backendPost("/api/rag", { query: query, lang: state.language })
        .then((j) => { if (j && j.found > 0 && j.answer) ragAnswerBubble(j.answer); });
    }

    // 5) DNI real (RENIEC vía QELLQA): al confirmar el DNI se valida en vivo. La validación
    // facial posterior sigue siendo una maqueta (mejora simulada).
    const dni = (state.collected || {}).dni;
    if (state.step === "confirm-dni" && dni && !sync.dniChecked[dni]) {
      sync.dniChecked[dni] = true;
      busy(backendGet("/api/qellqa/persona?tipo=DNI&nro=" + encodeURIComponent(dni))).then((j) => {
        if (j && j.persona) {
          sync.realPersona = j.persona;
          infoBubble("Identidad verificada en RENIEC", "Verifiqué tu DNI en RENIEC: " + (j.persona.razonSocial || j.persona.nombres) + ".", true);
        } else {
          infoBubble("Identidad RENIEC", "No pude verificar ese DNI en RENIEC. Revisa el número e inténtalo de nuevo.", true);
        }
      });
    }

    // 6) Estado real: el motor marca el turno con realStatus {nro, dep, anio}.
    if (last && last.realStatus && !sync.estadoDone[last.id]) {
      sync.estadoDone[last.id] = true;
      const q = last.realStatus;
      busy(backendGet("/api/qellqa/expediente?nro=" + q.nro + "&dep=" + q.dep + "&anio=" + q.anio)).then((j) => {
        if (j && j.movimientos && j.movimientos.length) {
          infoBubble("Seguimiento real del expediente", _estadoLegibleWeb(j.movimientos, q), true);
        } else {
          infoBubble("Seguimiento del expediente", "No encontré ese expediente en esa dependencia para ese año. Verifica los datos.", true);
        }
      });
    }

    // 7) Trámite real: el motor marca el turno con realTramite {datos}. Crea un expediente
    // REAL en el GORE; por eso solo ocurre tras la confirmación explícita del usuario.
    if (last && last.realTramite && !sync.tramiteDone[last.id]) {
      sync.tramiteDone[last.id] = true;
      const d = last.realTramite;
      infoBubble("Enviando al GORE Cusco", "Estoy registrando tu trámite en el sistema del Gobierno Regional de Cusco…", true);
      const payload = Object.assign({ session_id: sid }, d);
      if (sync.attachB64) { payload.archivo_base64 = sync.attachB64; payload.archivo_nombre = sync.attachNombre; }
      busy(backendPost("/api/qellqa/tramite", payload)).then((j) => {
        if (j && j.idtramite) {
          infoBubble("Trámite registrado (real)", "Tu trámite fue registrado con el número " + j.idtramite + " en el sistema del GORE Cusco. Te llegará un correo con los detalles.", true);
        } else {
          infoBubble("Trámite", "No se pudo registrar el trámite en el sistema del GORE en este momento. Inténtalo más tarde.", true);
        }
      });
    }
  }

  // Traduce el historial real del expediente a una lista numerada y clara.
  function _estadoLegibleWeb(movs, q) {
    const mapa = { "SIN RECIBIR": "pendiente de recepción", "RECIBIDO": "recibido", "DERIVADO": "derivado" };
    const fechaCorta = (iso) => { const s = (iso || "").slice(0, 10); return (s.length === 10 && s[4] === "-") ? (s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4)) : s; };
    const ultimo = movs[movs.length - 1];
    const est = mapa[(ultimo.estadorecepcion || "").toUpperCase()] || (ultimo.estadorecepcion || "");
    const lineas = ["Tu expediente N° " + q.nro + " del año " + q.anio + " tiene " + movs.length + " movimientos:"];
    movs.forEach((m, i) => {
      const accion = (m.accion || "").trim() || "Movimiento registrado";
      const destino = (m.destino || "").trim();
      lineas.push((i + 1) + ". " + fechaCorta(m.fecha) + " — " + accion + (destino ? (" (destino: " + destino + ")") : ""));
    });
    lineas.push("Estado actual: " + est + (ultimo.destino ? (", en " + ultimo.destino) : "") + ".");
    return lineas.join("\n");
  }

  function dispatch(action) {
    primeAudio(); // todo dispatch viene de un gesto del usuario: aprovechamos para desbloquear audio
    if (action.type === "RESET") {
      state = window.NawiEngine.reducer(state, action);
      msgsEl.innerHTML = ""; renderedCount = 0; lastSpokenId = null;
      Object.keys(audioBars).forEach((k) => delete audioBars[k]);
      Object.keys(playedTurns).forEach((k) => delete playedTurns[k]);
      audioTurnId = null; audioState = "idle";
      resetSync();
    } else {
      state = window.NawiEngine.reducer(state, action);
    }
    render();
    updateQuickBar();
    updateInputBar();
    // Al activar "Ñawi habla automáticamente": si el navegador no soporta reconocimiento de
    // voz, avisar y volver a modo texto; si sí, pedir permiso de micrófono una sola vez.
    if (state.voiceMode && !caps.sr && !srWarned) {
      srWarned = true;
      renderNotice("Tu navegador no permite reconocer la voz. Usa Chrome o Edge, o escribe tu respuesta.");
      dispatch({ type: "SET_VOICE_MODE", voiceMode: false });
    } else if (state.voiceMode && micPermission === "unknown") {
      ensureMicPermission();
    }
    syncFacial();
    autoSpeak();
    syncBackend();
  }

  // ---------------- Render de mensajes ----------------
  let msgsEl, inputEl, micBtn, sendBtn, voiceStatusEl, cancelVoiceBtn, panelEl, fabEl, contactEl, typingEl, facialOverlay, quickEl;

  // PROBLEMA 4: permiso de micrófono solicitado una sola vez (en memoria, sin localStorage).
  let micPermission = "unknown"; // "granted" | "denied"
  let micRequested = false;
  let srWarned = false;          // ya se avisó que el navegador no soporta reconocimiento de voz

  function statusChipClass(status) {
    if (status === "Recibido") return "recibido";
    if (status === "En revisión") return "revision";
    if (status === "Observado") return "observado";
    return "aprobado";
  }

  function renderCard(card) {
    const lang = state.language;
    if (card.kind === "requirements") {
      const p = card.procedure;
      const reqs = D.getProcedureRequirements(p, lang).map((r, i) => "<li><strong>" + (i + 1) + ".</strong> " + esc(r) + "</li>").join("");
      return '<div class="nw-card"><div class="nw-eyebrow">' + t(lang, "Requisitos", "Munasqakuna") + '</div>' +
        "<h4>" + esc(D.getProcedureName(p, lang)) + "</h4><ol>" + reqs + "</ol>" +
        '<div class="nw-meta"><span>' + t(lang, "Costo", "Chanin") + ": " + esc(D.getProcedureCost(p, lang)) + "</span>" +
        "<span>" + t(lang, "Plazo", "Pacha") + ": " + esc(D.getProcedureEstimate(p, lang)) + "</span>" +
        '<span class="full">' + t(lang, "Oficina", "Oficina") + ": " + esc(D.getProcedureOffice(p, lang)) + "</span></div>" + simTag(lang) + "</div>";
    }
    if (card.kind === "file-status") {
      const f = card.file;
      const obs = D.getFileObservation(f, lang);
      return '<div class="nw-card"><div class="nw-eyebrow">' + t(lang, "Expediente", "Expediente") + '</div>' +
        '<div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">' +
        "<div><h4>" + esc(f.number) + "</h4><div style=\"color:var(--nw-muted)\">" + esc(D.getFileProcedureName(f, lang)) + "</div></div>" +
        '<span class="nw-chip ' + statusChipClass(f.status) + '">' + esc(D.getFileStatus(f, lang)) + "</span></div>" +
        "<dl><div><dt>" + t(lang, "Fecha de ingreso", "Yaykusqan p'unchay") + "</dt><dd>" + esc(D.getFileDate(f, lang)) + "</dd></div>" +
        "<div><dt>" + t(lang, "Oficina actual", "Kunan oficina") + "</dt><dd>" + esc(D.getFileOffice(f, lang)) + "</dd></div>" +
        '<div class="full"><dt>' + t(lang, "Último movimiento", "Qhipa kuyuy") + "</dt><dd>" + esc(D.getFileLastMovement(f, lang)) + "</dd></div>" +
        (obs ? '<div class="full"><dt>' + t(lang, "Observación", "Qhawarisqa") + "</dt><dd>" + esc(obs) + "</dd></div>" : "") +
        "</dl>" + simTag(lang) + "</div>";
    }
    if (card.kind === "file-list") {
      const rows = card.files.map((f) => '<div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.4rem 0;border-top:1px solid var(--nw-border)">' +
        "<div><strong>" + esc(f.number) + "</strong><div style=\"color:var(--nw-muted);font-size:.85rem\">" + esc(D.getFileProcedureName(f, lang)) + "</div></div>" +
        '<span class="nw-chip ' + statusChipClass(f.status) + '">' + esc(D.getFileStatus(f, lang)) + "</span></div>").join("");
      return '<div class="nw-card"><div class="nw-eyebrow">' + t(lang, "Tus trámites vinculados", "Qampa watasqa ruraynikikuna") + "</div>" + rows + simTag(lang) + "</div>";
    }
    if (card.kind === "summary") {
      const d = card.data, p = card.proc;
      return '<div class="nw-card"><div class="nw-eyebrow">' + t(lang, "Resumen antes de enviar", "Manaraq apachispa pisiyachisqa willakuy") + "</div>" +
        "<dl><div><dt>" + t(lang, "Nombre", "Suti") + "</dt><dd>" + esc(d.fullName || "—") + "</dd></div>" +
        "<div><dt>DNI</dt><dd>" + esc(d.dni || "—") + "</dd></div>" +
        '<div class="full"><dt>' + t(lang, "Trámite", "Ruray") + "</dt><dd>" + esc(D.getProcedureName(p, lang)) + "</dd></div>" +
        '<div class="full"><dt>' + t(lang, "Motivo", "Imarayku") + "</dt><dd>" + esc(d.motivo || "—") + "</dd></div>" +
        "<div><dt>" + t(lang, "Adjunto", "Yapasqa qillqa") + "</dt><dd>" + esc(d.attachment || "—") + "</dd></div>" +
        "<div><dt>" + t(lang, "Identidad", "Identidad") + "</dt><dd>" + t(lang, "Validada para esta demo", "Kay demopaq chiqaqchasqa") + "</dd></div></dl>" + simTag(lang) + "</div>";
    }
    if (card.kind === "receipt") {
      const p = card.proc;
      return '<div class="nw-card"><div class="nw-receipt-head"><div class="nw-eyebrow" style="color:#fff;opacity:.85">' + t(lang, "Constancia simulada", "Demo constancia") + '</div>' +
        '<div class="nw-receipt-num">' + esc(card.fileNumber) + '</div><div>' + esc(D.getProcedureName(p, lang)) + "</div></div>" +
        "<dl><div><dt>" + t(lang, "A nombre de", "Sutipi") + "</dt><dd>" + esc(card.data.fullName || "—") + "</dd></div>" +
        "<div><dt>DNI</dt><dd>" + esc(card.data.dni || "—") + "</dd></div>" +
        "<div><dt>" + t(lang, "Oficina", "Oficina") + "</dt><dd>" + esc(D.getProcedureOffice(p, lang)) + "</dd></div>" +
        "<div><dt>" + t(lang, "Plazo estimado", "Unay pacha") + "</dt><dd>" + esc(D.getProcedureEstimate(p, lang)) + "</dd></div></dl>" + simTag(lang) + "</div>";
    }
    if (card.kind === "notification") {
      const f = card.file;
      return '<div class="nw-card notif"><div class="nw-eyebrow" style="color:var(--nw-info)">' + t(lang, "Novedad simulada", "Demo musuq willakuy") + "</div>" +
        "<h4>" + esc(f.number) + " — " + esc(D.getFileProcedureName(f, lang)) + "</h4>" +
        "<p style=\"color:var(--nw-muted)\">" + t(lang, "Hay una actualización en tu trámite.", "Rurayniykipi musuq willakuy kachkan.") + "</p>" + simTag(lang) + "</div>";
    }
    return "";
  }
  function simTag(lang) { return '<div class="nw-simtag">' + t(lang, "Datos simulados para demostración", "Demo hinalla willakuykuna") + "</div>"; }

  function renderTurn(turn) {
    const row = document.createElement("div");
    if (turn.from === "user") {
      row.className = "nw-row user";
      const b = document.createElement("div");
      b.className = "nw-bubble user";
      b.setAttribute("aria-label", "Tu mensaje");
      const p = document.createElement("p");
      p.textContent = turn.text;
      b.appendChild(p);
      row.appendChild(b);
      return row;
    }
    row.className = "nw-row nawi";
    row.innerHTML = '<div class="nw-avatar" aria-hidden="true">' + ICON.mark + "</div>";
    const wrap = document.createElement("div");
    wrap.className = "nw-bubble nawi";
    wrap.setAttribute("aria-label", "Mensaje de Ñawi");
    const p = document.createElement("p");
    p.textContent = turn.text;
    wrap.appendChild(p);
    if (turn.card) {
      const cardWrap = document.createElement("div");
      cardWrap.innerHTML = renderCard(turn.card);
      while (cardWrap.firstChild) wrap.appendChild(cardWrap.firstChild);
    }
    if (turn.options && turn.options.length) {
      const opts = document.createElement("div");
      opts.className = "nw-options";
      const numbered = turn.step === "menu";  // el menú principal se muestra numerado 1-4
      turn.options.forEach((o, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nw-opt" + (o.tone === "primary" ? " primary" : o.tone === "danger" ? " danger" : o.tone === "success" ? " success" : "");
        const label = numbered ? (i + 1) + ". " + o.label : o.label;
        btn.textContent = label;
        btn.setAttribute("aria-label", label);
        btn.addEventListener("click", () => { stopSpeak(); stopListening(); dispatch({ type: "SELECT", optionId: o.id }); });
        opts.appendChild(btn);
      });
      wrap.appendChild(opts);
    }
    if (turn.whatsappHandoff) {
      const h = turn.whatsappHandoff;
      const lang = h.language === "qu" ? "quechua" : "español";
      const audio = h.voiceMode ? "automático" : "manual";
      const texto = "Hola Ñawi, vengo de la página web. Idioma: " + lang + ". Audio: " + audio + ".";
      const wa = document.createElement("a");
      wa.className = "nw-wa-btn";
      wa.href = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(texto);
      wa.target = "_blank"; wa.rel = "noopener";
      wa.innerHTML = ICON.chat + "<span>Abrir WhatsApp</span>";
      wa.setAttribute("aria-label", "Abrir WhatsApp para continuar con Ñawi");
      wrap.appendChild(wa);
    }
    if (turn.attachUpload) {
      const lab = document.createElement("label");
      lab.className = "nw-filebtn";
      lab.innerHTML = "<span>Subir PDF</span>";
      lab.setAttribute("aria-label", "Subir tu documento en PDF");
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "application/pdf,.pdf"; inp.style.display = "none";
      inp.addEventListener("change", () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { renderNotice("El archivo supera los 10 MB."); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || "");
          sync.attachB64 = res.indexOf("base64,") !== -1 ? res.split("base64,")[1] : "";
          sync.attachNombre = f.name;
          infoBubble("Documento adjunto", "Adjuntaste tu archivo: " + f.name, false);
          dispatch({ type: "SELECT", optionId: "uploaded" });
        };
        reader.readAsDataURL(f);
      });
      lab.appendChild(inp);
      wrap.appendChild(lab);
    }
    if (caps.tts) {
      const bar = document.createElement("div");
      bar.className = "nw-audiobar";
      wrap.appendChild(bar);
      audioBars[turn.id] = { el: bar, turn: turn };
      fillAudioBar(turn.id);
    }
    row.appendChild(wrap);
    return row;
  }

  // Barra de audio por burbuja: nunca más de 2 botones, según el estado de reproducción.
  function fillAudioBar(turnId) {
    const entry = audioBars[turnId];
    if (!entry) return;
    const el = entry.el, turn = entry.turn;
    el.innerHTML = "";
    const active = audioTurnId === turnId;
    if (active && audioState === "playing") {
      el.appendChild(audioBtn("Pausar", ICON.pause, () => pauseAudio(turn)));
      el.appendChild(audioBtn("Detener", ICON.stop, () => stopAudio(turn)));
    } else if (active && audioState === "paused") {
      el.appendChild(audioBtn("Continuar", ICON.play, () => resumeAudio(turn)));
      el.appendChild(audioBtn("Detener", ICON.stop, () => stopAudio(turn)));
    } else if (!state.voiceMode) {
      // Modo manual: solo "Escuchar" en reposo. En modo automático no se muestran
      // botones en reposo (Ñawi habla sola).
      el.appendChild(audioBtn("Escuchar", ICON.speaker, () => startAudio(turn, false)));
    }
  }

  function startAudio(turn, autoListen) {
    if (audioTurnId && audioTurnId !== turn.id) {
      const prev = audioTurnId; audioTurnId = null; audioState = "idle"; playedTurns[prev] = true; fillAudioBar(prev);
    }
    audioTurnId = turn.id; audioState = "playing"; fillAudioBar(turn.id);
    playText(turn.spoken || turn.text, () => {
      const wasActive = audioTurnId === turn.id;
      playedTurns[turn.id] = true;
      if (wasActive) { audioTurnId = null; audioState = "idle"; }
      fillAudioBar(turn.id);
      if (autoListen && wasActive && state.voiceMode && caps.sr && !state.facialModuleOpen) {
        setTimeout(() => listen((txt) => dispatch({ type: "SUBMIT_TEXT", text: txt })), 250);
      }
    });
  }
  function pauseAudio(turn) { pauseSpeak(); audioState = "paused"; fillAudioBar(turn.id); }
  function resumeAudio(turn) { resumeSpeak(); audioState = "playing"; fillAudioBar(turn.id); }
  function stopAudio(turn) { stopSpeak(); playedTurns[turn.id] = true; audioTurnId = null; audioState = "idle"; fillAudioBar(turn.id); }
  function audioBtn(label, icon, fn) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "nw-audiobtn";
    b.setAttribute("aria-label", label + " audio");
    b.innerHTML = icon + "<span>" + label + "</span>";
    b.addEventListener("click", fn);
    return b;
  }

  function render() {
    for (let i = renderedCount; i < state.turns.length; i++) {
      msgsEl.appendChild(renderTurn(state.turns[i]));
    }
    renderedCount = state.turns.length;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function autoSpeak() {
    let last = null;
    for (let i = state.turns.length - 1; i >= 0; i--) { if (state.turns[i].from === "nawi") { last = state.turns[i]; break; } }
    if (!last || last.id === lastSpokenId) return;
    lastSpokenId = last.id;
    // El selector de idioma se lee SIEMPRE (en ambos idiomas), aunque el usuario aún no
    // haya elegido preferencia de audio. En el resto, solo si voiceMode está activo.
    const forceIntro = state.step === "language";
    if (caps.tts && (state.voiceMode || forceIntro)) {
      startAudio(last, state.voiceMode);
    }
  }

  function updateTyping() {
    if (!typingEl) return;
    typingEl.hidden = !isSpeaking;
    updateInputBar();
  }
  function updateMicBtn() {
    if (!micBtn) return;
    micBtn.classList.toggle("listening", listening);
    micBtn.setAttribute("aria-pressed", String(listening));
    micBtn.setAttribute("aria-label", listening ? "Detener micrófono" : "Activar micrófono");
    updateInputBar();
  }

  // PROBLEMA 4: pedir permiso de micrófono una sola vez.
  function ensureMicPermission() {
    if (micRequested) return;
    micRequested = true;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      // Sin getUserMedia (p. ej. al abrir como file://): no se puede usar micrófono.
      micPermission = "denied";
      afterPermission();
      return;
    }
    md.getUserMedia({ audio: true }).then((stream) => {
      micPermission = "granted";
      stream.getTracks().forEach((tr) => tr.stop()); // SpeechRecognition gestiona su propio audio
      afterPermission();
    }).catch(() => {
      micPermission = "denied";
      afterPermission();
    });
  }
  function afterPermission() {
    if (micPermission === "denied") {
      renderNotice("No se pudo acceder al micrófono. Puedes escribir tus respuestas.");
      if (state.voiceMode) dispatch({ type: "SET_VOICE_MODE", voiceMode: false });
    }
    updateInputBar();
  }
  function renderNotice(text) {
    if (!msgsEl) return;
    const n = document.createElement("div");
    n.className = "nw-notice";
    n.setAttribute("role", "status");
    n.textContent = text;
    msgsEl.appendChild(n);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function setVoiceStatus(text) {
    if (!voiceStatusEl) return;
    voiceStatusEl.textContent = text || "";
    voiceStatusEl.hidden = !text;
  }

  // PROBLEMA 3: estado de la barra de entrada según voiceMode / habla / escucha.
  function updateInputBar() {
    if (!inputEl || !micBtn || !sendBtn) return;
    const auto = state.voiceMode;
    const srUsable = caps.sr && micPermission !== "denied";
    // "Cancelar voz" visible solo cuando es turno del usuario con voz activa.
    if (cancelVoiceBtn) cancelVoiceBtn.style.display = (auto && !isSpeaking && srUsable) ? "" : "none";

    if (backendBusy > 0) {
      // Hay una consulta al backend en curso: bloqueamos la escritura hasta que cargue.
      inputEl.style.display = ""; inputEl.disabled = true;
      inputEl.setAttribute("placeholder", "Consultando, espera un momento…");
      micBtn.style.display = "none"; sendBtn.style.display = "none";
      if (cancelVoiceBtn) cancelVoiceBtn.style.display = "none";
      setVoiceStatus("Consultando en el sistema del GORE…");
      return;
    }
    inputEl.setAttribute("placeholder", "Escribe o usa la voz…");

    if (!auto) {
      // Manual: textarea y micrófono presionable siempre disponibles.
      inputEl.style.display = ""; inputEl.disabled = false;
      micBtn.style.display = ""; micBtn.disabled = !caps.sr; micBtn.classList.remove("indicator");
      sendBtn.style.display = "";
      setVoiceStatus("");
      return;
    }
    if (isSpeaking) {
      // Ñawi hablando: textarea desactivado, sin micrófono ni enviar (el indicador de
      // puntos "Ñawi está hablando…" ya es visible).
      inputEl.style.display = ""; inputEl.disabled = true;
      micBtn.style.display = "none";
      sendBtn.style.display = "none";
      setVoiceStatus("");
    } else if (srUsable) {
      // Turno del usuario: el micrófono es un INDICADOR animado, no un botón.
      inputEl.style.display = "none"; inputEl.disabled = true;
      micBtn.style.display = ""; micBtn.disabled = true; micBtn.classList.add("indicator");
      sendBtn.style.display = "none";
      setVoiceStatus(listening ? "Escuchando tu respuesta…" : "Tu turno de hablar");
    } else {
      // Automático pero sin micrófono utilizable: fallback a texto.
      inputEl.style.display = ""; inputEl.disabled = false;
      micBtn.style.display = "none";
      sendBtn.style.display = "";
      setVoiceStatus("Micrófono no disponible. Escribe tu respuesta.");
    }
  }

  // PROBLEMA 5: comandos de navegación contextuales (no siempre visibles).
  const CANCEL_STEPS = ["privacy", "ask-name", "confirm-name", "ask-dni", "confirm-dni",
    "identity-summary", "show-requirements", "ask-motivo", "ask-attachment", "final-summary", "correct-attach"];
  function quickCmdsForStep() {
    const step = state.step;
    if (step === "language") return [];                  // paso inicial: sin barra
    const cmds = [];
    cmds.push(["Repetir", "repetir"]);                   // hay un mensaje de Ñawi previo
    if (state.history && state.history.length > 0) cmds.push(["Volver atrás", "volver atrás"]);
    if (step !== "welcome") cmds.push(["Menú", "menú"]); // siempre salvo language y welcome
    if (CANCEL_STEPS.indexOf(step) !== -1) cmds.push(["Cancelar", "cancelar"]);
    cmds.push(["Hablar con una persona", "hablar con una persona"]); // siempre salvo language
    return cmds;
  }
  function updateQuickBar() {
    if (!quickEl) return;
    quickEl.innerHTML = "";
    const cmds = quickCmdsForStep();
    cmds.forEach((pair) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = pair[0];
      b.addEventListener("click", () => dispatch({ type: "SUBMIT_TEXT", text: pair[1] }));
      quickEl.appendChild(b);
    });
    quickEl.hidden = cmds.length === 0;
  }

  // ---------------- Módulo de validación facial ----------------
  let facialOpen = false;
  const FACE_TEXT = {
    FACE_NOTICE: "Validación de identidad. En el sistema final, tu rostro se compararía con la base biométrica de RENIEC, con tu consentimiento y bajo la Ley 29733. En esta demostración es una maqueta: no se compara con RENIEC ni se guardan imágenes ni datos biométricos.",
    FACE_POSITIONING: "Acomoda tu rostro dentro del recuadro. Permanece quieto unos segundos.",
    FACE_DETECTED: "Rostro detectado. Permanece quieto para la prueba de vida.",
    FACE_LIVENESS: "Parpadea para completar la prueba de vida.",
    FACE_SUCCESS: "Identidad validada para esta demo.",
    FACE_FAILED: "No se pudo validar tu identidad en esta demo. Puedes reintentar, usar PIN simulado o hablar con una persona.",
    FACE_CANCEL_CONFIRM: "Si cancelas, no podré continuar con este trámite personal.",
    FACE_PIN: "Usaremos un PIN simulado para esta demo. PIN demo: 1234.",
    FACE_PIN_FAILED: "PIN incorrecto. Por seguridad, no mostraré información personal.",
  };
  let faceStage = "FACE_NOTICE", facePin = "", faceTimers = [];
  function faceClearTimers() { faceTimers.forEach((id) => clearTimeout(id)); faceTimers = []; }
  function faceAnnounce(s) { if (state.voiceMode) playText(s); }

  function openFacial() {
    facialOpen = true;
    faceStage = "FACE_NOTICE"; facePin = ""; faceClearTimers();
    facialOverlay.hidden = false;
    renderFacial();
    faceAnnounce(FACE_TEXT.FACE_NOTICE);
    const first = facialOverlay.querySelector("button, input");
    if (first) first.focus();
  }
  function closeFacial() { facialOpen = false; faceClearTimers(); facialOverlay.hidden = true; }

  function faceGo(stage) { faceStage = stage; renderFacial(); faceAnnounce(FACE_TEXT[stage]); }
  function faceStartSim() {
    faceClearTimers(); faceGo("FACE_POSITIONING");
    [["FACE_DETECTED", 2200], ["FACE_LIVENESS", 4200], ["FACE_SUCCESS", 6500]].forEach((pair) => {
      faceTimers.push(setTimeout(() => faceGo(pair[0]), pair[1]));
    });
  }
  function faceSubmitPin() {
    if (facePin === "1234") { closeFacial(); dispatch({ type: "FACIAL_PIN_SUCCESS" }); return; }
    faceGo("FACE_PIN_FAILED");
  }

  function faceActions() {
    const camStages = ["FACE_NOTICE", "FACE_POSITIONING", "FACE_DETECTED", "FACE_LIVENESS", "FACE_SUCCESS", "FACE_FAILED"];
    const wrap = document.createElement("div");
    wrap.className = "nw-facial-actions";
    const add = (label, cls, fn) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "nw-opt" + (cls ? " " + cls : "");
      b.textContent = label; b.setAttribute("aria-label", label); b.addEventListener("click", fn); wrap.appendChild(b);
    };
    if (faceStage === "FACE_NOTICE") {
      add("Iniciar validación simulada", "primary", faceStartSim);
      add("Simular validación exitosa", "success", () => faceGo("FACE_SUCCESS"));
      add("Simular fallo", "", () => faceGo("FACE_FAILED"));
      add("Usar PIN alternativo", "", () => faceGo("FACE_PIN"));
      add("Cancelar validación", "danger", () => faceGo("FACE_CANCEL_CONFIRM"));
    } else if (faceStage === "FACE_POSITIONING" || faceStage === "FACE_DETECTED" || faceStage === "FACE_LIVENESS") {
      add("Simular validación exitosa", "success", () => faceGo("FACE_SUCCESS"));
      add("Simular fallo", "", () => faceGo("FACE_FAILED"));
      add("Cancelar", "danger", () => faceGo("FACE_CANCEL_CONFIRM"));
    } else if (faceStage === "FACE_SUCCESS") {
      add("Continuar", "primary", () => { closeFacial(); dispatch({ type: "FACIAL_RESULT", success: true }); });
    } else if (faceStage === "FACE_FAILED") {
      add("Reintentar validación", "primary", faceStartSim);
      add("Usar PIN alternativo", "", () => faceGo("FACE_PIN"));
      add("Volver atrás", "", () => { closeFacial(); dispatch({ type: "FACIAL_RESULT", success: false }); });
      add("Hablar con una persona", "", () => { closeFacial(); dispatch({ type: "FACIAL_RESULT", success: false }); });
    } else if (faceStage === "FACE_CANCEL_CONFIRM") {
      add("Sí, cancelar validación", "danger", () => { closeFacial(); dispatch({ type: "FACIAL_CANCEL" }); });
      add("No, continuar validación", "primary", () => faceGo("FACE_NOTICE"));
    }
    return { wrap, isCam: camStages.indexOf(faceStage) !== -1 };
  }

  function renderFacial() {
    const body = facialOverlay.querySelector(".nw-facial-body");
    body.innerHTML = "";
    const note = document.createElement("p");
    note.className = "nw-facial-note";
    note.textContent = "Maqueta de demostración. En el sistema final se compararía con RENIEC (Ley 29733); aquí no se compara con RENIEC ni se guardan imágenes o datos biométricos.";
    body.appendChild(note);

    const acts = faceActions();
    if (acts.isCam) {
      const cls = { FACE_POSITIONING: "positioning", FACE_DETECTED: "detected", FACE_LIVENESS: "liveness", FACE_SUCCESS: "success", FACE_FAILED: "failed" }[faceStage] || "";
      const pulse = (faceStage === "FACE_NOTICE" || faceStage === "FACE_POSITIONING") ? " nw-pulse" : "";
      const scan = (faceStage === "FACE_DETECTED" || faceStage === "FACE_LIVENESS") ? '<div class="nw-scan"></div>' : "";
      const cam = document.createElement("div");
      cam.className = "nw-cam " + cls;
      cam.innerHTML = '<div class="nw-cam-tag">' + esc(FACE_LABEL[faceStage] || "") + '</div>' + scan +
        '<div class="nw-cam-oval' + pulse + '">' + ICON.face + "</div>";
      body.appendChild(cam);
    }

    if (faceStage === "FACE_PIN" || faceStage === "FACE_PIN_FAILED") {
      const lab = document.createElement("label");
      lab.setAttribute("for", "nw-pin-input");
      lab.style.cssText = "display:block;margin:.8rem 0 .4rem;font-weight:600";
      lab.textContent = "Ingresa el PIN simulado (demo: 1234)";
      body.appendChild(lab);
      const inp = document.createElement("input");
      inp.id = "nw-pin-input"; inp.className = "nw-pin"; inp.inputMode = "numeric"; inp.maxLength = 4;
      inp.setAttribute("aria-label", "PIN simulado de 4 dígitos"); inp.value = facePin;
      inp.addEventListener("input", () => { facePin = inp.value.replace(/\D/g, "").slice(0, 4); });
      body.appendChild(inp);
      if (faceStage === "FACE_PIN_FAILED") {
        const err = document.createElement("p"); err.className = "nw-facial-instr"; err.style.color = "var(--nw-danger)";
        err.textContent = FACE_TEXT.FACE_PIN_FAILED; body.appendChild(err);
      }
      const row = document.createElement("div"); row.className = "nw-facial-actions";
      const validar = document.createElement("button"); validar.type = "button"; validar.className = "nw-opt primary";
      validar.textContent = "Validar PIN"; validar.addEventListener("click", faceSubmitPin); row.appendChild(validar);
      const reint = document.createElement("button"); reint.type = "button"; reint.className = "nw-opt";
      reint.textContent = "Reintentar validación facial"; reint.addEventListener("click", () => faceGo("FACE_POSITIONING")); row.appendChild(reint);
      const persona = document.createElement("button"); persona.type = "button"; persona.className = "nw-opt";
      persona.textContent = "Hablar con una persona"; persona.addEventListener("click", () => { closeFacial(); dispatch({ type: "FACIAL_CANCEL" }); }); row.appendChild(persona);
      body.appendChild(row);
    } else {
      const instr = document.createElement("p");
      instr.className = "nw-facial-instr"; instr.setAttribute("aria-live", "polite");
      instr.textContent = FACE_TEXT[faceStage];
      body.appendChild(instr);
      if (state.collected.fullName && faceStage !== "FACE_CANCEL_CONFIRM") {
        const link = document.createElement("p"); link.className = "nw-facial-note";
        link.textContent = "Vinculando a: " + state.collected.fullName + (state.collected.dni ? " · DNI " + state.collected.dni : "");
        body.appendChild(link);
      }
      body.appendChild(acts.wrap);
    }
  }
  const FACE_LABEL = {
    FACE_NOTICE: "Listo para iniciar", FACE_POSITIONING: "Buscando rostro…", FACE_DETECTED: "Rostro detectado",
    FACE_LIVENESS: "Prueba de vida en curso", FACE_SUCCESS: "Identidad validada", FACE_FAILED: "No validado",
  };

  function syncFacial() {
    if (state.facialModuleOpen && !facialOpen) openFacial();
    else if (!state.facialModuleOpen && facialOpen) closeFacial();
  }

  // ---------------- Shell del widget ----------------
  function openChat(opener, target) {
    openerEl = opener || fabEl;
    primeAudio(); // abrir el chat es un gesto del usuario: desbloquea el audio para el auto-play
    contactEl.hidden = true; fabEl.setAttribute("aria-expanded", "false");
    panelEl.hidden = false; panelOpen = true;
    // Al elegir un canal, arrancamos el onboarding desde cero con ese canal destino.
    dispatch({ type: "SET_TARGET_CHANNEL", targetChannel: target || "web" });
    dispatch({ type: "RESET" });
    updateQuickBar();
    updateInputBar();
    inputEl.focus();
  }
  function closeChat() {
    panelEl.hidden = true; panelOpen = false; stopSpeak(); stopListening();
    if (openerEl && openerEl.focus) openerEl.focus(); else fabEl.focus();
  }
  function sendInput() {
    const v = (inputEl.value || "").trim();
    if (!v) return;
    inputEl.value = "";
    stopSpeak(); stopListening();
    // TODO(backend): si el paso actual espera texto libre, aquí iría POST /webhook
    dispatch({ type: "SUBMIT_TEXT", text: v });
  }

  function buildPanel() {
    panelEl = document.createElement("div");
    panelEl.className = "nw-panel"; panelEl.id = "nw-panel"; panelEl.hidden = true;
    panelEl.setAttribute("role", "dialog"); panelEl.setAttribute("aria-modal", "true"); panelEl.setAttribute("aria-label", "Chat con Ñawi");
    panelEl.innerHTML =
      '<div class="nw-head"><div class="nw-id"><span class="nw-mark" aria-hidden="true">' + ICON.mark + '</span>' +
      '<div><div class="nw-title">Ñawi · GORE Cusco</div><div class="nw-sub">Agente digital · Canal Web</div></div></div>' +
      '<div class="nw-head-actions">' +
      '<button type="button" class="nw-iconbtn" id="nw-close" aria-label="Cerrar chat">' + ICON.close + '</button></div></div>' +
      '<div class="nw-msgs" id="nw-msgs" role="log" aria-live="polite" aria-label="Conversación con Ñawi"></div>' +
      '<div class="nw-inputbar">' +
      '<div class="nw-typing" id="nw-typing" aria-live="polite" hidden><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>Ñawi está hablando…</span></div>' +
      '<div class="nw-inputrow">' +
      '<button type="button" class="nw-circlebtn" id="nw-mic" aria-label="Activar micrófono" aria-pressed="false">' + ICON.mic + '</button>' +
      '<span id="nw-voicestatus" class="nw-voicestatus" aria-live="polite" hidden></span>' +
      '<button type="button" class="nw-voicecancel" id="nw-voicecancel" aria-label="Cancelar voz y escribir" hidden></button>' +
      '<label class="sr-only" for="nw-input">Escribe tu respuesta a Ñawi</label>' +
      '<textarea id="nw-input" class="nw-input" rows="1" placeholder="Escribe o usa la voz…"></textarea>' +
      '<button type="button" class="nw-circlebtn send" id="nw-send" aria-label="Enviar mensaje">' + ICON.send + '</button></div>' +
      '<div class="nw-quick" id="nw-quick"></div></div>';
    document.body.appendChild(panelEl);

    msgsEl = panelEl.querySelector("#nw-msgs");
    inputEl = panelEl.querySelector("#nw-input");
    micBtn = panelEl.querySelector("#nw-mic");
    sendBtn = panelEl.querySelector("#nw-send");
    voiceStatusEl = panelEl.querySelector("#nw-voicestatus");
    cancelVoiceBtn = panelEl.querySelector("#nw-voicecancel");
    cancelVoiceBtn.innerHTML = ICON.close + "<span>Cancelar voz</span>";
    cancelVoiceBtn.addEventListener("click", () => { stopListening(); dispatch({ type: "SET_VOICE_MODE", voiceMode: false }); });
    typingEl = panelEl.querySelector("#nw-typing");

    panelEl.querySelector("#nw-close").addEventListener("click", closeChat);
    panelEl.querySelector("#nw-send").addEventListener("click", sendInput);
    inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendInput(); } });
    micBtn.addEventListener("click", () => { if (listening) stopListening(); else listen((txt) => dispatch({ type: "SUBMIT_TEXT", text: txt })); });
    micBtn.disabled = !caps.sr;

    quickEl = panelEl.querySelector("#nw-quick");
    updateQuickBar();

    // Focus trap + Escape
    panelEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeChat(); return; }
      if (e.key !== "Tab") return;
      const f = Array.prototype.filter.call(panelEl.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'),
        (el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    });
  }

  function buildFab() {
    const wrap = document.createElement("div");
    wrap.className = "nw-fab-wrap";
    wrap.innerHTML =
      '<div class="nw-contact" id="nw-contact" role="menu" aria-label="Opciones de contacto con Ñawi" hidden>' +
      '<button type="button" role="menuitem" id="nw-c-chat">Chat web</button>' +
      '<button type="button" role="menuitem" id="nw-c-wa">WhatsApp</button>' +
      '<button type="button" role="menuitem" id="nw-c-call">Llamar</button></div>' +
      '<button type="button" class="nw-fab" id="nw-fab" aria-label="Abrir opciones de contacto con Ñawi" aria-haspopup="true" aria-expanded="false">' +
      ICON.chat + '<span class="nw-fab-texto">Hablar con Ñawi</span></button>';
    document.body.appendChild(wrap);
    fabEl = wrap.querySelector("#nw-fab");
    contactEl = wrap.querySelector("#nw-contact");
    let menuOpen = false;
    function toggle() { menuOpen = !menuOpen; contactEl.hidden = !menuOpen; fabEl.setAttribute("aria-expanded", String(menuOpen)); }
    fabEl.addEventListener("click", toggle);
    document.addEventListener("click", (e) => { if (menuOpen && !wrap.contains(e.target)) { menuOpen = false; contactEl.hidden = true; fabEl.setAttribute("aria-expanded", "false"); } });
    wrap.querySelector("#nw-c-chat").addEventListener("click", () => { menuOpen = false; openChat(fabEl, "web"); });
    wrap.querySelector("#nw-c-wa").addEventListener("click", () => { menuOpen = false; openChat(fabEl, "whatsapp"); });
    wrap.querySelector("#nw-c-call").addEventListener("click", () => { menuOpen = false; contactEl.hidden = true; openCall(); });
  }

  // ---------------- Maqueta de atención por llamada (IVR) ----------------
  // Esta función NO está incluida en la demo; aquí se simula cómo sería el flujo final,
  // reutilizando el mismo motor de Ñawi (igual idea que la validación facial maqueta).
  let callOverlay = null;
  let callTimers = [];
  const CALL_SCRIPT = [
    { who: "sys", text: "Llamas al número de Ñawi: (084) 000-000." },
    { who: "nawi", text: "Bienvenido a Ñawi, del Gobierno Regional de Cusco. Te atiendo por voz." },
    { who: "nawi", text: "¿En qué idioma prefieres continuar, español o quechua?" },
    { who: "user", text: "(Respondes por voz: español.)" },
    { who: "nawi", text: "Para validar tu identidad, di tu número de DNI después del tono." },
    { who: "user", text: "(Dices tu DNI; Ñawi lo transcribe con reconocimiento de voz.)" },
    { who: "nawi", text: "Te envié un código por mensaje. Tecléalo en tu teléfono para confirmar." },
    { who: "user", text: "(Tecleas el código de un solo uso en el teclado del teléfono.)" },
    { who: "nawi", text: "Identidad validada. ¿Qué deseas hacer? Di: requisitos, iniciar trámite, o estado de mi expediente." },
    { who: "sys", text: "A partir de aquí, el flujo es el mismo que en WhatsApp y la web." },
  ];

  function buildCall() {
    callOverlay = document.createElement("div");
    callOverlay.className = "nw-facial-overlay"; callOverlay.hidden = true;
    callOverlay.innerHTML =
      '<div class="nw-facial" role="dialog" aria-modal="true" aria-label="Atención por llamada (maqueta)">' +
      '<div class="nw-facial-head"><strong>Atención por llamada · maqueta</strong>' +
      '<button type="button" class="nw-iconbtn" id="nw-call-close" aria-label="Cerrar">' + ICON.close + '</button></div>' +
      '<div class="nw-facial-body" id="nw-call-body"></div></div>';
    document.body.appendChild(callOverlay);
    callOverlay.querySelector("#nw-call-close").addEventListener("click", closeCall);
  }
  function closeCall() {
    if (callOverlay) callOverlay.hidden = true;
    callTimers.forEach((t) => clearTimeout(t)); callTimers = [];
    try { stopSpeak(); } catch (e) {}
  }
  function openCall() {
    if (!callOverlay) buildCall();
    callTimers.forEach((t) => clearTimeout(t)); callTimers = [];
    callOverlay.hidden = false;
    const body = callOverlay.querySelector("#nw-call-body");
    body.innerHTML = "";
    const note = document.createElement("p");
    note.className = "nw-facial-note";
    note.textContent = "La atención por llamada (IVR) no está incluida en esta demostración. " +
      "Aquí ves cómo sería el flujo final, accesible y 100% por voz, reutilizando el mismo motor de Ñawi.";
    body.appendChild(note);
    const log = document.createElement("div");
    log.className = "nw-call-log"; body.appendChild(log);
    const playBtn = document.createElement("button");
    playBtn.type = "button"; playBtn.className = "nw-opt primary";
    playBtn.textContent = "Reproducir simulación";
    playBtn.addEventListener("click", () => { primeAudio(); playBtn.disabled = true; callPlay(log, 0); });
    body.appendChild(playBtn);
  }
  function callPlay(log, i) {
    if (i === 0) log.innerHTML = "";
    if (i >= CALL_SCRIPT.length) return;
    const step = CALL_SCRIPT[i];
    const row = document.createElement("div");
    row.className = "nw-call-row " + step.who;
    const quien = step.who === "nawi" ? "Ñawi: " : step.who === "user" ? "Ciudadano: " : "";
    row.textContent = quien + step.text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    if (step.who === "nawi") {
      // Lee en voz la línea de Ñawi y avanza recién cuando termina de hablar.
      playText(step.text, () => { callTimers.push(setTimeout(() => callPlay(log, i + 1), 350)); });
    } else {
      callTimers.push(setTimeout(() => callPlay(log, i + 1), 1300));
    }
  }

  function buildFacial() {
    facialOverlay = document.createElement("div");
    facialOverlay.className = "nw-facial-overlay"; facialOverlay.hidden = true;
    facialOverlay.innerHTML =
      '<div class="nw-facial" role="dialog" aria-modal="true" aria-label="Validación de identidad (maqueta de RENIEC)">' +
      '<div class="nw-facial-head"><strong>Validación de identidad · maqueta RENIEC</strong>' +
      '<button type="button" class="nw-iconbtn" id="nw-face-close" aria-label="Cerrar módulo de validación">' + ICON.close + '</button></div>' +
      '<div class="nw-facial-body"></div></div>';
    document.body.appendChild(facialOverlay);
    facialOverlay.querySelector("#nw-face-close").addEventListener("click", () => faceGo("FACE_CANCEL_CONFIRM"));
  }

  // ---------------- Arranque ----------------
  function init() {
    buildFab();
    buildPanel();
    buildFacial();
    // Permite abrir el chat desde las tarjetas de la landing.
    window.NawiOpenChat = (opener) => openChat(opener);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
