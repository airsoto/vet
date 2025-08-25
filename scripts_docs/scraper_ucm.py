#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import json

options = webdriver.ChromeOptions()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

BASE_URL = "https://docta.ucm.es"
all_theses = []
thesis_links = []

# 1️⃣ Recolectar enlaces de títulos de todas las páginas
page = 1
while True:
    url = f"{BASE_URL}/browse/type?value=doctoral%20thesis&bbm.page={page}"
    print(f"📄 Cargando {url}")
    driver.get(url)

    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a.item-list-title"))
        )
    except:
        print(f"⚠️ No se encontraron tesis en la página {page}. Fin.")
        break

    links = driver.find_elements(By.CSS_SELECTOR, "a.item-list-title")
    if not links:
        print(f"⚠️ Página {page} vacía. Fin.")
        break

    for l in links:
        href = l.get_attribute("href")
        link = href if href.startswith("http") else BASE_URL + href
        thesis_links.append({"title": l.text.strip(), "link": link})

    page += 1

print(f"🔗 Encontrados {len(thesis_links)} enlaces de tesis")

# 2️⃣ Extraer metadatos de cada tesis
for t in thesis_links:
    driver.get(t["link"])
    print(f"➡️ {t['title']}")

    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "ds-item-page"))
        )
    except:
        print("   ⚠️ No se pudo cargar el detalle")
        continue

    # Autores
    authors = []
    try:
        author_section = driver.find_element(By.XPATH, "//h2[contains(text(),'Autores')]/following::div[1]")
        authors = [a.text.strip() for a in author_section.find_elements(By.CSS_SELECTOR, "a.ds-browse-link")]
    except:
        pass

    # Directores
    directors = []
    try:
        director_section = driver.find_element(By.XPATH, "//h2[contains(text(),'Directores')]/following::div[1]")
        directors = [a.text.strip() for a in director_section.find_elements(By.CSS_SELECTOR, "a.ds-browse-link")]
    except:
        pass

    # Resumen
    summary = ""
    try:
        summary_el = driver.find_element(By.CSS_SELECTOR, "ds-item-page-abstract-field span.preserve-line-breaks")
        summary = summary_el.text.strip()
    except:
        pass

    # Fechas
    pub_date = ""
    defense_date = ""
    try:
        pub_date = driver.find_element(By.XPATH, "//h5[contains(text(),'Fecha de publicación')]/following::p[1]").text.strip()
    except:
        pass
    try:
        defense_date = driver.find_element(By.XPATH, "//h5[contains(text(),'Fecha de defensa')]/following::p[1]").text.strip()
    except:
        pass

    # Materias UCM
    subjects_ucm = []
    try:
        subj_ucm_section = driver.find_element(By.XPATH, "//h2[contains(text(),'Materias UCM')]/following::div[1]")
        subjects_ucm = [a.text.strip() for a in subj_ucm_section.find_elements(By.CSS_SELECTOR, "a.ds-browse-link")]
    except:
        pass

    # Materias Unesco
    subjects_unesco = []
    try:
        subj_unesco_section = driver.find_element(By.XPATH, "//h2[contains(text(),'Materias Unesco')]/following::div[1]")
        subjects_unesco = [a.text.strip() for a in subj_unesco_section.find_elements(By.CSS_SELECTOR, "a.ds-browse-link")]
    except:
        pass

    # PDF descarga
    pdf_link = ""
    try:
        pdf_link = driver.find_element(By.CSS_SELECTOR, "a[href*='/bitstreams/'][href*='download']").get_attribute("href")
    except:
        pass

    all_theses.append({
        "title": t["title"],
        "link": t["link"],
        "authors": authors,
        "directors": directors,
        "summary": summary,
        "pub_date": pub_date,
        "defense_date": defense_date,
        "subjects_ucm": subjects_ucm,
        "subjects_unesco": subjects_unesco,
        "pdf": pdf_link
    })

driver.quit()

# 3️⃣ Guardar en JSON
with open("tesis_ucm.json", "w", encoding="utf-8") as f:
    json.dump(all_theses, f, ensure_ascii=False, indent=2)

print(f"✅ Guardadas {len(all_theses)} tesis en tesis_ucm.json")
