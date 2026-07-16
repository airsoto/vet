const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const WORKER_VERSION = "4.0.0";
const MODEL_DEFAULT = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest"];
const RETRY_DELAYS_MS = [1200, 3000];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_IMAGE_BASE64 = 18_000_000;
const MAX_LEADS = 6;
const MAX_COMPLEXES = 40;
const MAX_POINTS_PER_LEAD = 500;
const MAX_MARKERS_PER_COMPLEX = 24;
const MAX_TEXT = 1600;
const LEAD_NAMES = new Set(["I", "II", "III", "aVR", "aVL", "aVF"]);
const MARKER_TYPES = new Set([
  "pStart", "pPeak", "pEnd", "qrsStart", "Q", "R", "Rprime",
  "S", "Sprime", "qrsEnd", "J", "tStart", "tPeak", "tEnd", "iso"
]);

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    const analysisId = crypto.randomUUID();
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
        version: WORKER_VERSION,
        model: preferredModel,
        fallbackModels: uniqueModels([preferredModel, ...FALLBACK_MODELS]),
        capabilities: [
          "visual-quality", "visual-calibration", "lead-regions", "trace-seeds",
          "complexes", "wave-boundaries", "morphology", "artifacts", "evidence"
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

      const preferredModel = env.GEMINI_MODEL || MODEL_DEFAULT;
      const models = uniqueModels([preferredModel, ...FALLBACK_MODELS]);
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

      const gemini = await callGeminiWithFallback({
        models,
        payload,
        apiKey: env.GEMINI_API_KEY
      });

      if (!gemini.ok) {
        return json({
          error: safeErrorLabel(gemini.status),
          status: gemini.status,
          attemptedModels: gemini.attemptedModels,
          details: sanitizeRemoteError(gemini.details),
          analysisId,
          version: WORKER_VERSION
        }, normalizeStatus(gemini.status), cors);
      }

      const text = gemini.raw?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        return json({
          error: "Gemini no devolvió contenido estructurado",
          model: gemini.model,
          attemptedModels: gemini.attemptedModels,
          analysisId,
          version: WORKER_VERSION
        }, 502, cors);
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return json({
          error: "Gemini devolvió JSON no válido",
          model: gemini.model,
          analysisId,
          version: WORKER_VERSION
        }, 502, cors);
      }

      const result = sanitizeResult(parsed, input);
      result.meta = {
        model: gemini.model,
        attemptedModels: gemini.attemptedModels,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        version: WORKER_VERSION,
        analysisId,
        inputWasCropped: Boolean(input.cropApplied),
        disclaimer: "Resultado experimental de extracción visual. Requiere revisión veterinaria del ECG original."
      };

      return json({ success: true, result }, 200, cors);
    } catch (error) {
      return json({
        error: cleanText(error?.message || "Error interno", 300),
        analysisId,
        version: WORKER_VERSION
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
  if (!input.imageBase64 || typeof input.imageBase64 !== "string") throw new Error("Falta imageBase64");
  if (!/^image\/(jpeg|png|webp)$/.test(input.mimeType || "")) throw new Error("Formato de imagen no admitido");
  if (input.imageBase64.length > MAX_IMAGE_BASE64) throw new Error("Imagen demasiado grande");
  if (!Array.isArray(input.leads) || input.leads.length === 0) throw new Error("Selecciona al menos una derivación");
  if (input.leads.length > MAX_LEADS) throw new Error("Demasiadas derivaciones");
  if (!input.leads.every(name => LEAD_NAMES.has(name))) throw new Error("Nombre de derivación no admitido");
  if (!LEAD_NAMES.has(input.primaryLead || "II")) throw new Error("Derivación principal no válida");
  if (!["dog", "cat"].includes(input.species)) throw new Error("Especie no válida");
  if (![25, 50, "25", "50"].includes(input.speed)) throw new Error("Velocidad no válida");
  if (Array.isArray(input.userLeadRegions) && input.userLeadRegions.length > MAX_LEADS) {
    throw new Error("Demasiadas regiones manuales");
  }
}

function buildPrompt(input) {
  const species = input.species === "cat" ? "gato" : "perro";
  const mode = input.interpretationMode === "screening" ? "cribado sensible" : "conservador";
  const userRegions = Array.isArray(input.userLeadRegions) && input.userLeadRegions.length
    ? input.userLeadRegions.map(region => `${region.name}: [${(region.box || []).join(", ")}]`).join("; ")
    : "ninguna";
  const calibration = input.calibration
    ? `Referencia manual 5x5 mm: x=${input.calibration.x}, y=${input.calibration.y}, w=${input.calibration.w}, h=${input.calibration.h}, coordenadas 0-1000.`
    : "Sin referencia manual 5x5 mm.";

  return `
Eres un especialista europeo en electrocardiografía veterinaria de perros y gatos, actuando únicamente como extractor visual estructurado.
Analiza exclusivamente la imagen adjunta. No inventes ondas, complejos, medidas, diagnósticos ni tratamientos.
Una fotografía puede contener perspectiva, ruido, sombras, texto, bordes, cuadrícula intensa y artefactos.

SEPARACIÓN DE RESPONSABILIDADES
- Tú localizas visualmente derivaciones, calibración, trazado aproximado, complejos, ondas, morfología, artefactos y evidencias.
- El navegador hará después las mediciones matemáticas, reglas veterinarias, coherencia y diagnóstico jerárquico.
- No sustituyas datos no visibles por valores típicos. Usa null, arrays vacíos o confianza baja.

CONFIGURACIÓN DECLARADA
- Especie: ${species}
- Tamaño: ${input.dogSize || "no aplicable"}
- Velocidad: ${input.speed} mm/s
- Sensibilidad: ${input.sensitivity}
- Derivaciones declaradas: ${input.leads.join(", ")}
- Derivación principal para ritmo y P: ${input.primaryLead || "II"}
- Regiones manuales: ${userRegions}
- ${calibration}
- Imagen recibida: ${input.cropApplied ? "recorte seleccionado" : "imagen completa"}
- Modo de interpretación posterior: ${mode}

PRIORIDADES
1. Calidad global y por derivación.
2. Calibración visual: cuadrícula 1x1 mm, 5x5 mm, pulso de 1 mV, orientación y confianza.
3. Regiones de I, II, III, aVR, aVL y aVF. Ignora cabeceras, nombres, parámetros de máquina y zonas sin trazado.
4. Polilínea simplificada del centro del trazado negro. No sigas cuadrícula, letras, bordes, marcas de calibración ni artefactos.
5. Complejos y ondas por derivación, con límites y confianza.
6. Morfología y evidencia visual.
7. Artefactos y limitaciones.
8. Medidas visuales solo como propuestas opcionales, nunca como autoridad final.

REGLAS CLÍNICAS DE SEGURIDAD
- Prioriza DII para ritmo y ondas P.
- Usa I y III para eje solo si están disponibles.
- No sugieras fibrilación auricular sin evaluar ondas P y regularidad.
- No sugieras bloqueo AV sin evaluar P, QRS y relación AV.
- No sugieras origen ventricular solo por frecuencia.
- No uses criterios humanos de infarto, isquemia o hipertrofia.
- No recomiendes tratamientos.

COORDENADAS Y LÍMITES
- Todas las coordenadas son enteros 0-1000 relativos a toda la imagen.
- box=[xMin,yMin,xMax,yMax], ordenada y no invertida.
- Puntos ordenados de izquierda a derecha.
- Máximo ${MAX_POINTS_PER_LEAD} puntos por derivación.
- Máximo ${MAX_COMPLEXES} complejos en total.
- Máximo ${MAX_MARKERS_PER_COMPLEX} marcadores por complejo.
- Textos breves, evidencia concreta y sin explicaciones largas.

MARCADORES ADMITIDOS
pStart, pPeak, pEnd, qrsStart, Q, R, Rprime, S, Sprime, qrsEnd, J, tStart, tPeak, tEnd, iso.

MORFOLOGÍA
Registra presente/ausente/indeterminada, confianza y evidencia para:
P positiva/negativa/bifásica/mellada/ancha/alta; Q profunda; Rprime; Sprime; R mellada; QRS mono/bi/trifásico, ancho, bajo voltaje, variable; T positiva/negativa/bifásica/mellada/alta respecto a R; alternancia; ST elevado/deprimido; prematuridad; pausa compensadora; escape; artefacto.

Devuelve JSON exactamente conforme al esquema. Si algo no es medible, usa null.
`;
}

function responseSchema() {
  const nullableNumber = { type: "NUMBER", nullable: true };
  const confidence = { type: "NUMBER" };
  const point = {
    type: "OBJECT",
    required: ["x", "y", "confidence"],
    properties: {
      x: { type: "INTEGER" },
      y: { type: "INTEGER" },
      confidence
    }
  };
  const finding = {
    type: "OBJECT",
    required: ["name", "state", "confidence", "evidence"],
    properties: {
      name: { type: "STRING" },
      state: { type: "STRING", enum: ["presente", "ausente", "indeterminada"] },
      confidence,
      evidence: { type: "STRING" }
    }
  };

  return {
    type: "OBJECT",
    required: [
      "quality", "calibration", "mainLead", "leads", "artifacts",
      "suggestedInterpretation", "alternatives", "limitations"
    ],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["status", "confidence", "imageQuality", "limitations"],
        properties: {
          status: { type: "STRING", enum: ["interpretable", "parcial", "no interpretable"] },
          confidence,
          imageQuality: { type: "STRING" },
          limitations: { type: "ARRAY", items: { type: "STRING" } }
        }
      },
      calibration: {
        type: "OBJECT",
        required: ["scaleReliable", "confidence", "source", "pxPerMmX", "pxPerMmY", "gridAngleDeg", "pulse1mV"],
        properties: {
          scaleReliable: { type: "BOOLEAN" },
          confidence,
          source: { type: "STRING" },
          pxPerMmX: nullableNumber,
          pxPerMmY: nullableNumber,
          gridAngleDeg: nullableNumber,
          pulse1mV: {
            type: "OBJECT",
            required: ["detected", "confidence", "box"],
            properties: {
              detected: { type: "BOOLEAN" },
              confidence,
              box: { type: "ARRAY", items: { type: "INTEGER" } }
            }
          }
        }
      },
      mainLead: { type: "STRING" },
      leads: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "box", "confidence", "quality", "trace", "complexes", "morphology", "visualEvidence"],
          properties: {
            name: { type: "STRING" },
            box: { type: "ARRAY", items: { type: "INTEGER" } },
            confidence,
            quality: { type: "STRING" },
            trace: { type: "ARRAY", items: point },
            complexes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["id", "accepted", "confidence", "startX", "endX", "markers", "morphology", "evidence"],
                properties: {
                  id: { type: "STRING" },
                  accepted: { type: "BOOLEAN" },
                  confidence,
                  startX: { type: "INTEGER" },
                  endX: { type: "INTEGER" },
                  markers: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      required: ["type", "x", "y", "confidence"],
                      properties: {
                        type: { type: "STRING" },
                        x: { type: "INTEGER" },
                        y: { type: "INTEGER" },
                        confidence
                      }
                    }
                  },
                  morphology: { type: "ARRAY", items: finding },
                  evidence: { type: "STRING" }
                }
              }
            },
            morphology: { type: "ARRAY", items: finding },
            visualEvidence: { type: "STRING" }
          }
        }
      },
      artifacts: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["type", "box", "confidence", "evidence"],
          properties: {
            type: { type: "STRING" },
            box: { type: "ARRAY", items: { type: "INTEGER" } },
            confidence,
            evidence: { type: "STRING" }
          }
        }
      },
      visualMeasurements: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["key", "value", "unit", "confidence", "evidence"],
          properties: {
            key: { type: "STRING" },
            value: nullableNumber,
            unit: { type: "STRING" },
            confidence,
            evidence: { type: "STRING" }
          }
        }
      },
      suggestedInterpretation: {
        type: "OBJECT",
        required: ["label", "confidence", "evidenceFor", "evidenceAgainst", "missingData"],
        properties: {
          label: { type: "STRING" },
          confidence,
          evidenceFor: { type: "ARRAY", items: { type: "STRING" } },
          evidenceAgainst: { type: "ARRAY", items: { type: "STRING" } },
          missingData: { type: "ARRAY", items: { type: "STRING" } }
        }
      },
      alternatives: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["label", "confidence", "reason", "missingData"],
          properties: {
            label: { type: "STRING" },
            confidence,
            reason: { type: "STRING" },
            missingData: { type: "ARRAY", items: { type: "STRING" } }
          }
        }
      },
      limitations: { type: "ARRAY", items: { type: "STRING" } }
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
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      const result = await callGeminiModel({ model, payload, apiKey });
      if (result.ok) return { ok: true, model, raw: result.raw, attemptedModels };
      lastStatus = result.status;
      lastDetails = result.raw;
      if (result.status === 400 || result.status === 404) break;
      if (!RETRYABLE_STATUS.has(result.status)) {
        return { ok: false, status: result.status, details: result.raw, attemptedModels };
      }
    }
  }

  return { ok: false, status: lastStatus, details: lastDetails, attemptedModels };
}

