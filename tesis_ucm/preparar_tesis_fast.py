#!/usr/bin/env python3
"""
Genera los archivos ligeros que usa index.html para acelerar el buscador de tesis UCM.

Uso recomendado desde la carpeta raíz de tu repo `vet`:

    python3 preparar_tesis_fast.py

Por defecto lee:
    json/tesis_ucm_v2.json

y crea:
    json/tesis_fast/manifest.json
    json/tesis_fast/catalog.json
    json/tesis_fast/chunks/chunk_0000.json ...
    json/tesis_fast/summary_index/a.json ... z.json, 0.json ... _.json

No modifica el JSON original.
"""

from __future__ import annotations
import argparse
import json
import math
import re
import gzip
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

STOPWORDS = {
    # Español
    'que','del','las','los','una','uno','unos','unas','para','por','con','sin','como','más','mas','entre','sobre','desde','hasta',
    'este','esta','estos','estas','ese','esa','esos','esas','aquel','aquella','sus','son','fue','han','hay','ser','se','al','en','de',
    'la','el','y','o','u','e','a','un','es','no','si','ya','su','lo','le','les','se','ha','he','as','hemos','han','muy','también','tambien',
    'estudio','trabajo','tesis','objetivo','objetivos','resultados','resultado','conclusiones','conclusion','analisis','análisis','datos',
    # Inglés frecuente en abstracts
    'the','and','for','with','from','that','this','these','those','was','were','are','is','of','to','in','on','by','as','an','a','or','not',
    'study','results','result','analysis','data','objective','objectives','conclusion','conclusions','we','our','their','has','have','had'
}

def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'\s+', ' ', s).strip()

def tokens(text: str):
    for tok in re.findall(r'[a-z0-9ñü]{3,}', norm(text)):
        if tok not in STOPWORDS and not tok.isdigit():
            yield tok

def year_of(value):
    m = re.search(r'(18|19|20|21)\d{2}', str(value or ''))
    return int(m.group(0)) if m else 0

def write_json(path: Path, obj, make_gzip=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    path.write_bytes(raw)
    if make_gzip:
        with gzip.open(str(path) + '.gz', 'wb', compresslevel=9) as f:
            f.write(raw)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default='json/tesis_ucm_v2.json')
    ap.add_argument('--output', default='json/tesis_fast')
    ap.add_argument('--chunk-size', type=int, default=250)
    ap.add_argument('--preview', type=int, default=260)
    ap.add_argument('--no-gzip', action='store_true', help='No crear copias .json.gz')
    args = ap.parse_args()

    src = Path(args.input)
    out = Path(args.output)
    if not src.exists():
        raise SystemExit(f'No existe: {src}')

    print(f'Leyendo {src} ...')
    with src.open(encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit('El JSON raíz debe ser una lista.')

    out.mkdir(parents=True, exist_ok=True)
    (out / 'chunks').mkdir(exist_ok=True)
    (out / 'summary_index').mkdir(exist_ok=True)
    make_gzip = not args.no_gzip

    catalog = []
    subject_counts = Counter()
    authors = set(); directors = set(); defense_years = []
    shards = defaultdict(lambda: defaultdict(list))

    chunk_size = max(50, args.chunk_size)
    num_chunks = math.ceil(len(data) / chunk_size)

    print(f'Generando {num_chunks} bloques de {chunk_size} tesis ...')
    for chunk_no in range(num_chunks):
        start = chunk_no * chunk_size
        chunk = []
        for local_idx, t in enumerate(data[start:start + chunk_size]):
            doc_id = start + local_idx
            rec = dict(t)
            rec['_id'] = doc_id
            chunk.append(rec)

            a = [x for x in (t.get('authors') or []) if x]
            d = [x for x in (t.get('directors') or []) if x]
            u = [x for x in (t.get('subjects_ucm') or []) if x]
            n = [x for x in (t.get('subjects_unesco') or []) if x]
            summary = str(t.get('summary') or '').strip()
            authors.update(a); directors.update(d); subject_counts.update(u)
            y = year_of(t.get('defense_date'))
            if y: defense_years.append(y)

            catalog.append({
                'id': doc_id,
                't': t.get('title') or '',
                'a': a,
                'd': d,
                'pd': t.get('pub_date') or '',
                'dd': t.get('defense_date') or '',
                'u': u,
                'n': n,
                'p': t.get('pdf') or '',
                'l': t.get('link') or '',
                'hs': bool(summary),
                'sp': summary[:args.preview],
                'c': chunk_no,
            })

            if summary:
                # Un id aparece una sola vez por token, aunque la palabra se repita en el resumen.
                for tok in set(tokens(summary)):
                    key = tok[0] if re.match(r'[a-z0-9]', tok[0]) else '_'
                    shards[key][tok].append(doc_id)

        write_json(out / 'chunks' / f'chunk_{chunk_no:04d}.json', chunk, make_gzip)

    print('Escribiendo catálogo ligero ...')
    write_json(out / 'catalog.json', catalog, make_gzip)

    print('Escribiendo índice de resúmenes ...')
    for key, mapping in shards.items():
        # Orden determinista y listas de ids crecientes.
        ordered = {k: mapping[k] for k in sorted(mapping)}
        write_json(out / 'summary_index' / f'{key}.json', ordered, make_gzip)

    top_subjects = [{'name': name, 'count': count} for name, count in subject_counts.most_common(20)]
    manifest = {
        'version': 1,
        'total': len(data),
        'authors': len(authors),
        'directors': len(directors),
        'subjects': len(subject_counts),
        'minDefense': min(defense_years) if defense_years else 0,
        'maxDefense': max(defense_years) if defense_years else 0,
        'chunkSize': chunk_size,
        'chunks': num_chunks,
        'topSubjects': top_subjects,
    }
    write_json(out / 'manifest.json', manifest, make_gzip)

    original_size = src.stat().st_size
    catalog_size = (out / 'catalog.json').stat().st_size
    print('\nListo.')
    print(f'Tesis: {len(data):,}')
    print(f'JSON original: {original_size / 1024 / 1024:.2f} MB')
    print(f'Catálogo inicial: {catalog_size / 1024 / 1024:.2f} MB')
    gz_path = out / 'catalog.json.gz'
    if gz_path.exists(): print(f'Catálogo comprimido: {gz_path.stat().st_size / 1024 / 1024:.2f} MB')
    if original_size:
        print(f'Reducción de carga inicial: {(1 - catalog_size/original_size)*100:.1f}%')
    print(f'Salida: {out}')

if __name__ == '__main__':
    main()
