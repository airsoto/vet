from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import langextract as lx

app = FastAPI(title="LangExtract API")

# CORS: permite llamadas desde GitHub Pages (o desde cualquier sitio)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExtractRequest(BaseModel):
    text: str

@app.get("/")
def root():
    return {"service": "LangExtract API", "ok": True}

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/extract")
def extract(req: ExtractRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text vacío")

    prompt = """
    Extrae elementos clínicos relevantes del texto.
    Devuelve una lista de items con:
      - type: (ej. "finding", "diagnosis", "anatomy", "measurement", "medication")
      - value: texto corto
      - certainty: (certain / uncertain)
    """

    try:
        model = lx.models.Gemini(model_id="gemini-1.5-flash")
        result = lx.extract(
            text_or_docs=text,
            prompt_description=prompt,
            model=model,
        )

        return {
            "extractions": [e.model_dump() for e in result.extractions],
            "meta": {
                "model": "gemini-1.5-flash",
                "n": len(result.extractions),
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
