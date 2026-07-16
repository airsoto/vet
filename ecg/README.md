# Interpretador ECG Veterinario con Gemini

Aplicación web experimental para analizar imágenes de ECG de perro y gato mediante Gemini. La interfaz está alojada en GitHub Pages y la clave de Gemini permanece oculta en un Cloudflare Worker.

## Archivos

- `index.html`: aplicación web completa.
- `worker.js`: Cloudflare Worker que envía la imagen a Gemini y devuelve JSON estructurado.
- `wrangler.toml`: configuración opcional para desplegar el Worker con Wrangler.

## 1. Obtener una clave de Gemini

1. Abre Google AI Studio.
2. Crea una API key.
3. No escribas la clave dentro de `index.html` ni de `worker.js`.

## 2. Desplegar el Worker desde la web de Cloudflare

1. En Cloudflare entra en **Workers & Pages**.
2. Crea un Worker nuevo.
3. Copia el contenido de `worker.js`.
4. En **Settings > Variables and Secrets**, crea el secreto:

```text
GEMINI_API_KEY
```

5. Como valor pega la clave de Google AI Studio.
6. Opcionalmente crea la variable:

```text
GEMINI_MODEL = gemini-2.5-flash
```

7. Despliega el Worker y copia su URL, por ejemplo:

```text
https://ecg-gemini.tu-cuenta.workers.dev
```

## 3. Conectar el HTML

En `index.html`, busca:

```javascript
const GEMINI_WORKER_URL = "https://REEMPLAZA-TU-WORKER.workers.dev";
```

Sustituye la dirección por la URL real de tu Worker y guarda el cambio.

La aplicación quedará publicada en:

```text
https://airsoto.github.io/vet/ecg/
```

## 4. Desplegar con Wrangler desde Ubuntu

```bash
npm install -g wrangler
wrangler login
cd ecg
wrangler secret put GEMINI_API_KEY
wrangler deploy
```

Después copia la URL mostrada por Wrangler en `GEMINI_WORKER_URL` dentro de `index.html`.

## Funcionamiento

1. Cargar una imagen PNG, JPEG o WEBP.
2. Seleccionar perro o gato.
3. Indicar 25 o 50 mm/s.
4. Indicar sensibilidad de 0,5, 1 o 2 cm/mV.
5. Marcar las derivaciones visibles.
6. Seleccionar la derivación principal.
7. Pulsar **Analizar ECG con Gemini**.
8. La aplicación muestra ritmo, frecuencia, mediciones, posibles arritmias, alteraciones y superpone en rojo el trazado devuelto por Gemini.

La calibración manual de 5 x 5 mm es opcional y solo se ofrece cuando la confianza del análisis es baja.

## Privacidad

Las imágenes se envían a un proveedor externo. Deben eliminarse nombres, números de historia clínica, teléfonos, microchips y otros identificadores antes del análisis.

## Limitaciones

Gemini es un modelo multimodal generalista. Puede interpretar la imagen y devolver coordenadas aproximadas, pero no garantiza un seguimiento exacto píxel a píxel ni mediciones clínicas válidas. Todos los resultados requieren revisión veterinaria sobre el ECG original.