async function callGeminiModel({ model, payload, apiKey }) {
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
      raw = { error: { message: "Respuesta remota no JSON" } };
    }
    return { ok: response.ok, status: response.status, raw };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      raw: { error: { status: "NETWORK_ERROR", message: cleanText(error?.message || "Error de red", 300) } }
    };
  }
}

function sanitizeResult(result, input) {
  const safe = result && typeof result === "object" ? result : {};
  safe.quality = sanitizeQuality(safe.quality);
  safe.calibration = sanitizeCalibration(safe.calibration);
  safe.mainLead = LEAD_NAMES.has(safe.mainLead) ? safe.mainLead : input.primaryLead || "II";
  safe.leads = sanitizeLeads(safe.leads, input.leads);
  safe.artifacts = sanitizeArtifacts(safe.artifacts);
  safe.visualMeasurements = sanitizeVisualMeasurements(safe.visualMeasurements);
  safe.suggestedInterpretation = sanitizeSuggestion(safe.suggestedInterpretation);
  safe.alternatives = sanitizeAlternatives(safe.alternatives);
  safe.limitations = sanitizeStringArray(safe.limitations, 20, 300);
  return safe;
}

function sanitizeQuality(value) {
  return {
    status: ["interpretable", "parcial", "no interpretable"].includes(value?.status) ? value.status : "parcial",
    confidence: clamp01(value?.confidence),
    imageQuality: cleanText(value?.imageQuality || "No especificada", 500),
    limitations: sanitizeStringArray(value?.limitations, 20, 300)
  };
}

