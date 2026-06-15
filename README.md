# Ñawi — Frontend (micrositio + chat web)

Micrositio accesible (WCAG 2.2 AA) con el asistente Ñawi embebido como widget de chat. Es
**HTML + CSS + JavaScript puro** (sin frameworks ni build). Funciona servido como estático.

## Cómo correrlo

```bash
# Desde la raíz del proyecto
python -m http.server 5500 --directory web
# Abrir http://localhost:5500/
```

Requiere el **backend** corriendo en `http://localhost:8000` (la URL se autodetecta: en
localhost usa el backend local; desplegado usa `PROD_BACKEND`, ver `chat-widget.js`).

## Archivos y para qué sirven

| Archivo | Qué hace |
|---|---|
| `index.html` | La página (landing) y carga de los scripts en orden. |
| `styles.css` | Estilos del micrositio (landing). |
| `chat.css` | Estilos del **widget de chat** (panel, botones, burbujas, módulo facial, botón de WhatsApp, etc.). |
| `nawi-data.js` | **Datos**: trámites demo, **dependencias reales** del GORE, tipos de documento comunes, ciudadano de prueba. Expone `window.NawiData`. |
| `nawi-intents.js` | Utilidades de **intención**: `matchOption`, `extractDni`, `extractFileNumber`, `classifyGlobal`. Expone `window.NawiIntents`. |
| `nawi-engine.js` | El **motor conversacional**: máquina de estados (reducer) con todos los pasos del flujo (idioma → audio → identidad → menú → requisitos / iniciar trámite / estado). Expone `window.NawiEngine`. **No hace red** (es puro). |
| `chat-widget.js` | El **widget**: renderiza la conversación, voz (TTS/STT del navegador), módulo de **validación facial (maqueta)**, y la **capa de conexión al backend** (RAG real, QELLQA, Supabase, validación de DNI, subir PDF, handoff a WhatsApp). |

## Flujo (resumen)

1. El usuario elige un **canal** (Chat web / WhatsApp) en el botón flotante.
2. **Onboarding** común: idioma (es/qu) → preferencia de audio → **validación de identidad**
   (nombre → DNI → RENIEC vía backend → facial maqueta).
3. Según el canal:
   - **Web**: continúa al menú (requisitos / iniciar trámite / estado).
   - **WhatsApp**: muestra el botón "Abrir WhatsApp" con las preferencias en el mensaje.

## Notas

- El motor (`nawi-engine.js`) es síncrono; las llamadas al backend (RAG, QELLQA, Supabase)
  se hacen en la capa async de `chat-widget.js`.
- La **validación facial** es una **maqueta** del flujo biométrico de RENIEC (no compara con
  RENIEC ni guarda imágenes). La validación real de identidad es por **DNI contra RENIEC**.
- No se usa `localStorage`: el estado vive en memoria durante la sesión.
- Al desplegar: reemplazar `PROD_BACKEND` en `chat-widget.js` por la URL del backend.
# web
