import requests
import xml.etree.ElementTree as ET
import json
import time

# Lista de revistas veterinarias
journals = [
    "Journal of Veterinary Internal Medicine",
    "Veterinary Record",
    "Journal of the American Veterinary Medical Association",
    "Veterinary Pathology",
    "Veterinary Journal",
    "Journal of Veterinary Cardiology",
    "Veterinary Dermatology",
    "Veterinary Anaesthesia and Analgesia",
    "Journal of Small Animal Practice"
]

# Función para buscar artículos por revista con paginación
def fetch_articles(journal, max_articles=1000):
    all_ids = []
    retstart = 0
    batch_size = 100
    while len(all_ids) < max_articles:
        query = f'{journal}[Journal] AND 1975:2024[DP]'
        esearch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        params = {
            "db": "pubmed",
            "term": query,
            "retstart": retstart,
            "retmax": batch_size,
            "retmode": "json"
        }
        res = requests.get(esearch_url, params=params)
        res.raise_for_status()
        ids = res.json()["esearchresult"].get("idlist", [])
        if not ids:
            break
        all_ids.extend(ids)
        retstart += batch_size
        time.sleep(0.34)  # respeta NCBI rate limit de 3 requests/seg
    return all_ids[:max_articles]

# Función para obtener detalles de artículos
def fetch_details(pmids):
    efetch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
    batch_size = 100
    articles = []
    for i in range(0, len(pmids), batch_size):
        chunk = pmids[i:i + batch_size]
        params = {
            "db": "pubmed",
            "id": ",".join(chunk),
            "retmode": "xml"
        }
        res = requests.get(efetch_url, params=params)
        res.raise_for_status()
        root = ET.fromstring(res.content)
        for article in root.findall(".//PubmedArticle"):
            info = {}
            article_info = article.find(".//Article")
            journal_info = article.find(".//Journal")

            info["title"] = article_info.findtext("ArticleTitle", default="[No title]")

            authors = article.findall(".//Author")
            info["authors"] = [
                f"{a.findtext('LastName', '')} {a.findtext('ForeName', '')}".strip()
                for a in authors if a.find("LastName") is not None
            ]

            info["journal"] = journal_info.findtext("Title", default="")
            info["volume"] = journal_info.findtext("JournalIssue/Volume", default="")
            info["issue"] = journal_info.findtext("JournalIssue/Issue", default="")
            info["year"] = journal_info.findtext("JournalIssue/PubDate/Year", default="")

            abstract_parts = article_info.findall("Abstract/AbstractText")
            abstract_full = " ".join([a.text.strip() for a in abstract_parts if a.text])
            info["abstract"] = abstract_full if abstract_full else "[No abstract available]"

            articles.append(info)
        time.sleep(0.34)  # NCBI rate limit
    return articles

# Extraer todos los artículos
resultados = []

for journal in journals:
    print(f"Obteniendo artículos de: {journal}")
    try:
        ids = fetch_articles(journal, max_articles=1000)
        print(f"  -> {len(ids)} artículos encontrados")
        articles = fetch_details(ids)
        resultados.extend(articles)
    except Exception as e:
        print(f"Error con {journal}: {e}")

# Guardar en JSON
with open("articulos_veterinarios.json", "w", encoding="utf-8") as f:
    json.dump(resultados, f, ensure_ascii=False, indent=2)

print("Exportación completada: articulos_veterinarios.json")
