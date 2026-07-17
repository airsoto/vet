const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const VERSION = "7.1.0";
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_LEARNING_MODEL = "gemini-3.1-flash-lite";
const ECG_FALLBACK_MODELS = ["gemini-3.1-flash-lite"];
const LEARNING_FALLBACK_MODELS = ["gemini-3.5-flash"];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_BODY = 1_800_000;
const MAX_CLINICAL_CONTENT = 180_000;
const MAX_TRANSLATION_CHARS = 55_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      return json({
        ok: true,
        service: "Gemini veterinario: ECG y aprendizaje 2MVC",
        version: VERSION,
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        learningModel: env.GEMINI_LEARNING_MODEL || DEFAULT_LEARNING_MODEL,
        actions: ["interpret_ecg", "study_summary", "quiz", "translate_batch"]
      }, 200, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405, cors);
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origen no autorizado" }, 403, cors);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "Falta el secreto GEMINI_API_KEY" }, 500, cors);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY) {
      return json({ error: "Solicitud demasiado grande" }, 413, cors);
    }

    const started = Date.now();
    const analysisId = crypto.randomUUID();

    try {
      const input = await request.json();
      const action = normalizeAction(input?.action);
      const task = prepareTask(action, input);

      const models = action === "interpret_ecg"
        ? unique([env.GEMINI_MODEL || DEFAULT_MODEL, ...ECG_FALLBACK_MODELS])
        : unique([env.GEMINI_LEARNING_MODEL || DEFAULT_LEARNING_MODEL, ...LEARNING_FALLBACK_MODELS]);

      const payload = {
        contents: [{
          role: "user",
          parts: [{ text: task.prompt }]
        }],
        generationConfig: {
          temperature: task.temperature,
          maxOutputTokens: task.maxOutputTokens,
          thinkingConfig: {
            thinkingLevel: task.thinkingLevel
          },
          responseMimeType: "application/json",
          responseSchema: task.schema
        }
      };

      const result = await callWithFallback(models, payload, env.GEMINI_API_KEY);
      if (!result.ok) {
        return json({
          error: action === "interpret_ecg"
            ? "Gemini no pudo interpretar el trazado confirmado"
            : "Gemini no pudo generar el contenido docente",
          action,
          status: result.status,
          attemptedModels: result.attemptedModels,
          analysisId,
          version: VERSION
        }, normalizeStatus(result.status), cors);
      }

      const text = result.raw?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        return json({
          error: "Gemini no devolvió contenido",
          action,
          analysisId,
          model: result.model,
          version: VERSION
        }, 502, cors);
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({
          error: "Gemini devolvió JSON no válido",
          action,
          analysisId,
          model: result.model,
          version: VERSION
        }, 502, cors);
      }

      const safe = sanitizeTaskResult(action, parsed);
      safe.meta = {
        action,
        model: result.model,
        attemptedModels: result.attemptedModels,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        analysisId,
        version: VERSION,
        disclaimer: action === "interpret_ecg"
          ? "Interpretación orientativa basada en un trazado confirmado por el veterinario. No incluye tratamiento."
          : "Material docente generado exclusivamente a partir del capítulo enviado. Debe contrastarse con la fuente original."
      };

      return json({ success: true, result: safe }, 200, cors);
    } catch (error) {
      return json({
        error: clean(error?.message || "Error interno", 400),
        analysisId,
        version: VERSION
      }, 400, cors);
    }
  }
};

function normalizeAction(action) {
  if (!action || action === "interpret-confirmed-trace") return "interpret_ecg";
  if (["interpret_ecg", "study_summary", "quiz", "translate_batch"].includes(action)) return action;
  throw new Error("Acción no válida");
}

