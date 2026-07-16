const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const MODEL_DEFAULT = "gemini-3.5-flash";
const FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-flash-latest"
];
const RETRY_DELAYS_MS = [1200, 3000];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_IMAGE_BASE64 = 18_000_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      const preferredModel = env.GEMINI_MODEL || MODEL_DEFAULT;
      return json({
        ok: true,
        service: "ECG veterinario Gemini",
        version: "3.0.0",
        model: preferredModel,
        fallbackModels: uniqueModels([preferredModel, ...FALLBACK_MODELS]),
        capabilities: [
          "image-crop-input",
          "lead-regions",
          "trace-polyline",
          "wave-markers",
          "segments",
          "measurements",
          "rhythm-and-arrhythmias",
          "scale-confidence"
        ]
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

    try {
      const input = await request.json();
      validateInput(input);

      const payload = {
        contents: [{
          role: "user",
          parts: [
            { text: buildPrompt(input) },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: input.imageBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          responseSchema: responseSchema()
        }
      };

      const preferredModel = env.GEMINI_MODEL || MODEL_DEFAULT;
      const models = uniqueModels([preferredModel, ...FALLBACK_MODELS]);
      const gemini = await callGeminiWithFallback({
        models,
        payload,
        apiKey: env.GEMINI_API_KEY
      });

      if (!gemini.ok) {
        return json({
          error: "No se pudo completar el análisis con Gemini",
          status: gemini.status,
          attemptedModels: gemini.attemptedModels,
          details: gemini.details
        }, normalizeStatus(gemini.status), cors);
      }

      const text = gemini.raw?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        return json({
          error: "Gemini no devolvió contenido",
          model: gemini.model,
          attemptedModels: gemini.attemptedModels,
          raw: gemini.raw
        }, 502, cors);
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return json({
          error: "Gemini devolvió JSON no válido",
          model: gemini.model,
          rawText: text.slice(0, 4000)
        }, 502, cors);
      }

      result = sanitizeResult(result, input);
      result.meta = {
        model: gemini.model,
        attemptedModels: gemini.attemptedModels,
        analyzedAt: new Date().toISOString(),
        inputWasCropped: Boolean(input.cropApplied),
        disclaimer: "Resultado experimental. Requiere revisión veterinaria del ECG original."
      };

      return json({ success: true, result }, 200, cors);
    } catch (error) {
      return json({ error: error?.message || "Error interno" }, 400, cors);
    }
  }
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://airsoto.github.io";

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
  if (!input || typeof input !== "object") {
    throw new Error("Solicitud vacía");
  }
  if (!input.imageBase64 || typeof input.imageBase64 !== "string") {
    throw new Error("Falta imageBase64");
  }
  if (!/^image\/(jpeg|png|webp)$/.test(input.mimeType || "")) {
    throw new Error("Formato de imagen no admitido");
  }
  if (input.imageBase64.length > MAX_IMAGE_BASE64) {
    throw new Error("Imagen demasiado grande");
  }
  if (!Array.isArray(input.leads) || input.leads.length === 0) {
    throw new Error("Selecciona al menos una derivación");
  }
  if (!["dog", "cat"].includes(input.species)) {
    throw new Error("Especie no válida");
  }
  if (![25, 50, "25", "50"].includes(input.speed)) {
    throw new Error("Velocidad no válida");
  }
}

function buildPrompt(input) {
  const species = input.species === "cat" ? "gato" : "perro";
  const userRegions = Array.isArray(input.userLeadRegions) && input.userLeadRegions.length
    ? input.userLeadRegions.map(region => (
        `${region.name}: [${region.box.join(", ")}]`
      )).join("; ")
    : "ninguna región manual";

  const calibration = input.calibration
    ? `Existe una referencia manual de 5 x 5 mm: x=${input.calibration.x}, y=${input.calibration.y}, ancho=${input.calibration.w}, alto=${input.calibration.h}, coordenadas 0-1000.`
    : "No existe referencia manual de cuadrícula.";

  return `
Eres un especialista europeo en electrocardiografía veterinaria de perros y gatos.
Analiza exclusivamente la imagen de ECG adjunta. No inventes datos ni tratamientos.
Si una medición, onda, segmento, región o diagnóstico no puede establecerse con fiabilidad, devuelve null, una lista vacía o una confianza baja según corresponda.

CONFIGURACIÓN DECLARADA POR EL VETERINARIO
- Especie: ${species}
- Tamaño del perro: ${input.dogSize || "no aplicable"}
- Velocidad: ${input.speed} mm/s
- Sensibilidad: ${input.sensitivity}
- Derivaciones que el usuario considera presentes: ${input.leads.join(", ")}
- Derivación principal para frecuencia, ritmo y arritmias: ${input.primaryLead || "II"}
- Regiones de derivaciones marcadas por el usuario: ${userRegions}
- ${calibration}
- La imagen recibida ${input.cropApplied ? "es un recorte seleccionado por el usuario" : "no ha sido recortada"}.

OBJETIVOS OBLIGATORIOS
1. Detecta todas las derivaciones visibles entre DI, DII, DIII, aVR, aVL y aVF.
2. Delimita cada derivación con box=[xMin,yMin,xMax,yMax], coordenadas enteras 0-1000 relativas a toda la imagen.
3. Respeta las regiones manuales cuando sean coherentes; corrígelas solo si existe evidencia visual clara.
4. Analiza frecuencia, ritmo y arritmias únicamente en la derivación principal declarada.
5. Usa DI, DII y DIII para el eje eléctrico solo cuando estén visibles y sean medibles.
6. Sigue el centro del trazado negro de cada derivación. Devuelve entre 80 y 450 puntos por derivación, ordenados de izquierda a derecha. No sigas la cuadrícula, letras, bordes ni artefactos.
7. Detecta marcas de ondas y límites usando estos tipos exactos:
   P, Q, R, S, T, pStart, pEnd, prStart, prEnd, qrsStart, qrsEnd, stStart, stEnd, tStart, tPeak, tEnd, iso.
8. Devuelve segmentos relevantes como P, PR, QRS, ST, T y QT con inicio y final normalizados.
9. Evalúa la cuadrícula del papel. Si no puede utilizarse con precisión, calibration.scaleReliable=false y no inventes duraciones ni amplitudes.
10. Calcula, solo cuando sea fiable: frecuencia, RR, duración y amplitud P, área P, PR, duración y amplitud QRS, R, QT, QTc, ST, amplitud T, eje y relación P:QRS.
11. Clasifica ritmo, arritmias, alteraciones de conducción, auriculares y ventriculares.
12. Declara calidad de imagen, confianza, limitaciones y diagnósticos diferenciales electrocardiográficos.
13. No incluyas valores normales bibliográficos en la respuesta; la aplicación los aplica localmente.
14. No recomiendes tratamientos.

REGLAS DE COORDENADAS
- Todas las coordenadas x/y deben ser enteros entre 0 y 1000.
- Los puntos deben estar referidos a toda la imagen recibida, no a la caja de la derivación.
- baselineY debe ser una coordenada y normalizada 0-1000 o null.
- Si una derivación no puede seguirse, devuelve points=[] y explica la limitación.

El JSON debe cumplir exactamente el esquema solicitado.
`;
}

function responseSchema() {
  const nullableNumber = { type: "NUMBER", nullable: true };
  const confidence = { type: "STRING", enum: ["alta", "media", "baja"] };
  const point = {
    type: "OBJECT",
    required: ["x", "y"],
    properties: {
      x: { type: "INTEGER" },
      y: { type: "INTEGER" }
    }
  };

  return {
    type: "OBJECT",
    required: [
      "quality",
      "calibration",
      "mainLead",
      "leads",
      "rhythm",
      "arrhythmias",
      "conductionAbnormalities",
      "atrialAbnormalities",
      "ventricularAbnormalities",
      "measurements",
      "differentials",
      "conclusion"
    ],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["confidence", "score", "imageQuality", "limitations"],
        properties: {
          confidence,
          score: { type: "NUMBER" },
          imageQuality: { type: "STRING" },
          limitations: { type: "ARRAY", items: { type: "STRING" } }
        }
      },
      calibration: {
        type: "OBJECT",
        required: ["scaleReliable", "confidence", "source", "pxPerMmX", "pxPerMmY"],
        properties: {
          scaleReliable: { type: "BOOLEAN" },
          confidence,
          source: { type: "STRING" },
          pxPerMmX: nullableNumber,
          pxPerMmY: nullableNumber
        }
      },
      mainLead: { type: "STRING" },
      leads: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "box", "baselineY", "confidence", "points", "markers", "segments"],
          properties: {
            name: { type: "STRING" },
            box: { type: "ARRAY", items: { type: "INTEGER" } },
            baselineY: nullableNumber,
            confidence,
            points: { type: "ARRAY", items: point },
            markers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["type", "x", "y", "confidence"],
                properties: {
                  type: {
                    type: "STRING",
                    enum: [
                      "P", "Q", "R", "S", "T",
                      "pStart", "pEnd", "prStart", "prEnd",
                      "qrsStart", "qrsEnd", "stStart", "stEnd",
                      "tStart", "tPeak", "tEnd", "iso"
                    ]
                  },
                  x: { type: "INTEGER" },
                  y: { type: "INTEGER" },
                  confidence
                }
              }
            },
            segments: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["name", "startX", "endX", "confidence"],
                properties: {
                  name: { type: "STRING", enum: ["P", "PR", "QRS", "ST", "T", "QT"] },
                  startX: { type: "INTEGER" },
                  endX: { type: "INTEGER" },
                  confidence
                }
              }
            }
          }
        }
      },
      rhythm: {
        type: "OBJECT",
        required: ["diagnosis", "heartRateBpm", "regularity", "pQrsRelationship", "confidence", "explanation"],
        properties: {
          diagnosis: { type: "STRING" },
          heartRateBpm: nullableNumber,
          regularity: { type: "STRING" },
          pQrsRelationship: { type: "STRING" },
          confidence,
          explanation: { type: "STRING" }
        }
      },
      arrhythmias: { type: "ARRAY", items: findingSchema(confidence) },
      conductionAbnormalities: { type: "ARRAY", items: findingSchema(confidence) },
      atrialAbnormalities: { type: "ARRAY", items: findingSchema(confidence) },
      ventricularAbnormalities: { type: "ARRAY", items: findingSchema(confidence) },
      measurements: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["key", "parameter", "value", "unit", "confidence", "evidence"],
          properties: {
            key: {
              type: "STRING",
              enum: [
                "heartRate", "rr", "pDuration", "pAmplitude", "pArea",
                "pr", "qrsDuration", "qrsAmplitude", "rAmplitude",
                "qt", "qtc", "stDeviation", "tAmplitude", "axis", "pQrsRatio"
              ]
            },
            parameter: { type: "STRING" },
            value: nullableNumber,
            unit: { type: "STRING" },
            confidence,
            evidence: { type: "STRING" }
          }
        }
      },
      differentials: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "confidence", "reason"],
          properties: {
            name: { type: "STRING" },
            confidence,
            reason: { type: "STRING" }
          }
        }
      },
      conclusion: { type: "STRING" }
    }
  };
}

