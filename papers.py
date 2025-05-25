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
    "Journal of Small Animal Practice",
    "Journal of Feline Medicine and Surgery",
    "Journal of Veterinary Emergency and Critical Care",
    "Veterinary Medicine and Science",
    "The Journal of Veterinary Medical Science"
]

def fetch_all_articles(journal):
    """Devuelve todos los IDs de artículos desde PubMed para una revista dada"""
    all_ids = []
    retstart = 0
    batch_size = 100
    while True:
        query = f'{journal}[Journal] AND 1975:2025[DP]'
        url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        params = {
            "db": "pubmed",
            "term": query,
            "retstart": retstart,
            "retmax": batch_size,
            "retmode": "json"
        }
        res = requests.get(url, params=params)
        res.raise_for_status()
        ids = res.json()["esearchresult"].get("idlist", [])
        if not ids:
            break
        all_ids.extend(ids)
        retstart += batch_size
        print(f"  Descargados {len(all_ids)} IDs...")
        time.sleep(0.34)  # NCBI rate limit
    return all_ids

def fetch_details(pmids):
    """Devuelve información detallada de los artículos dados sus PMIDs"""
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
    batch_size = 100
    articles = []
    for i in range(0, len(pmids), batch_size):
        chunk = pmids[i:i + batch_size]
        params = {
            "db": "pubmed",
            "id": ",".join(chunk),
            "retmode": "xml"
        }
        res = requests.get(url, params=params)
        res.raise_for_status()
        root = ET.fromstring(res.content)
        for article in root.findall(".//PubmedArticle"):
            try:
                info = {}
                article_info = article.find(".//Article")
                journal_info = article.find(".//Journal")

                # Título
                info["title"] = article_info.findtext("ArticleTitle", default="[No title]")

                # Autores
                authors = article.findall(".//Author")
                info["authors"] = [
                    f"{a.findtext('LastName', '')} {a.findtext('ForeName', '')}".strip()
                    for a in authors if a.find("LastName") is not None
                ]

                # Revista, volumen, número y año
                info["journal"] = journal_info.findtext("Title", default="")
                info["volume"] = journal_info.findtext("JournalIssue/Volume", default="")
                info["issue"] = journal_info.findtext("JournalIssue/Issue", default="")

                # Año (se intenta extraer de varias ubicaciones posibles)
                pubdate = journal_info.find("JournalIssue/PubDate")
                year = pubdate.findtext("Year") or pubdate.findtext("MedlineDate", "")
                info["year"] = year

                # DOI
                article_ids = article.findall(".//ArticleId")
                doi = next((a.text for a in article_ids if a.get("IdType") == "doi"), "[No DOI]")
                info["doi"] = doi

                # Abstract
                abstract_parts = article_info.findall("Abstract/AbstractText")
                abstract_full = " ".join([a.text.strip() for a in abstract_parts if a.text])
                info["abstract"] = abstract_full if abstract_full else "[No abstract available]"

                # Palabras clave
                keywords = article.findall(".//KeywordList/Keyword")
                info["keywords"] = [kw.text.strip() for kw in keywords if kw.text] or ["[No keywords]"]

                articles.append(info)
            except Exception as e:
                print(f"  ⚠️ Error procesando artículo: {e}")
        time.sleep(0.34)
    return articles

# Proceso principal
resultados = []

for journal in journals:
    print(f"\n📚 Obteniendo artículos de: {journal}")
    try:
        ids = fetch_all_articles(journal)
        print(f"  ✅ {len(ids)} artículos encontrados")
        articles = fetch_details(ids)
        resultados.extend(articles)
    except Exception as e:
        print(f"❌ Error con {journal}: {e}")

# Guardar en archivo JSON
with open("articulos_veterinarios.json", "w", encoding="utf-8") as f:
    json.dump(resultados, f, ensure_ascii=False, indent=2)

print("\n🎉 Exportación completada: articulos_veterinarios.json")