function sanitizeCalibration(value) {
  return {
    scaleReliable: Boolean(value?.scaleReliable),
    confidence: clamp01(value?.confidence),
    source: cleanText(value?.source || "no determinada", 200),
    pxPerMmX: finiteOrNull(value?.pxPerMmX),
    pxPerMmY: finiteOrNull(value?.pxPerMmY),
    gridAngleDeg: finiteOrNull(value?.gridAngleDeg),
    pulse1mV: {
      detected: Boolean(value?.pulse1mV?.detected),
      confidence: clamp01(value?.pulse1mV?.confidence),
      box: sanitizeBox(value?.pulse1mV?.box)
    }
  };
}

function sanitizeLeads(values, declared) {
  if (!Array.isArray(values)) return [];
  const used = new Set();
  return values.slice(0, MAX_LEADS).map((lead, index) => {
    let name = LEAD_NAMES.has(lead?.name) ? lead.name : declared[index] || "II";
    if (used.has(name)) name = declared.find(item => !used.has(item)) || name;
    used.add(name);
    const complexes = Array.isArray(lead?.complexes)
      ? lead.complexes.slice(0, MAX_COMPLEXES).map((complex, i) => sanitizeComplex(complex, i))
      : [];
    return {
      name,
      box: sanitizeBox(lead?.box),
      confidence: clamp01(lead?.confidence),
      quality: cleanText(lead?.quality || "No especificada", 300),
      trace: sanitizePoints(lead?.trace, MAX_POINTS_PER_LEAD),
      complexes,
      morphology: sanitizeFindings(lead?.morphology, 40),
      visualEvidence: cleanText(lead?.visualEvidence || "", 800)
    };
  });
}