function prepareTask(action, input) {
  if (action === "interpret_ecg") {
    validateEcgInput(input);
    return {
      prompt: buildEcgPrompt(input),
      schema: ecgResponseSchema(),
      temperature: 0.1,
      maxOutputTokens: 6500,
      thinkingLevel: "low"
    };
  }

  if (action === "translate_batch") {
    validateTranslationInput(input);
    return {
      prompt: buildTranslationPrompt(input),
      schema: translationResponseSchema(),
      temperature: 0,
      maxOutputTokens: 7000,
      thinkingLevel: "minimal"
    };
  }

  validateLearningInput(input);
  if (action === "study_summary") {
    return {
      prompt: buildStudyPrompt(input),
      schema: studyResponseSchema(),
      temperature: 0.1,
      maxOutputTokens: 5200,
      thinkingLevel: "minimal"
    };
  }

  return {
    prompt: buildQuizPrompt(input),
    schema: quizResponseSchema(),
    temperature: 0.18,
    maxOutputTokens: 6500,
    thinkingLevel: "minimal"
  };
}


function validateTranslationInput(input) {
  if (!input || typeof input !== "object") throw new Error("Solicitud de traducción vacía");
  if (!Array.isArray(input.strings) || input.strings.length === 0) {
    throw new Error("Faltan textos para traducir");
  }
  if (input.strings.length > 80) throw new Error("Demasiados textos en un lote");
  const total = input.strings.reduce((sum, item) => sum + String(item || "").length, 0);
  if (total > MAX_TRANSLATION_CHARS) throw new Error("Lote de traducción demasiado grande");
}

function buildTranslationPrompt(input) {
  const strings = input.strings.map(item => clean(item, 12000));
  return `
Eres un traductor médico-veterinario profesional.
Traduce del inglés al español todos los elementos del array de entrada.

REGLAS OBLIGATORIAS
1. Devuelve exactamente el mismo número de elementos y en el mismo orden.
2. Traduce todo el contenido clínico al español natural y científico.
3. Conserva exactamente nombres propios, nombres comerciales, abreviaturas, símbolos, dosis, cifras, unidades, vías y frecuencias.
4. No resumas, no expliques, no añadas información y no elimines contenido.
5. Conserva viñetas, signos y saltos internos cuando sean relevantes.
6. Usa terminología veterinaria habitual en español.

ARRAY DE ENTRADA
${JSON.stringify(strings)}
`;
}

function translationResponseSchema() {
  return {
    type: "OBJECT",
    required: ["translations"],
    properties: {
      translations: {
        type: "ARRAY",
        items: { type: "STRING" }
      }
    }
  };
}

function validateLearningInput(input) {
  if (!input || typeof input !== "object") throw new Error("Solicitud vacía");
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  if (title.length < 2 || title.length > 500) throw new Error("Título no válido");
  if (content.length < 100) throw new Error("Contenido clínico insuficiente");
  if (content.length > MAX_CLINICAL_CONTENT) throw new Error("Contenido clínico demasiado extenso");
  if (input.headings && !Array.isArray(input.headings)) throw new Error("La lista de epígrafes no es válida");
}

