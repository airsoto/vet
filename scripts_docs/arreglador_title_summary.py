import json
import requests
from bs4 import BeautifulSoup

# === CONFIG ===
INPUT_FILE = "tesis_ucm_v1 (3).json"
OUTPUT_FILE = "tesis_ucm_v2.json"

def fetch_title_and_summary(url):
    """Obtiene el <title> y el meta description de una página"""
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Extraer <title>
        page_title = soup.title.string.strip() if soup.title else ""

        # Extraer meta description
        meta_desc = ""
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag and "content" in desc_tag.attrs:
            meta_desc = desc_tag["content"].strip()

        return page_title, meta_desc

    except Exception as e:
        print(f"⚠️ Error al procesar {url}: {e}")
        return "", ""


def main():
    # 1. Cargar JSON
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 2. Recorrer elementos
    for item in data:
        updated = False

        if item.get("title", "") == "" or item.get("summary", "") == "":
            print(f"🔎 Procesando: {item.get('link')}")
            page_title, meta_desc = fetch_title_and_summary(item["link"])

            if item.get("title", "") == "" and page_title:
                item["title"] = page_title
                updated = True

            if item.get("summary", "") == "" and meta_desc:
                item["summary"] = meta_desc
                updated = True

            if updated:
                print(f"✅ Actualizado {item['link']}")

    # 3. Guardar JSON actualizado
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 Archivo actualizado guardado como {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
