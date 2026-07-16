const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const VERSION = "5.0.0";
const DEFAULT_MODEL = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest"];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const LEADS = new Set(["I", "II", "III", "aVR", "aVL", "aVF"]);
const MAX_IMAGE = 18_000_000;

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
        actions: ["extract", "interpret"]
      }, 200, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405, cors);
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origen no autorizado" }, 403, cors);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "Falta GEMINI_API_KEY" }, 500, cors);
    }

    try {
      const input = await request.json();
      const action = input.action || "extract";
      const started = Date.now();
      const analysisId = crypto.randomUUID();

      let prompt;
      let schema;
      let parts;

      if (action === "extract") {
        validateExtract(input);
        prompt = buildExtractPrompt(input);
        schema = extractSchema();
        parts = [
          { text: prompt },
          { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } }
        ];
      } else if (action === "interpret") {
        validateInterpret(input);
        prompt = buildInterpretPrompt(input);
        schema = interpretSchema();
        parts = [{ text: prompt }];
      } else {
        throw new Error("Acción no válida");
      }

      const payload = {
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: action === "extract" ? 0.05 : 0.15,
          maxOutputTokens: action === "extract" ? 16384 : 8192,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      };

      const preferred = env.GEMINI_MODEL || DEFAULT_MODEL;
      const models = [...new Set([preferred, ...FALLBACK_MODELS])];
      const gemini = await callWithFallback(models, payload, env.GEMINI_API_KEY);

      if (!gemini.ok) {
        return json({
          error: "Gemini no pudo completar la solicitud",
          status: gemini.status,
          attemptedModels: gemini.attemptedModels,
          details: safeRemoteError(gemini.details),
          version: VERSION,
          analysisId
        }, normalizeStatus(gemini.status), cors);
      }

      const text = gemini.raw?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        return json({ error: "Gemini no devolvió contenido", version: VERSION, analysisId }, 502, cors);
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return json({ error: "Gemini devolvió JSON no válido", version: VERSION, analysisId }, 502, cors);
      }

      result = action === "extract"
        ? sanitizeExtraction(result, input)
        : sanitizeInterpretation(result);

      result.meta = {
        action,
        model: gemini.model,
        attemptedModels: gemini.attemptedModels,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        version: VERSION,
        analysisId,
        disclaimer: "Resultado experimental. Requiere validación veterinaria del ECG original."
      };

      return json({ success: true, result }, 200, cors);
    } catch (error) {
      return json({ error: String(error?.message || "Error interno").slice(0, 300), version: VERSION }, 400, cors);
    }
  }
};

function validateExtract(input) {
  if (!input || typeof input !== "object") throw new Error("Solicitud vacía");
  if (!input.imageBase64 || typeof input.imageBase64 !== "string") throw new Error("Falta imageBase64");
  if (input.imageBase64.length > MAX_IMAGE) throw new Error("Imagen demasiado grande");
  if (!/^image\/(jpeg|png|webp)$/.test(input.mimeType || "")) throw new Error("Formato no permitido");
  if (!["dog", "cat"].includes(input.species)) throw new Error("Especie no válida");
  if (![25, 50, "25", "50"].includes(input.speed)) throw new Error("Velocidad no válida");
  if (!Array.isArray(input.leads) || !input.leads.length) throw new Error("Selecciona al menos una derivación");
  if (!input.leads.every(x => LEADS.has(x))) throw new Error("Derivación no válida");
  if (!LEADS.has(input.primaryLead || "II")) throw new Error("Derivación principal no válida");
}

function validateInterpret(input) {
  if (!input || typeof input !== "object") throw new Error("Solicitud vacía");
  if (!input.confirmedTrace || typeof input.confirmedTrace !== "object") throw new Error("Falta el trazado confirmado");
  if (!input.features || typeof input.features !== "object") throw new Error("Faltan las mediciones calculadas");
}