function buildStudyPrompt(input) {
  const title = clean(input.title, 500);
  const headings = Array.isArray(input.headings)
    ? input.headings.slice(0, 120).map(item => clean(item, 180))
    : [];

  return `
Eres un especialista en medicina interna veterinaria, farmacología clínica y docencia para veterinarios.
Vas a crear una ficha titulada «ESTUDIAR EN DOS MINUTOS» sobre el proceso: ${title}.

FUENTE CLÍNICA
${String(input.content).slice(0, MAX_CLINICAL_CONTENT)}

EPÍGRAFES PRESENTES EN LA FUENTE, EN SU ORDEN
${JSON.stringify(headings)}

OBJETIVO
Genera en español un resumen científico, preciso, visual y realmente estudiable en unos dos minutos.

REGLAS NO NEGOCIABLES
1. Usa exclusivamente la información de la fuente. No añadas conocimientos externos, recomendaciones propias ni datos inferidos.
2. Conserva el orden y la estructura clínica de los epígrafes presentes. Traduce sus nombres al español veterinario habitual.
3. Resume cada epígrafe con frases breves, pero no elimines información clínicamente decisiva.
4. Conserva de forma exacta TODAS las cifras relevantes: dosis, unidades, vías, frecuencias, intervalos, porcentajes, duraciones, velocidades, umbrales, valores diagnósticos, edades, tiempos y pronósticos numéricos. No redondees, conviertas ni modifiques cifras.
5. Mantén separados: definición/fisiopatología, signos, causas y riesgos, diagnóstico, tratamiento, medicación, contraindicaciones, seguimiento y pronóstico.
6. Cuando la fuente indique N/A, expresa «No aplicable».
7. Usa iconos moderadamente para facilitar la memoria, sin reemplazar terminología científica.
8. Señala como alertas solo los riesgos, urgencias, contraindicaciones o complicaciones que estén explícitamente descritos.
9. No presentes el contenido como consejo para un paciente concreto.
10. El resultado debe ser autosuficiente, claro y sin referencias a que eres una IA.

FORMATO
- Título en español.
- Visión general de 2–3 frases.
- Secciones en el mismo orden que la fuente.
- En cada sección: 1–5 viñetas y, cuando existan, una lista separada de cifras o dosis clave.
- Cierre con perlas clínicas, alertas y 3–6 ideas esenciales para recordar.
`;
}

function buildQuizPrompt(input) {
  const title = clean(input.title, 500);

  return `
Eres un profesor universitario de medicina veterinaria.
Crea un examen interactivo de exactamente 10 preguntas sobre: ${title}.

FUENTE ÚNICA
${String(input.content).slice(0, MAX_CLINICAL_CONTENT)}

REGLAS
1. Toda pregunta y toda respuesta deben poder justificarse directamente con la fuente. No añadas información externa.
2. Redacta todo en español científico claro.
3. Cada pregunta debe tener exactamente cuatro respuestas posibles y una sola correcta.
4. Evita preguntas ambiguas, dobles negaciones, trampas lingüísticas y opciones parcialmente correctas.
5. Mezcla dificultad básica, intermedia y avanzada.
6. Distribuye las preguntas entre definición/fisiopatología, signos, causas, diagnóstico, pruebas, tratamiento, medicaciones, dosis, contraindicaciones, seguimiento, complicaciones y pronóstico, según el contenido disponible.
7. Incluye varias preguntas sobre cifras, dosis, vías, frecuencias, duraciones o umbrales cuando aparezcan en la fuente, conservándolos exactamente.
8. Alterna la posición de la respuesta correcta; no la coloques siempre en el mismo índice.
9. Después de cada respuesta correcta proporciona una explicación breve y científica basada en la fuente.
10. No menciones la fuente, el prompt ni que eres una IA.
`;
}

function studyResponseSchema() {
  return {
    type: "OBJECT",
    required: [
      "title",
      "overview",
      "readingTime",
      "sections",
      "clinicalPearls",
      "redFlags",
      "takeHome",
      "disclaimer"
    ],
    properties: {
      title: { type: "STRING" },
      overview: { type: "STRING" },
      readingTime: { type: "STRING" },
      sections: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["heading", "icon", "bullets", "keyData"],
          properties: {
            heading: { type: "STRING" },
            icon: { type: "STRING" },
            bullets: { type: "ARRAY", items: { type: "STRING" } },
            keyData: { type: "ARRAY", items: { type: "STRING" } }
          }
        }
      },
      clinicalPearls: { type: "ARRAY", items: { type: "STRING" } },
      redFlags: { type: "ARRAY", items: { type: "STRING" } },
      takeHome: { type: "ARRAY", items: { type: "STRING" } },
      disclaimer: { type: "STRING" }
    }
  };
}

