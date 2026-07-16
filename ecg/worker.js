const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const MODEL_DEFAULT = "gemini-3.5-flash";
const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite"
];
const RETRY_DELAYS_MS = [1500, 3500];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_BASE64_LENGTH = 18_000_000;

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
        model: preferredModel,
        fallbackModels: uniqueModels([preferredModel, ...FALLBACK_MODELS]),
        version: "2.0.0"
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

      const payload = buildPayload(input);
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

      const text = extractGeminiText(gemini.raw);
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
          attemptedModels: gemini.attemptedModels,
          rawText: text
        }, 502, cors);
      }

      sanitizeResult(result);

      result.meta = {
        model: gemini.model,
        attemptedModels: gemini.attemptedModels,
        analyzedAt: new Date().toISOString(),
        version: "2.0.0",
        disclaimer: "Resultado experimental. Requiere revisión veterinaria del ECG original."
      };

      return json({ success: true, result }, 200, cors);
    } catch (error) {
      return json({
        error: error?.message || "Error interno"
      }, 400, cors);
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

  if (input.imageBase64.length > MAX_BASE64_LENGTH) {
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

function buildPayload(input) {
  return {
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
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: responseSchema()
    }
  };
}

function buildPrompt(input) {
  const species = input.species === "cat" ? "gato" : "perro";
  const calibration = input.calibration
    ? `Referencia manual opcional 5 x 5 mm: x=${input.calibration.x}, y=${input.calibration.y}, ancho=${input.calibration.w}, alto=${input.calibration.h}, coordenadas normalizadas 0-1000.`
    : "No existe calibración manual. Usa la velocidad, sensibilidad declarada y la cuadrícula visible. Devuelve null cuando la escala no sea fiable.";

  return `
Actúa como asistente experto en electrocardiografía veterinaria de pequeños animales.
Analiza únicamente la imagen proporcionada. No inventes datos ni tratamientos.
El resultado será revisado por un veterinario.

CONFIGURACIÓN DECLARADA
- Especie: ${species}
- Tamaño del perro: ${input.dogSize || "no aplicable"}
- Velocidad: ${input.speed} mm/s
- Sensibilidad: ${input.sensitivity}
- Derivaciones declaradas: ${input.leads.join(", ")}
- Derivación principal: ${input.primaryLead || "II"}
- ${calibration}

OBJETIVOS
1. Identifica las regiones de las derivaciones declaradas.
2. Sigue el trazado negro y devuelve una polilínea por derivación con coordenadas x/y entre 0 y 1000 respecto a toda la imagen.
3. Marca P, Q, R, S y T cuando sean visibles.
4. Determina frecuencia, regularidad, relación P:QRS, ritmo y posibles arritmias.
5. Mide P, PR, QRS, R, QT, ST y T solo cuando sea fiable.
6. Compara con valores normales de perro o gato e identifica desviaciones.
7. Distingue hallazgos firmes de sospechas.
8. Declara calidad, confianza y limitaciones.
9. No recomiendes tratamientos ni sustituyas la interpretación profesional.

REGLAS DEL TRAZADO
- Puntos ordenados de izquierda a derecha.
- Máximo 900 puntos por derivación.
- No traces cuadrícula, texto, bordes ni artefactos.
- box debe ser [xMin, yMin, xMax, yMax].
- Si una derivación no puede seguirse con confianza, devuelve points vacío.
- No inventes ondas o mediciones no visibles.
`;
}

function responseSchema() {
  return {
    type: "OBJECT",
    required: [
      "quality",
      "mainLead",
      "leads",
      "rhythm",
      "arrhythmias",
      "measurements",
      "abnormalities",
      "conclusion"
    ],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["confidence", "score", "imageQuality", "limitations"],
        properties: {
          confidence: {
            type: "STRING",
            enum: ["alta", "media", "baja"]
          },
          score: { type: "NUMBER" },
          imageQuality: { type: "STRING" },
          limitations: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        }
      },
      mainLead: { type: "STRING" },
      leads: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "box", "points", "markers"],
          properties: {
            name: { type: "STRING" },
            box: {
              type: "ARRAY",
              minItems: 4,
              maxItems: 4,
              items: { type: "INTEGER" }
            },
            points: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["x", "y"],
                properties: {
                  x: { type: "INTEGER" },
                  y: { type: "INTEGER" }
                }
              }
            },
            markers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["wave", "x", "y", "confidence"],
                properties: {
                  wave: {
                    type: "STRING",
                    enum: ["P", "Q", "R", "S", "T"]
                  },
                  x: { type: "INTEGER" },
                  y: { type: "INTEGER" },
                  confidence: {
                    type: "STRING",
                    enum: ["alta", "media", "baja"]
                  }
                }
              }
            }
          }
        }
      },
      rhythm: {
        type: "OBJECT",
        required: [
          "diagnosis",
          "heartRateBpm",
          "regularity",
          "pQrsRelationship",
          "explanation"
        ],
        properties: {
          diagnosis: { type: "STRING" },
          heartRateBpm: {
            type: "NUMBER",
            nullable: true
          },
          regularity: { type: "STRING" },
          pQrsRelationship: { type: "STRING" },
          explanation: { type: "STRING" }
        }
      },
      arrhythmias: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "confidence", "evidence"],
          properties: {
            name: { type: "STRING" },
            confidence: {
              type: "STRING",
              enum: ["alta", "media", "baja"]
            },
            evidence: { type: "STRING" }
          }
        }
      },
      measurements: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: [
            "parameter",
            "value",
            "unit",
            "reference",
            "status",
            "comment"
          ],
          properties: {
            parameter: { type: "STRING" },
            value: {
              type: "NUMBER",
              nullable: true
            },
            unit: { type: "STRING" },
            reference: { type: "STRING" },
            status: {
              type: "STRING",
              enum: [
                "normal",
                "alto",
                "bajo",
                "anormal",
                "no medible",
                "revisar"
              ]
            },
            comment: { type: "STRING" }
          }
        }
      },
      abnormalities: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "confidence", "evidence"],
          properties: {
            name: { type: "STRING" },
            confidence: {
              type: "STRING",
              enum: ["alta", "media", "baja"]
            },
            evidence: { type: "STRING" }
          }
        }
      },
      conclusion: { type: "STRING" }
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

      const result = await callGeminiModel({
        model,
        payload,
        apiKey
      });

      if (result.ok) {
        return {
          ok: true,
          model,
          raw: result.raw,
          attemptedModels
        };
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
      raw = {
        error: {
          message: "Gemini devolvió una respuesta no JSON"
        }
      };
    }

    return {
      ok: response.ok,
      status: response.status,
      raw
    };
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