function sanitizeComplex(complex, index) {
  const markers = Array.isArray(complex?.markers)
    ? complex.markers.slice(0, MAX_MARKERS_PER_COMPLEX).map(marker => ({
        type: MARKER_TYPES.has(marker?.type) ? marker.type : "iso",
        x: clampCoord(marker?.x),
        y: clampCoord(marker?.y),
        confidence: clamp01(marker?.confidence)
      })).sort((a, b) => a.x - b.x)
    : [];
  return {
    id: cleanText(complex?.id || `c${index + 1}`, 60),
    accepted: complex?.accepted !== false,
    confidence: clamp01(complex?.confidence),
    startX: clampCoord(complex?.startX),
    endX: clampCoord(complex?.endX),
    markers,
    morphology: sanitizeFindings(complex?.morphology, 30),
    evidence: cleanText(complex?.evidence || "", 600)
  };
}

function sanitizeFindings(values, max) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, max).map(item => ({
    name: cleanText(item?.name || "hallazgo", 120),
    state: ["presente", "ausente", "indeterminada"].includes(item?.state) ? item.state : "indeterminada",
    confidence: clamp01(item?.confidence),
    evidence: cleanText(item?.evidence || "", 400)
  }));
}

function sanitizeArtifacts(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 30).map(item => ({
    type: cleanText(item?.type || "artefacto", 100),
    box: sanitizeBox(item?.box),
    confidence: clamp01(item?.confidence),
    evidence: cleanText(item?.evidence || "", 400)
  }));
}