function quizResponseSchema() {
  return {
    type: "OBJECT",
    required: ["title", "questions"],
    properties: {
      title: { type: "STRING" },
      questions: {
        type: "ARRAY",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "OBJECT",
          required: ["question", "options", "correctIndex", "explanation", "difficulty"],
          properties: {
            question: { type: "STRING" },
            options: {
              type: "ARRAY",
              minItems: 4,
              maxItems: 4,
              items: { type: "STRING" }
            },
            correctIndex: { type: "INTEGER", minimum: 0, maximum: 3 },
            explanation: { type: "STRING" },
            difficulty: { type: "STRING", enum: ["básica", "intermedia", "avanzada"] }
          }
        }
      }
    }
  };
}

function sanitizeTaskResult(action, result) {
  if (action === "interpret_ecg") return sanitizeEcgResult(result);
  if (action === "study_summary") return sanitizeStudyResult(result);
  if (action === "translate_batch") return sanitizeTranslationResult(result);
  return sanitizeQuizResult(result);
}


function sanitizeTranslationResult(result) {
  return {
    translations: Array.isArray(result?.translations)
      ? result.translations.slice(0, 80).map(item => clean(item, 15000))
      : []
  };
}

function sanitizeStudyResult(result) {
  const list = (value, maxItems = 20, maxLength = 1600) =>
    Array.isArray(value) ? value.slice(0, maxItems).map(item => clean(item, maxLength)) : [];

  return {
    title: clean(result?.title, 500),
    overview: clean(result?.overview, 2500),
    readingTime: clean(result?.readingTime || "Lectura aproximada: 2 minutos", 120),
    sections: Array.isArray(result?.sections) ? result.sections.slice(0, 80).map(section => ({
      heading: clean(section?.heading, 240),
      icon: clean(section?.icon || "◆", 12),
      bullets: list(section?.bullets, 8, 1800),
      keyData: list(section?.keyData, 20, 500)
    })) : [],
    clinicalPearls: list(result?.clinicalPearls, 12, 1200),
    redFlags: list(result?.redFlags, 12, 1200),
    takeHome: list(result?.takeHome, 12, 1200),
    disclaimer: clean(result?.disclaimer, 1000)
  };
}

function sanitizeQuizResult(result) {
  const questions = Array.isArray(result?.questions)
    ? result.questions.slice(0, 10).map(item => {
        const options = Array.isArray(item?.options)
          ? item.options.slice(0, 4).map(option => clean(option, 700))
          : [];
        while (options.length < 4) options.push("Opción no disponible");
        return {
          question: clean(item?.question, 1400),
          options,
          correctIndex: Math.max(0, Math.min(3, Math.round(Number(item?.correctIndex) || 0))),
          explanation: clean(item?.explanation, 1800),
          difficulty: ["básica", "intermedia", "avanzada"].includes(item?.difficulty)
            ? item.difficulty
            : "intermedia"
        };
      })
    : [];

  return {
    title: clean(result?.title, 500),
    questions
  };
}



function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://airsoto.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function validateEcgInput(input) {
  if (!input || typeof input !== "object") throw new Error("Solicitud vacía");
  if (!input.confirmed) throw new Error("El trazado debe estar confirmado antes de interpretarlo");
  if (!input.settings || !["dog", "cat"].includes(input.settings.species)) throw new Error("Especie no válida");
  if (![25, 50].includes(Number(input.settings.speed))) throw new Error("Velocidad no válida");
  if (!Array.isArray(input.traces) || input.traces.length === 0) throw new Error("Falta el trazado confirmado");
  if (input.traces.length > 6) throw new Error("Demasiadas derivaciones");
  for (const trace of input.traces) {
    if (!trace || typeof trace !== "object") throw new Error("Trazado no válido");
    if (!Array.isArray(trace.points) || trace.points.length < 10) throw new Error("Trazado insuficiente");
    if (trace.points.length > 5000) throw new Error("Demasiados puntos en una derivación");
  }
}

