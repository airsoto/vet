const ALLOWED_ORIGINS = new Set([
  "https://airsoto.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

const MODEL_DEFAULT = "gemini-2.5-flash";

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
        model: env.GEMINI_MODEL || MODEL_DEFAULT
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

      const model = env.GEMINI_MODEL || MODEL_DEFAULT;
      const prompt = buildPrompt(input);
      const payload = {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
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

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await response.json();
      if (!response.ok) {
        return json({
          error: "Gemini rechazó la solicitud",
          status: response.status,
          details: raw
        }, response.status, cors);
      }

      const text = raw?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        return json({ error: "Gemini no devolvió contenido", raw }, 502, cors);
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return json({ error: "Gemini devolvió JSON no válido", rawText: text }, 502, cors);
      }

      result.meta = {
        model,
        analyzedAt: new Date().toISOString(),
        disclaimer: "Resultado experimental. Requiere revisión veterinaria del ECG original."
      };

      return json({ success: true, result }, 200, cors);
    } catch (error) {
      return json({ error: error.message || "Error interno" }, 400, cors);
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
  if (input.imageBase64.length > 18_000_000) throw new Error("Imagen demasiado grande");
  if (!Array.isArray(input.leads) || input.leads.length === 0) throw new Error("Selecciona al menos una derivación");
}

function buildPrompt(input) {
  const species = input.species === "cat" ? "gato" : "perro";
  const calibration = input.calibration
    ? `Referencia manual opcional de 5 x 5 mm: x=${input.calibration.x}, y=${input.calibration.y}, ancho=${input.calibration.w}, alto=${input.calibration.h}, en coordenadas normalizadas 0-1000.`
    : "No existe calibración manual. Usa la velocidad y sensibilidad declaradas y la cuadrícula visible; si no es fiable, devuelve null en las mediciones afectadas.";

  return `
Actúa como asistente experto en electrocardiografía veterinaria de pequeños animales.
Analiza la imagen del ECG sin inventar datos. Tu resultado es orientativo y será revisado por un veterinario.

CONFIGURACIÓN DECLARADA
- Especie: ${species}
- Tamaño del perro: ${input.dogSize || "no aplicable"}
- Velocidad: ${input.speed} mm/s
- Sensibilidad: ${input.sensitivity}
- Derivaciones declaradas: ${input.leads.join(", ")}
- Derivación principal: ${input.primaryLead || "II"}
- ${calibration}

TAREAS
1. Localiza las regiones de las derivaciones declaradas.
2. Sigue el trazado negro de cada derivación y devuelve una polilínea roja mediante puntos normalizados x/y de 0 a 1000 relativos a toda la imagen.
3. Marca P, Q, R, S y T cuando sean visibles.
4. Evalúa frecuencia, regularidad, relación P:QRS, ritmo y posibles arritmias.
5. Mide P, PR, QRS, R, QT, ST y T solo cuando la escala sea fiable.
6. Compara con valores normales de perro o gato e identifica desviaciones.
7. Distingue hallazgos firmes de sospechas y declara limitaciones.
8. No recomiendes tratamientos.

REGLAS DE TRAZADO
- Devuelve puntos ordenados de izquierda a derecha.
- Usa suficientes puntos para seguir la señal, pero no más de 900 por derivación.
- No traces cuadrícula, texto ni bordes.
- Cada región y cada punto debe usar coordenadas enteras entre 0 y 1000.
- Si no puedes seguir una derivación con confianza, devuelve points vacío.
`;
}

function responseSchema() {
  return {
    type: "OBJECT",
    required: ["quality", "mainLead", "leads", "rhythm", "arrhythmias", "measurements", "abnormalities", "conclusion"],
    properties: {
      quality: {
        type: "OBJECT",
        required: ["confidence", "score", "imageQuality", "limitations"],
        properties: {
          confidence: { type: "STRING", enum: ["alta", "media", "baja"] },
          score: { type: "NUMBER" },
          imageQuality: { type: "STRING" },
          limitations: { type: "ARRAY", items: { type: "STRING" } }
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
            box: { type: "ARRAY", items: { type: "INTEGER" } },
            points: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["x", "y"],
                properties: { x: { type: "INTEGER" }, y: { type: "INTEGER" } }
              }
            },
            markers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["wave", "x", "y", "confidence"],
                properties: {
                  wave: { type: "STRING", enum: ["P", "Q", "R", "S", "T"] },
                  x: { type: "INTEGER" },
                  y: { type: "INTEGER" },
                  confidence: { type: "STRING", enum: ["alta", "media", "baja"] }
                }
              }
            }
          }
        }
      },
      rhythm: {
        type: "OBJECT",
        required: ["diagnosis", "heartRateBpm", "regularity", "pQrsRelationship", "explanation"],
        properties: {
          diagnosis: { type: "STRING" },
          heartRateBpm: { type: ["NUMBER", "NULL"] },
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
            confidence: { type: "STRING", enum: ["alta", "media", "baja"] },
            evidence: { type: "STRING" }
          }
        }
      },
      measurements: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["parameter", "value", "unit", "reference", "status", "comment"],
          properties: {
            parameter: { type: "STRING" },
            value: { type: ["NUMBER", "NULL"] },
            unit: { type: "STRING" },
            reference: { type: "STRING" },
            status: { type: "STRING", enum: ["normal", "alto", "bajo", "anormal", "no medible", "revisar"] },
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
            confidence: { type: "STRING", enum: ["alta", "media", "baja"] },
            evidence: { type: "STRING" }
          }
        }
      },
      conclusion: { type: "STRING" }
    }
  };
}