function buildExtractPrompt(input) {
  const species = input.species === "cat" ? "gato" : "perro";
  const regions = Array.isArray(input.leadRegions) && input.leadRegions.length
    ? input.leadRegions.map(r => `${r.name}: [${(r.box || []).join(",")}]`).join("; ")
    : "sin regiones manuales";
  const calibration = input.calibration
    ? `Referencia manual de 5x5 mm: ${JSON.stringify(input.calibration)}`
    : "Sin referencia manual.";

  return `
Actúa como extractor visual de ECG veterinario para ${species}. No emitas todavía el diagnóstico final.
Analiza solo el trazado contenido en las regiones declaradas. Ignora cabeceras, texto, nombres, bordes y cuadrícula.

CONFIGURACIÓN
- Velocidad: ${input.speed} mm/s
- Sensibilidad: ${input.sensitivity}
- Derivaciones presentes: ${input.leads.join(", ")}
- Derivación principal: ${input.primaryLead || "II"}
- Regiones manuales: ${regions}
- ${calibration}

OBJETIVO
1. Localizar o corregir las cajas de las derivaciones.
2. Seguir aproximadamente el centro del trazado negro de cada derivación.
3. Detectar complejos y sus puntos:
   pStart, pPeak, pEnd, qrsStart, Q, R, Rprime, S, Sprime, qrsEnd, J, tStart, tPeak, tEnd, iso.
4. Detectar intervalos y segmentos: P, PR, QRS, ST, T, QT.
5. Indicar confianza por punto y complejo.
6. Evaluar si la escala horizontal y vertical es fiable.
7. No inventar medidas. Si no es visible, usar null o arrays vacíos.
8. No interpretar arritmias todavía.
9. Priorizar DII para P, relación P-QRS y ritmo.
10. Devolver polilíneas simplificadas; el navegador las ajustará a los píxeles reales.

COORDENADAS
- Todas las coordenadas entre 0 y 1000, relativas a la imagen enviada.
- box=[xMin,yMin,xMax,yMax].
- points ordenados de izquierda a derecha.
- máximo 450 puntos por derivación.
- máximo 40 complejos.
`;
}

function buildInterpretPrompt(input) {
  return `
Eres un especialista europeo en electrocardiografía veterinaria de perros y gatos.
Recibes un trazado ya revisado y confirmado por un veterinario, junto con mediciones matemáticas calculadas en JavaScript.
No vuelvas a medir la imagen y no modifiques los valores objetivos.

DATOS CONFIRMADOS
Configuración:
${JSON.stringify(input.config)}

Trazado confirmado:
${JSON.stringify(input.confirmedTrace).slice(0, 45000)}

Mediciones y características:
${JSON.stringify(input.features).slice(0, 45000)}

Reglas veterinarias activadas:
${JSON.stringify(input.rules || []).slice(0, 20000)}

Incoherencias detectadas:
${JSON.stringify(input.coherence || []).slice(0, 12000)}

INSTRUCCIONES
1. Interpreta exclusivamente estos datos confirmados.
2. Distingue mediciones objetivas, hallazgos de reglas y sugerencias clínicas.
3. Prioriza DII para ritmo y ondas P.
4. Usa I y III para eje solo cuando estén disponibles.
5. No diagnostiques fibrilación auricular sin ausencia de P y ritmo irregularmente irregular.
6. No diagnostiques bloqueo AV sin evaluar P, QRS y relación AV.
7. No diagnostiques origen ventricular solo por frecuencia.
8. No uses criterios humanos de infarto, isquemia o hipertrofia.
9. No recomiendes tratamientos.
10. Si faltan criterios, usa "no concluyente".
11. Devuelve hasta tres diagnósticos diferenciales con compatibilidad orientativa, no probabilidad clínica.
`;
}