function buildEcgPrompt(input) {
  const s = input.settings;
  const species = s.species === "cat" ? "gato" : "perro";
  const compactTraces = input.traces.map(trace => ({
    lead: trace.lead,
    confidence: round(trace.confidence),
    adhesion: round(trace.adhesion),
    points: simplify(trace.points, 850),
    markers: Array.isArray(trace.markers) ? trace.markers.slice(0, 120) : []
  }));

  return `
Eres un especialista en electrocardiografía veterinaria de perros y gatos.
Recibirás un trazado ya extraído localmente de la imagen y confirmado por un veterinario.
No vuelvas a medir la fotografía y no inventes ondas, intervalos ni diagnósticos.
No recomiendes tratamientos. No uses criterios humanos de infarto, isquemia o hipertrofia.

CONFIGURACIÓN
- Especie: ${species}
- Tamaño del perro: ${s.dogSize || "no aplicable"}
- Velocidad: ${s.speed} mm/s
- Sensibilidad: ${s.sensitivity}
- Derivación principal: ${s.primaryLead || "II"}
- Derivaciones: ${(s.leads || []).join(", ")}
- Modo: ${s.mode || "conservador"}

MEDICIONES DETERMINISTAS CALCULADAS EN JAVASCRIPT
${JSON.stringify(input.measurements || {}, null, 2)}

TRAZADOS CONFIRMADOS Y MARCADORES
${JSON.stringify(compactTraces)}

LIMITACIONES Y OBSERVACIONES LOCALES
${JSON.stringify(input.localFindings || {})}

TAREA
1. Interpreta exclusivamente los datos confirmados.
2. Distingue datos objetivos, hallazgos inferidos y limitaciones.
3. Evalúa ritmo, frecuencia, regularidad, ondas P, morfología QRS, relación AV y alteraciones de conducción.
4. No afirmes fibrilación auricular sin ausencia de P demostrable e irregularidad compatible.
5. No afirmes bloqueo AV sin evaluar P, QRS y relación AV.
6. No afirmes origen ventricular solo por frecuencia.
7. Si los datos son insuficientes, usa "no concluyente".
8. Devuelve hasta tres diagnósticos diferenciales con compatibilidad orientativa, argumentos a favor, en contra y datos faltantes.
9. Redacta una conclusión clínica prudente, sin tratamiento.
`;
}

function ecgResponseSchema() {
  const finding = {
    type: "OBJECT",
    required: ["name", "confidence", "evidence"],
    properties: {
      name: { type: "STRING" },
      confidence: { type: "NUMBER" },
      evidence: { type: "ARRAY", items: { type: "STRING" } }
    }
  };

  return {
    type: "OBJECT",
    required: [
      "quality",
      "rhythm",
      "frequency",
      "regularity",
      "pWaves",
      "qrs",
      "avRelationship",
      "findings",
      "differentials",
      "limitations",
      "conclusion"
    ],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["status", "confidence", "comment"],
        properties: {
          status: { type: "STRING", enum: ["interpretable", "parcial", "no concluyente"] },
          confidence: { type: "NUMBER" },
          comment: { type: "STRING" }
        }
      },
      rhythm: { type: "STRING" },
      frequency: { type: "STRING" },
      regularity: { type: "STRING" },
      pWaves: { type: "STRING" },
      qrs: { type: "STRING" },
      avRelationship: { type: "STRING" },
      findings: { type: "ARRAY", items: finding },
      differentials: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "compatibility", "confidence", "for", "against", "missing"],
          properties: {
            name: { type: "STRING" },
            compatibility: { type: "INTEGER" },
            confidence: { type: "STRING", enum: ["alta", "media", "baja"] },
            for: { type: "ARRAY", items: { type: "STRING" } },
            against: { type: "ARRAY", items: { type: "STRING" } },
            missing: { type: "ARRAY", items: { type: "STRING" } }
          }
        }
      },
      limitations: { type: "ARRAY", items: { type: "STRING" } },
      conclusion: { type: "STRING" }
    }
  };
}