function extractGeminiText(raw) {
  return raw?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim() || "";
}

function sanitizeResult(result) {
  if (!result || typeof result !== "object") {
    return;
  }

  if (result.quality) {
    result.quality.score = clampNumber(result.quality.score, 0, 1);
  }

  if (Array.isArray(result.leads)) {
    result.leads = result.leads.map(lead => {
      const box = Array.isArray(lead.box)
        ? lead.box.slice(0, 4).map(value => clampInteger(value, 0, 1000))
        : [0, 0, 1000, 1000];

      const points = Array.isArray(lead.points)
        ? lead.points.slice(0, 900).map(point => ({
            x: clampInteger(point?.x, 0, 1000),
            y: clampInteger(point?.y, 0, 1000)
          }))
        : [];

      const markers = Array.isArray(lead.markers)
        ? lead.markers.map(marker => ({
            wave: ["P", "Q", "R", "S", "T"].includes(marker?.wave)
              ? marker.wave
              : "R",
            x: clampInteger(marker?.x, 0, 1000),
            y: clampInteger(marker?.y, 0, 1000),
            confidence: ["alta", "media", "baja"].includes(marker?.confidence)
              ? marker.confidence
              : "baja"
          }))
        : [];

      return {
        name: String(lead?.name || ""),
        box,
        points,
        markers
      };
    });
  }
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max) {
  return Math.round(clampNumber(value, min, max));
}

function uniqueModels(models) {
  return models.filter(
    (model, index, array) =>
      Boolean(model) && array.indexOf(model) === index
  );
}

function normalizeStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 502;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
