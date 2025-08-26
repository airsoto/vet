#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#python3 scraper_ucm.py --start 1 --end 2240 --batch 500

import json
import time
import argparse
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# Configuración del navegador
options = webdriver.ChromeOptions()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")

driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

BASE_URL = "https://docta.ucm.es"


# -------- Función para extraer datos de una tesis -------- #
def extract_thesis_data(link):
    driver.get(link)
    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, "h1.item-page-title-field"))
        )
    except:
        print(f"⚠️ No se pudo cargar {link}")
        return None

    data = {
        "title": "",
        "link": link,
        "authors": [],
        "directors": [],
        "summary": "",
        "pub_date": "",
        "defense_date": "",
        "subjects_ucm": [],
        "subjects_unesco": [],
        "pdf": ""
    }

    # Título
    try:
        data["title"] = driver.find_element(By.CSS_SELECTOR, "h1.item-page-title-field span").text.strip()
    except: pass

    # Autores
    try:
        authors = driver.find_elements(By.XPATH, "//h2[text()='Autores']/following::div[1]//a")
        data["authors"] = [a.text.strip() for a in authors]
    except: pass

    # Directores
    try:
        directors = driver.find_elements(By.XPATH, "//h2[contains(text(),'Directores')]/following::div[1]//a")
        data["directors"] = [d.text.strip() for d in directors]
    except: pass

    # Resumen
    try:
        data["summary"] = driver.find_element(By.XPATH, "//h2[text()='Resumen']/following::div[1]/span").text.strip()
    except: pass

    # Fechas
    try:
        data["pub_date"] = driver.find_element(By.XPATH, "//h5[text()='Fecha de publicación']/following::p").text.strip()
    except: pass
    try:
        data["defense_date"] = driver.find_element(By.XPATH, "//h5[text()='Fecha de defensa']/following::p").text.strip()
    except: pass

    # Materias UCM
    try:
        subjects_ucm = driver.find_elements(By.XPATH, "//h2[text()='Materias UCM']/following::div[1]//a")
        data["subjects_ucm"] = [s.text.strip() for s in subjects_ucm]
    except: pass

    # Materias UNESCO
    try:
        subjects_unesco = driver.find_elements(By.XPATH, "//h2[text()='Materias Unesco']/following::div[1]//a")
        data["subjects_unesco"] = [s.text.strip() for s in subjects_unesco]
    except: pass

    # PDF
    try:
        pdf_link = driver.find_element(By.XPATH, "//a[contains(@href,'/bitstreams/') and contains(@href,'download')]")
        data["pdf"] = BASE_URL + pdf_link.get_attribute("href")
    except: pass

    return data


# -------- Main con paginación y lotes -------- #
def main(start, end, batch_size):
    thesis_data = []

    for page in range(start, end + 1):
        url = f"{BASE_URL}/search?spc.page={page}&f.itemtype=doctoral%20thesis,equals"
        print(f"📄 Cargando {url}")
        driver.get(url)

        try:
            WebDriverWait(driver, 10).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a.item-list-title"))
            )
        except:
            print(f"⚠️ No se encontraron tesis en la página {page}. Fin.")
            break

        thesis_links = driver.execute_script("""
            return Array.from(document.querySelectorAll('a.item-list-title'))
                        .map(a => ({title: a.innerText.trim(), link: a.href}));
        """)

        if not thesis_links:
            print(f"⚠️ Página {page} vacía. Fin.")
            break

        for t in thesis_links:
            link = t["link"]
            print(f"   🔗 Tesis: {link}")
            data = extract_thesis_data(link)
            if data:
                thesis_data.append(data)
            time.sleep(1)  # para no sobrecargar el servidor

            # Guardar en lotes
            if len(thesis_data) % batch_size == 0:
                filename = f"tesis_ucm_batch_{page}_{len(thesis_data)}.json"
                with open(filename, "w", encoding="utf-8") as f:
                    json.dump(thesis_data, f, ensure_ascii=False, indent=2)
                print(f"💾 Guardado lote en {filename}")

    # Guardar lo que quede
    if thesis_data:
        filename = f"tesis_ucm_{start}_{end}.json"
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(thesis_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Guardado archivo final {filename} con {len(thesis_data)} tesis.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scraper de tesis UCM")
    parser.add_argument("--start", type=int, default=1, help="Página inicial")
    parser.add_argument("--end", type=int, default=2, help="Página final")
    parser.add_argument("--batch", type=int, default=500, help="Tamaño de cada lote")
    args = parser.parse_args()

    main(args.start, args.end, args.batch)
    driver.quit()