function findingSchema(confidence) {
  return {
    type: "OBJECT",
    required: ["name", "confidence", "evidence"],
    properties: {
      name: { type: "STRING" },
      confidence,
      evidence: { type: "STRING" }
    }
  };
}

async function callGeminiWithFallback({ models, payload, apiKey }) {
  const attemptedModels = [];
  let lastStatus = 502;
  let lastDetails = null;

  for (const model of models) {
    attemptedModels.push(model);

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }

      const result = await callGeminiModel({ model, payload, apiKey });
      if (result.ok) {
        return { ok: true, model, raw: result.raw, attemptedModels };
      }

      lastStatus = result.status;
      lastDetails = result.raw;

      if (result.status === 400 || result.status === 404) {
        break;
      }
      if (!RETRYABLE_STATUS.has(result.status)) {
        return {
          ok: false,
          status: result.status,
          details: result.raw,
          attemptedModels
        };
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    details: lastDetails,
    attemptedModels
  };
}

async function callGeminiModel({ model, payload, apiKey }) {
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

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
      raw = { error: { message: "Gemini devolvió una respuesta no JSON" } };
    }

    return { ok: response.ok, status: response.status, raw };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      raw: {
        error: {
          status: "NETWORK_ERROR",
          message: error?.message || "No se pudo conectar con Gemini"
        }
      }
    };
  }
}

