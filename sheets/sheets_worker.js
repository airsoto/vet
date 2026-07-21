/**
 * Cloudflare Worker para generar hojas informativas veterinarias con Gemini.
 *
 * Variable secreta necesaria:
 *   GEMINI_API_KEY
 *
 * Configuración:
 *   npx wrangler secret put GEMINI_API_KEY
 *
 * Opcional:
 *   ALLOWED_ORIGIN=https://airsoto.github.io
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_INPUT_CHARS = 90000;

const BASE_PROMPT = `
Eres un veterinario clínico y redactor médico especializado en comunicación con propietarios de perros y gatos.

Recibirás el título de un tema y el contenido de una ficha veterinaria en JSON transformado a texto. Debes crear una hoja informativa profesional, clara, atractiva, ordenada y fácil de comprender para el propietario.

REGLAS OBLIGATORIAS:
1. Usa únicamente la información proporcionada. No inventes diagnósticos, dosis, pruebas, tratamientos, pronósticos ni recomendaciones.
2. Conserva la precisión clínica, pero explica los términos técnicos con lenguaje sencillo.
3. No sustituyas la valoración del veterinario ni presentes el contenido como diagnóstico individual.
4. No incluyas instrucciones para modificar, iniciar o suspender medicación sin consultar al veterinario.
5. Distingue claramente:
   - qué es el problema;
   - signos que puede observar el propietario;
   - cómo se diagnostica;
   - tratamiento y cuidados;
   - qué hacer en casa;
   - qué evitar;
   - cuándo contactar con su veterinario;
   - cuándo acudir a urgencias;
   - seguimiento.
6. Incluye solo los apartados respaldados por el texto de origen. Si no existe información suficiente para un apartado, omítelo.
7. Resalta las urgencias reales con una línea que empiece exactamente por "⚠️".
8. Evita alarmismo, repeticiones, frases promocionales y referencias a páginas, edición, copyright o procedencia del PDF.
9. No menciones que estás usando inteligencia artificial ni que has recibido un JSON.
10. No añadas la referencia bibliográfica; la aplicación la incorpora automáticamente.
11. Escribe en español de España, con tono profesional, sereno y empático.
12. No uses tablas, salvo que sean imprescindibles.
13. Devuelve solo Markdown limpio. No uses bloques de código ni HTML.

ESTRUCTURA RECOMENDADA:
# [Título comprensible]
Breve introducción de dos o tres frases.

## Qué es
## Signos que puede observar
## Cómo se diagnostica
## Tratamiento y cuidados
## Qué puede hacer en casa
## Qué conviene evitar
## Cuándo contactar con su veterinario
## Cuándo acudir a urgencias
## Seguimiento

Adapta la estructura al contenido recibido y evita apartados vacíos.
`.trim();

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const configuredOrigin = env.ALLOWED_ORIGIN || "https://airsoto.github.io";
  const allowedOrigin =
    requestOrigin === configuredOrigin ||
    requestOrigin === "http://localhost:8787" ||
    requestOrigin.startsWith("http://127.0.0.1:")
      ? requestOrigin
      : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, env)
  });
}

function cleanString(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maxLength)
    : "";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method !== "POST") {
      return jsonResponse(request, env, { error: "Método no permitido." }, 405);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        request,
        env,
        { error: "Falta configurar el secreto GEMINI_API_KEY en Cloudflare." },
        500
      );
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return jsonResponse(request, env, { error: "El cuerpo debe ser JSON válido." }, 400);
    }

    const title = cleanString(input.title, 300);
    const category = cleanString(input.category, 200);
    const content = cleanString(input.content, MAX_INPUT_CHARS);

    if (!title || !content) {
      return jsonResponse(
        request,
        env,
        { error: "Son obligatorios los campos title y content." },
        400
      );
    }

    const userPrompt = `
TÍTULO DEL TEMA:
${title}

TIPO O CATEGORÍA:
${category || "No especificada"}

INFORMACIÓN DE ORIGEN:
${content}
`.trim();

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=` +
      encodeURIComponent(env.GEMINI_API_KEY);

    try {
      const geminiResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: BASE_PROMPT }]
          },
          contents: [{
            role: "user",
            parts: [{ text: userPrompt }]
          }],
          generationConfig: {
            temperature: 0.25,
            topP: 0.85,
            maxOutputTokens: 5000
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
          ]
        })
      });

      const data = await geminiResponse.json();

      if (!geminiResponse.ok) {
        console.error("Gemini error:", JSON.stringify(data));
        const message =
          data?.error?.message ||
          `Gemini devolvió el error ${geminiResponse.status}.`;
        return jsonResponse(request, env, { error: message }, 502);
      }

      const text = (data.candidates || [])
        .flatMap(candidate => candidate?.content?.parts || [])
        .map(part => part?.text || "")
        .join("")
        .trim();

      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || "sin contenido";
        return jsonResponse(
          request,
          env,
          { error: `Gemini no generó texto (${reason}).` },
          502
        );
      }

      return jsonResponse(request, env, {
        text,
        model: GEMINI_MODEL,
        title
      });
    } catch (error) {
      console.error(error);
      return jsonResponse(
        request,
        env,
        { error: "No se pudo conectar con Gemini." },
        502
      );
    }
  }
};
