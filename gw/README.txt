GRAVITATIONAL WAVE EXPLORER

Estructura lista para publicar:

sw/
  index.html
  data/
    events.json
    GW150914_H1.json
    GW150914_L1.json
    GW150914_H1_16k.json
    GW150914_L1_16k.json

IMPORTANTE:
- Sirve la carpeta desde un servidor HTTP/HTTPS. No abras index.html como file:// porque fetch() puede bloquear la carga de los JSON.
- En GitHub Pages basta con subir la carpeta completa /sw.
- La web carga primero los archivos de 4 kHz y solo descarga los de 16 kHz cuando se pulsa "Alta resolución · 16 kHz".