function sanitizeResult(result, input) {
  const safe = result && typeof result === "object" ? result : {};
  safe.quality = safe.quality || {
    confidence: "baja",
    score: 0,
    imageQuality: "No valorada",
    limitations: ["Respuesta incompleta"]
  };
  safe.quality.score = clampNumber(safe.quality.score, 0, 1, 0);
  safe.quality.limitations = stringArray(safe.quality.limitations);

  safe.calibration = safe.calibration || {};
  safe.calibration.scaleReliable = Boolean(safe.calibration.scaleReliable);
  safe.calibration.pxPerMmX = finiteOrNull(safe.calibration.pxPerMmX);
  safe.calibration.pxPerMmY = finiteOrNull(safe.calibration.pxPerMmY);

  safe.mainLead = String(safe.mainLead || input.primaryLead || "II");
  safe.leads = Array.isArray(safe.leads)
    ? safe.leads.slice(0, 12).map(sanitizeLead)
    : [];
  safe.rhythm = safe.rhythm || {};
  safe.arrhythmias = sanitizeFindings(safe.arrhythmias);
  safe.conductionAbnormalities = sanitizeFindings(safe.conductionAbnormalities);
  safe.atrialAbnormalities = sanitizeFindings(safe.atrialAbnormalities);
  safe.ventricularAbnormalities = sanitizeFindings(safe.ventricularAbnormalities);
  safe.measurements = Array.isArray(safe.measurements)
    ? safe.measurements.slice(0, 40).map(item => ({
        key: String(item?.key || ""),
        parameter: String(item?.parameter || ""),
        value: finiteOrNull(item?.value),
        unit: String(item?.unit || ""),
        confidence: confidenceValue(item?.confidence),
        evidence: String(item?.evidence || "")
      }))
    : [];
  safe.differentials = Array.isArray(safe.differentials)
    ? safe.differentials.slice(0, 20).map(item => ({
        name: String(item?.name || ""),
        confidence: confidenceValue(item?.confidence),
        reason: String(item?.reason || "")
      }))
    : [];
  safe.conclusion = String(safe.conclusion || "");
  return safe;
}

