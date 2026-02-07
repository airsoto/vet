import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

# LangExtract
import langextract as lx

app = FastAPI(title="LangExtract API")

# CORS: permite llamadas desde GitHub Pages (o desde cualquier sitio)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # abierto (ya que no te preocupa privacidad)
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExtractRequest(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/extract")
def extract(req: ExtractRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text vacío")

    # Ejemplo de "esquema" simple: ajusta a lo que quieras extraer
    # (hallazgos, anatomía, diagnóstico, etc.)
    prompt = """
    Extrae elementos clínicos relevantes del texto.
    Devuelve una lista de items con:
      - type: (ej. "finding", "diagnosis", "anatomy", "measurement", "medication")
      - value: texto corto
      - certainty: (certain / uncertain)
    """

    try:
        # Cliente Gemini (requiere env var GOOGLE_API_KEY)
        # Si prefieres OpenAI, luego te indico el cambio.
        model = lx.models.Gemini(model_id="gemini-1.5-flash")  # rápido/barato

        result = lx.extract(
            text_or_docs=text,
            prompt_description=prompt,
            model=model,
        )

        # result suele ser un objeto; lo convertimos a dict serializable
        return {
            "extractions": [e.model_dump() for e in result.extractions],
            "meta": {
                "model": "gemini-1.5-flash",
                "n": len(result.extractions),
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