function sanitizeVisualMeasurements(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 40).map(item => ({
    key: cleanText(item?.key || "measurement", 80),
    value: finiteOrNull(item?.value),
    unit: cleanText(item?.unit || "", 40),
    confidence: clamp01(item?.confidence),
    evidence: cleanText(item?.evidence || "", 400)
  }));
}

function sanitizeSuggestion(value) {
  return {
    label: cleanText(value?.label || "Interpretación visual no concluyente", 180),
    confidence: clamp01(value?.confidence),
    evidenceFor: sanitizeStringArray(value?.evidenceFor, 15, 300),
    evidenceAgainst: sanitizeStringArray(value?.evidenceAgainst, 15, 300),
    missingData: sanitizeStringArray(value?.missingData, 15, 300)
  };
}

function sanitizeAlternatives(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 3).map(item => ({
    label: cleanText(item?.label || "Alternativa", 180),
    confidence: clamp01(item?.confidence),
    reason: cleanText(item?.reason || "", 500),
    missingData: sanitizeStringArray(item?.missingData, 12, 250)
  }));
}

function sanitizePoints(values, max) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, max).map(item => ({
    x: clampCoord(item?.x),
    y: clampCoord(item?.y),
    confidence: clamp01(item?.confidence)
  })).sort((a, b) => a.x - b.x);
}

function sanitizeBox(value) {
  const source = Array.isArray(value) ? value.slice(0, 4).map(clampCoord) : [0, 0, 1000, 1000];
  while (source.length < 4) source.push(source.length < 2 ? 0 : 1000);
  const x1 = Math.min(source[0], source[2]);
  const y1 = Math.min(source[1], source[3]);
  const x2 = Math.max(source[0], source[2]);
  const y2 = Math.max(source[1], source[3]);
  return [x1, y1, x2, y2];
}

function sanitizeStringArray(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => cleanText(item, maxChars)).filter(Boolean);
}

function sanitizeRemoteError(value) {
  return {
    code: Number(value?.error?.code || 0) || null,
    status: cleanText(value?.error?.status || "REMOTE_ERROR", 100),
    message: cleanText(value?.error?.message || "Error del modelo", 500)
  };
}

function safeErrorLabel(status) {
  if (status === 429) return "Cuota o límite temporal alcanzado";
  if (status === 503) return "Modelo temporalmente saturado";
  if (status === 404) return "Modelo no disponible";
  if (status === 400) return "Solicitud no compatible con el modelo";
  return "No se pudo completar el análisis visual";
}

function cleanText(value, max = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampCoord(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : 0;
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
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
