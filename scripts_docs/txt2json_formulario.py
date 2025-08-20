#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Extrae fichas farmacológicas desde un .txt y genera JSON estructurado.

Campos por ficha:
- farmaco
- formulaciones
- accion
- usar
- seguridad_manipulacion
- contraindicaciones
- reacciones_adversas
- interacciones_farmacologicas
- dosis_perros
- dosis_gatos
- dosis_otros

Uso:
  python parse_fichas_txt.py input.txt -o salida.json
"""

import re
import json
import argparse
from typing import List, Dict, Tuple

# --- Patrones de secciones (tolerantes a acentos; multiline) ---
PATS = {
    "formulaciones": re.compile(r"^\s*Formulaciones\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "accion": re.compile(r"^\s*Acci[oó]n\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "usar": re.compile(r"^\s*Usar\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "seguridad": re.compile(r"^\s*Seguridad\s+y\s+manipulaci[oó]n\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "contra": re.compile(r"^\s*Contraindicaciones\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "reacciones": re.compile(r"^\s*Reacciones\s+adversas\s*:\s*", re.IGNORECASE | re.MULTILINE),
    "interacciones": re.compile(r"^\s*Interacciones\s+farmacol[oó]gicas\s*:\s*", re.IGNORECASE | re.MULTILINE),
    # Acepta "DOSIS" y "DOSIS:" indistintamente
    "dosis": re.compile(r"^\s*DOSIS\s*:?\s*", re.IGNORECASE | re.MULTILINE),
}

# Filtra líneas "ruidosas" típicas de OCR (una palabra de 1-3 letras)
RUIDO_LINEA = re.compile(r"^\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{1,3}\s*$")

def cargar_txt(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def limpiar_ruido(texto: str) -> str:
    lineas_limpias = []
    for ln in texto.splitlines():
        ln_stripped = ln.strip()
        if not ln_stripped:
            continue
        if ln_stripped.startswith("Formulario de animales pequeños"):
            continue
        if "onlinedoctranslator" in ln_stripped:
            continue
        if RUIDO_LINEA.match(ln_stripped):
            continue
        lineas_limpias.append(ln)
    return "\n".join(lineas_limpias)

def indices_formulaciones(texto: str, lines: List[str]) -> List[Tuple[int, int]]:
    idxs = []
    for i, ln in enumerate(lines):
        if re.match(r"^\s*Formulaciones\s*:\s*", ln, flags=re.IGNORECASE):
            # Buscar la línea no vacía anterior como 'farmaco'
            k = i - 1
            while k >= 0 and not lines[k].strip():
                k -= 1
            if k >= 0:
                idxs.append((k, i))
    return idxs

def limpiar_texto(s: str) -> str:
    s = s.strip()
    # Espacios
    s = re.sub(r"[ \t]+", " ", s)
    # Unir saltos de línea
    s = re.sub(r"\s*\n\s*", " ", s)
    # Arreglar dobles espacios antes de ;,:.
    s = re.sub(r"\s+([;:,\.])", r"\1", s)
    return s.strip()

def extraer_span(bloque: str, clave: str, patrones: Dict[str, re.Pattern]) -> str:
    pat = patrones[clave]
    m = pat.search(bloque)
    if not m:
        return ""
    inicio = m.end()
    fin = len(bloque)
    for otra, pat_otra in patrones.items():
        if otra == clave:
            continue
        n = pat_otra.search(bloque, inicio)
        if n and n.start() < fin:
            fin = n.start()
    return bloque[inicio:fin].strip()

def partir_en_bloques(texto: str) -> List[str]:
    lineas = texto.splitlines()
    idxs = indices_formulaciones(texto, lineas)
    bloques = []
    for n, (k_farmaco, i_form) in enumerate(idxs):
        inicio_linea = k_farmaco
        if n + 1 < len(idxs):
            siguiente_k, _ = idxs[n + 1]
            fin_linea = siguiente_k
        else:
            fin_linea = len(lineas)
        bloque = "\n".join(lineas[inicio_linea:fin_linea])
        bloques.append(bloque)
    return bloques

def extraer_farmaco_desde_bloque(bloque: str) -> str:
    lineas = bloque.splitlines()
    i_form = None
    for i, ln in enumerate(lineas):
        if re.match(r"^\s*Formulaciones\s*:\s*", ln, flags=re.IGNORECASE):
            i_form = i
            break
    if i_form is None:
        return ""
    k = i_form - 1
    while k >= 0 and not lineas[k].strip():
        k -= 1
    return limpiar_texto(lineas[k]) if k >= 0 else ""

# ---------- NUEVO PARSER DE DOSIS (más robusto) ----------
def extraer_dosis(dosis_txt: str) -> Tuple[str, str, str]:
    """
    Parsea el bloque DOSIS buscando encabezados de especies en cualquier posición:
    - "Perros, gatos:"  -> se copia a perros y gatos
    - "Perros:"         -> perros
    - "Gatos:"          -> gatos
    - "Pequeños mamíferos, aves, reptiles:" -> otros (bloque único)
    - "Pequeños mamíferos:" / "Aves:" / "Reptiles:" -> otros (se concatenan)
    Devuelve (perros, gatos, otros) con textos limpios.
    """
    txt = dosis_txt.strip()
    if not txt:
        return "", "", ""

    # Encabezados permitidos (no anclados a inicio de línea)
    header_re = re.compile(
        r"(?is)"  # DOTALL + IGNORECASE
        r"(Perros\s*,\s*gatos|Perros|Gatos|"
        r"Peque\w*\s+mam[ií]feros\s*,\s*aves\s*,\s*reptiles|"
        r"Peque\w*\s+mam[ií]feros|Aves|Reptiles)"
        r"\s*:",
        re.UNICODE,
    )

    # Buscar todos los encabezados y sus spans
    matches = list(header_re.finditer(txt))
    if not matches:
        # No hay encabezados internos; todo el bloque a "otros"
        return "", "", limpiar_texto(txt)

    spans = []
    for i, m in enumerate(matches):
        label = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(txt)
        content = txt[start:end]
        spans.append((label, content))

    perros, gatos = "", ""
    otros_parts = []

    def add_otros(lbl: str, body: str):
        body = limpiar_texto(body)
        if not body:
            return
        # Conservamos la etiqueta para claridad
        otros_parts.append(f"{lbl.strip()}: {body}")

    for label, content in spans:
        norm = label.lower()
        if "perros, gatos" in norm:
            chunk = limpiar_texto(content)
            if chunk:
                perros = (perros + " " + chunk).strip() if perros else chunk
                gatos  = (gatos  + " " + chunk).strip() if gatos  else chunk
        elif norm.startswith("perros"):
            chunk = limpiar_texto(content)
            if chunk:
                perros = (perros + " " + chunk).strip() if perros else chunk
        elif norm.startswith("gatos"):
            chunk = limpiar_texto(content)
            if chunk:
                gatos = (gatos + " " + chunk).strip() if gatos else chunk
        elif "peque" in norm and "mam" in norm and "aves" in norm and "reptiles" in norm:
            add_otros("Pequeños mamíferos, aves, reptiles", content)
        elif norm.startswith("peque"):  # Pequeños mamíferos
            add_otros("Pequeños mamíferos", content)
        elif norm.startswith("aves"):
            add_otros("Aves", content)
        elif norm.startswith("reptiles"):
            add_otros("Reptiles", content)
        else:
            # Cualquier otra etiqueta inesperada, la metemos en otros
            add_otros(label, content)

    otros = " | ".join(otros_parts)
    return perros, gatos, otros
# ----------------------------------------------------------

def parsear(texto: str) -> List[Dict]:
    texto = limpiar_ruido(texto)
    bloques = partir_en_bloques(texto)
    resultados = []

    pats = {
        "formulaciones": PATS["formulaciones"],
        "accion": PATS["accion"],
        "usar": PATS["usar"],
        "seguridad": PATS["seguridad"],
        "contra": PATS["contra"],
        "reacciones": PATS["reacciones"],
        "interacciones": PATS["interacciones"],
        "dosis": PATS["dosis"],
    }

    for bloque in bloques:
        farmaco = extraer_farmaco_desde_bloque(bloque)

        obj = {
            "farmaco": farmaco,
            "formulaciones": limpiar_texto(extraer_span(bloque, "formulaciones", pats)),
            "accion": limpiar_texto(extraer_span(bloque, "accion", pats)),
            "usar": limpiar_texto(extraer_span(bloque, "usar", pats)),
            "seguridad_manipulacion": limpiar_texto(extraer_span(bloque, "seguridad", pats)),
            "contraindicaciones": limpiar_texto(extraer_span(bloque, "contra", pats)),
            "reacciones_adversas": limpiar_texto(extraer_span(bloque, "reacciones", pats)),
            "interacciones_farmacologicas": limpiar_texto(extraer_span(bloque, "interacciones", pats)),
            "dosis_perros": "",
            "dosis_gatos": "",
            "dosis_otros": "",
        }

        dosis_txt = extraer_span(bloque, "dosis", pats)
        perros, gatos, otros = extraer_dosis(dosis_txt)
        obj["dosis_perros"] = perros
        obj["dosis_gatos"] = gatos
        obj["dosis_otros"] = otros

        resultados.append(obj)

    return resultados

def main():
    ap = argparse.ArgumentParser(description="Extrae fichas farmacológicas desde .txt a JSON.")
    ap.add_argument("input", help="Ruta al .txt de entrada")
    ap.add_argument("-o", "--output", help="Ruta al .json de salida (por defecto: imprime en stdout)")
    args = ap.parse_args()

    texto = cargar_txt(args.input)
    data = parsear(texto)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