async function callWithFallback(models, payload, apiKey) {
  const attemptedModels = [];
  let lastStatus = 502;
  let lastRaw = null;

  for (const model of models) {
    attemptedModels.push(model);

    let result = await callModel(model, payload, apiKey);
    if (result.ok) return { ok: true, model, raw: result.raw, attemptedModels };

    lastStatus = result.status;
    lastRaw = result.raw;

    if (RETRYABLE.has(result.status)) {
      await sleep(650);
      result = await callModel(model, payload, apiKey);
      if (result.ok) return { ok: true, model, raw: result.raw, attemptedModels };
      lastStatus = result.status;
      lastRaw = result.raw;
    }

    if (![400, 404, 429, 500, 502, 503, 504].includes(result.status)) {
      return { ok: false, status: result.status, details: result.raw, attemptedModels };
    }
  }

  return { ok: false, status: lastStatus, details: lastRaw, attemptedModels };
}

async function callModel(model, payload, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload)
    });
    let raw;
    try {
      raw = await response.json();
    } catch {
      raw = { error: { message: "Respuesta no JSON" } };
    }
    return { ok: response.ok, status: response.status, raw };
  } catch (error) {
    return { ok: false, status: 503, raw: { error: { message: clean(error?.message || "Error de red", 160) } } };
  }
}

function sanitizeEcgResult(result) {
  const safeText = value => clean(value, 1200);
  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const safeList = value => Array.isArray(value) ? value.slice(0, 12).map(item => safeText(item)) : [];

  return {
    quality: {
      status: ["interpretable", "parcial", "no concluyente"].includes(result?.quality?.status)
        ? result.quality.status
        : "no concluyente",
      confidence: clamp01(result?.quality?.confidence),
      comment: safeText(result?.quality?.comment)
    },
    rhythm: safeText(result?.rhythm),
    frequency: safeText(result?.frequency),
    regularity: safeText(result?.regularity),
    pWaves: safeText(result?.pWaves),
    qrs: safeText(result?.qrs),
    avRelationship: safeText(result?.avRelationship),
    findings: Array.isArray(result?.findings) ? result.findings.slice(0, 20).map(item => ({
      name: safeText(item?.name),
      confidence: clamp01(item?.confidence),
      evidence: safeList(item?.evidence)
    })) : [],
    differentials: Array.isArray(result?.differentials) ? result.differentials.slice(0, 3).map(item => ({
      name: safeText(item?.name),
      compatibility: Math.max(0, Math.min(100, Math.round(Number(item?.compatibility) || 0))),
      confidence: ["alta", "media", "baja"].includes(item?.confidence) ? item.confidence : "baja",
      for: safeList(item?.for),
      against: safeList(item?.against),
      missing: safeList(item?.missing)
    })) : [],
    limitations: safeList(result?.limitations),
    conclusion: safeText(result?.conclusion)
  };
}

function simplify(points, maxPoints) {
  const safe = Array.isArray(points) ? points : [];
  if (safe.length <= maxPoints) return safe.map(sanitizePoint);
  const step = (safe.length - 1) / (maxPoints - 1);
  const out = [];
  for (let index = 0; index < maxPoints; index++) {
    out.push(sanitizePoint(safe[Math.round(index * step)]));
  }
  return out;
}

function sanitizePoint(point) {
  return {
    x: Math.max(0, Math.min(1000, Math.round(Number(point?.x) || 0))),
    y: Math.max(0, Math.min(1000, Math.round(Number(point?.y) || 0))),
    confidence: Math.max(0, Math.min(1, Number(point?.confidence) || 0))
  };
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function unique(values) {
  return values.filter((value, index, array) => value && array.indexOf(value) === index);
}

function normalizeStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function clean(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, maxLength);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}