function extractSchema() {
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
  const marker = {
    type: "OBJECT",
    required: ["type", "x", "y", "confidence"],
    properties: {
      type: {
        type: "STRING",
        enum: ["pStart", "pPeak", "pEnd", "qrsStart", "Q", "R", "Rprime", "S", "Sprime", "qrsEnd", "J", "tStart", "tPeak", "tEnd", "iso"]
      },
      x: { type: "INTEGER" },
      y: { type: "INTEGER" },
      confidence
    }
  };
  return {
    type: "OBJECT",
    required: ["quality", "calibration", "mainLead", "leads", "limitations"],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["status", "confidence", "imageQuality"],
        properties: {
          status: { type: "STRING", enum: ["interpretable", "parcial", "no interpretable"] },
          confidence,
          imageQuality: { type: "STRING" }
        }
      },
      calibration: {
        type: "OBJECT",
        required: ["scaleReliable", "confidence", "source", "pxPerMmX", "pxPerMmY"],
        properties: {
          scaleReliable: { type: "BOOLEAN" },
          confidence,
          source: { type: "STRING" },
          pxPerMmX: { type: "NUMBER", nullable: true },
          pxPerMmY: { type: "NUMBER", nullable: true }
        }
      },
      mainLead: { type: "STRING" },
      leads: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "box", "confidence", "baselineY", "points", "complexes"],
          properties: {
            name: { type: "STRING" },
            box: { type: "ARRAY", items: { type: "INTEGER" } },
            confidence,
            baselineY: { type: "NUMBER", nullable: true },
            points: { type: "ARRAY", items: point },
            complexes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["id", "accepted", "confidence", "markers", "segments"],
                properties: {
                  id: { type: "STRING" },
                  accepted: { type: "BOOLEAN" },
                  confidence,
                  markers: { type: "ARRAY", items: marker },
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
            }
          }
        }
      },
      limitations: { type: "ARRAY", items: { type: "STRING" } }
    }
  };
}

function interpretSchema() {
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
    required: ["summary", "rhythm", "findings", "differentials", "limitations", "conclusion"],
    properties: {
      summary: { type: "STRING" },
      rhythm: {
        type: "OBJECT",
        required: ["diagnosis", "confidence", "explanation"],
        properties: {
          diagnosis: { type: "STRING" },
          confidence: { type: "NUMBER" },
          explanation: { type: "STRING" }
        }
      },
      findings: { type: "ARRAY", items: finding },
      differentials: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["name", "compatibility", "confidence", "for", "against", "missing"],
          properties: {
            name: { type: "STRING" },
            compatibility: { type: "INTEGER" },
            confidence: { type: "NUMBER" },
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
  let lastDetails = null;

  for (const model of models) {
    attemptedModels.push(model);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(attempt === 1 ? 1200 : 3000);
      const result = await callModel(model, payload, apiKey);
      if (result.ok) return { ok: true, model, raw: result.raw, attemptedModels };
      lastStatus = result.status;
      lastDetails = result.raw;
      if (result.status === 400 || result.status === 404) break;
      if (!RETRYABLE.has(result.status)) return { ok: false, status: result.status, details: result.raw, attemptedModels };
    }
  }
  return { ok: false, status: lastStatus, details: lastDetails, attemptedModels };
}

async function callModel(model, payload, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload)
    });
    let raw;
    try { raw = await response.json(); }
    catch { raw = { error: { message: "Respuesta no JSON" } }; }
    return { ok: response.ok, status: response.status, raw };
  } catch (error) {
    return { ok: false, status: 503, raw: { error: { message: String(error?.message || "Error de red") } } };
  }
}

