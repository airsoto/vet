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
thesis_links = []

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

driver.quit()

with open("tesis_ucm_links.json", "w", encoding="utf-8") as f:
    json.dump(thesis_links, f, ensure_ascii=False, indent=2)

print(f"✅ Guardados {len(thesis_links)} enlaces en tesis_ucm_links.json")