function sanitizeLead(lead) {
  const box = Array.isArray(lead?.box) && lead.box.length >= 4
    ? lead.box.slice(0, 4).map(value => clampInt(value, 0, 1000))
    : [0, 0, 1000, 1000];

  const points = Array.isArray(lead?.points)
    ? lead.points.slice(0, 900).map(sanitizePoint).sort((a, b) => a.x - b.x)
    : [];

  const markerTypes = new Set([
    "P", "Q", "R", "S", "T", "pStart", "pEnd", "prStart", "prEnd",
    "qrsStart", "qrsEnd", "stStart", "stEnd", "tStart", "tPeak", "tEnd", "iso"
  ]);

  const markers = Array.isArray(lead?.markers)
    ? lead.markers.slice(0, 300)
        .filter(marker => markerTypes.has(marker?.type))
        .map(marker => ({
          id: crypto.randomUUID(),
          type: marker.type,
          x: clampInt(marker.x, 0, 1000),
          y: clampInt(marker.y, 0, 1000),
          confidence: confidenceValue(marker.confidence)
        }))
    : [];

  const segments = Array.isArray(lead?.segments)
    ? lead.segments.slice(0, 100).map(segment => ({
        name: String(segment?.name || ""),
        startX: clampInt(segment?.startX, 0, 1000),
        endX: clampInt(segment?.endX, 0, 1000),
        confidence: confidenceValue(segment?.confidence)
      }))
    : [];

  return {
    id: crypto.randomUUID(),
    name: String(lead?.name || "?"),
    box,
    baselineY: finiteOrNull(lead?.baselineY),
    confidence: confidenceValue(lead?.confidence),
    points,
    markers,
    segments
  };
}

function sanitizePoint(point) {
  return {
    x: clampInt(point?.x, 0, 1000),
    y: clampInt(point?.y, 0, 1000)
  };
}

function sanitizeFindings(items) {
  return Array.isArray(items)
    ? items.slice(0, 30).map(item => ({
        name: String(item?.name || ""),
        confidence: confidenceValue(item?.confidence),
        evidence: String(item?.evidence || "")
      }))
    : [];
}

function confidenceValue(value) {
  return ["alta", "media", "baja"].includes(value) ? value : "baja";
}

function stringArray(value) {
  return Array.isArray(value) ? value.slice(0, 30).map(String) : [];
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clampInt(value, min, max) {
  return Math.round(clampNumber(value, min, max, min));
}

function uniqueModels(models) {
  return models.filter((model, index, array) => Boolean(model) && array.indexOf(model) === index);
}

function normalizeStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