function sanitizeExtraction(result, input) {
  const clamp = n => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));
  const cleanConfidence = n => Math.max(0, Math.min(1, Number(n) || 0));
  const cleanLead = lead => {
    const box = Array.isArray(lead.box) && lead.box.length >= 4
      ? [clamp(lead.box[0]), clamp(lead.box[1]), clamp(lead.box[2]), clamp(lead.box[3])]
      : [0, 0, 1000, 1000];
    box[2] = Math.max(box[0] + 1, box[2]);
    box[3] = Math.max(box[1] + 1, box[3]);
    const points = (lead.points || []).slice(0, 450).map(p => ({
      x: clamp(p.x), y: clamp(p.y), confidence: cleanConfidence(p.confidence)
    })).sort((a, b) => a.x - b.x);
    const complexes = (lead.complexes || []).slice(0, 40).map((c, i) => ({
      id: String(c.id || `${lead.name || "II"}-${i + 1}`).slice(0, 60),
      accepted: c.accepted !== false,
      confidence: cleanConfidence(c.confidence),
      markers: (c.markers || []).slice(0, 24).map(m => ({
        type: String(m.type || "R"),
        x: clamp(m.x), y: clamp(m.y), confidence: cleanConfidence(m.confidence)
      })),
      segments: (c.segments || []).slice(0, 12).map(s => ({
        name: String(s.name || "QRS"),
        startX: clamp(s.startX),
        endX: clamp(s.endX),
        confidence: cleanConfidence(s.confidence)
      }))
    }));
    return {
      name: LEADS.has(lead.name) ? lead.name : "II",
      box,
      confidence: cleanConfidence(lead.confidence),
      baselineY: lead.baselineY == null ? null : clamp(lead.baselineY),
      points,
      complexes
    };
  };

  return {
    quality: {
      status: ["interpretable", "parcial", "no interpretable"].includes(result?.quality?.status) ? result.quality.status : "parcial",
      confidence: cleanConfidence(result?.quality?.confidence),
      imageQuality: String(result?.quality?.imageQuality || "").slice(0, 500)
    },
    calibration: {
      scaleReliable: Boolean(result?.calibration?.scaleReliable),
      confidence: cleanConfidence(result?.calibration?.confidence),
      source: String(result?.calibration?.source || "visual").slice(0, 120),
      pxPerMmX: Number.isFinite(Number(result?.calibration?.pxPerMmX)) ? Number(result.calibration.pxPerMmX) : null,
      pxPerMmY: Number.isFinite(Number(result?.calibration?.pxPerMmY)) ? Number(result.calibration.pxPerMmY) : null
    },
    mainLead: LEADS.has(result?.mainLead) ? result.mainLead : (input.primaryLead || "II"),
    leads: (result?.leads || []).slice(0, 6).map(cleanLead),
    limitations: (result?.limitations || []).slice(0, 20).map(x => String(x).slice(0, 500))
  };
}

function sanitizeInterpretation(result) {
  const confidence = n => Math.max(0, Math.min(1, Number(n) || 0));
  return {
    summary: String(result?.summary || "").slice(0, 1800),
    rhythm: {
      diagnosis: String(result?.rhythm?.diagnosis || "No concluyente").slice(0, 300),
      confidence: confidence(result?.rhythm?.confidence),
      explanation: String(result?.rhythm?.explanation || "").slice(0, 1800)
    },
    findings: (result?.findings || []).slice(0, 30).map(f => ({
      name: String(f.name || "").slice(0, 200),
      confidence: confidence(f.confidence),
      evidence: (f.evidence || []).slice(0, 8).map(x => String(x).slice(0, 300))
    })),
    differentials: (result?.differentials || []).slice(0, 3).map(d => ({
      name: String(d.name || "").slice(0, 200),
      compatibility: Math.max(0, Math.min(100, Math.round(Number(d.compatibility) || 0))),
      confidence: confidence(d.confidence),
      for: (d.for || []).slice(0, 8).map(x => String(x).slice(0, 300)),
      against: (d.against || []).slice(0, 8).map(x => String(x).slice(0, 300)),
      missing: (d.missing || []).slice(0, 8).map(x => String(x).slice(0, 300))
    })),
    limitations: (result?.limitations || []).slice(0, 20).map(x => String(x).slice(0, 500)),
    conclusion: String(result?.conclusion || "").slice(0, 1800)
  };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://airsoto.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
function json(data, status, headers) { return new Response(JSON.stringify(data), { status, headers }); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function normalizeStatus(status) { return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502; }
function safeRemoteError(details) {
  return { status: String(details?.error?.status || ""), message: String(details?.error?.message || "Error remoto").slice(0, 500) };
}
