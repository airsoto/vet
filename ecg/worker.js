const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const VERSION = "6.0.0";
const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest"];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_BODY = 1_500_000;

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
        service: "ECG veterinario Gemini",
        version: VERSION,
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        action: "interpret-confirmed-trace"
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
      validateInput(input);

      const models = unique([env.GEMINI_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS]);
      const payload = {
        contents: [{
          role: "user",
          parts: [{ text: buildPrompt(input) }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: responseSchema()
        }
      };

      const result = await callWithFallback(models, payload, env.GEMINI_API_KEY);
      if (!result.ok) {
        return json({
          error: "Gemini no pudo interpretar el trazado confirmado",
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
          analysisId,
          model: result.model,
          version: VERSION
        }, 502, cors);
      }

      const safe = sanitizeResult(parsed);
      safe.meta = {
        model: result.model,
        attemptedModels: result.attemptedModels,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        analysisId,
        version: VERSION,
        disclaimer: "Interpretación orientativa basada en un trazado confirmado por el veterinario. No incluye tratamiento."
      };

      return json({ success: true, result: safe }, 200, cors);
    } catch (error) {
      return json({
        error: clean(error?.message || "Error interno", 300),
        analysisId,
        version: VERSION
      }, 400, cors);
    }
  }
};

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

function validateInput(input) {
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

function buildPrompt(input) {
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

function responseSchema() {
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
    for (const delay of [0, 1400, 3200]) {
      if (delay) await sleep(delay);
      const result = await callModel(model, payload, apiKey);
      if (result.ok) return { ok: true, model, raw: result.raw, attemptedModels };
      lastStatus = result.status;
      lastRaw = result.raw;
      if (result.status === 400 || result.status === 404) break;
      if (!RETRYABLE.has(result.status)) {
        return { ok: false, status: result.status, details: result.raw, attemptedModels };
      }
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

function sanitizeResult(result) {
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
