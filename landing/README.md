# landing/ — sitio de Reaper (estático, sin build)

Publicado en https://reaper.haroldmedrano33.workers.dev (worker `reaper`, cuenta Harold18m; los workers `centinela` y `gringola` redirigen aquí). Desplegar desde esta carpeta:
`env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CF_API_TOKEN -u CF_ACCOUNT_ID npx wrangler@4 deploy`.
`index.html` (web), `pitch.html` (láminas: flechas, N notas, F pantalla completa) y `pitch.pdf`. Las capturas de `img/` son del panel real en local con un sondeo de prueba hecho con curl; `assets/` es el kit de la skill taste-skill.

Al ejecutar el panel localmente, el servidor sirve esta presentación en
`http://127.0.0.1:8787/presentacion/`. Allí **Abrir el panel** lleva al dashboard vivo (reemplaza el texto exacto `href="#contact">Probar el panel`: no cambiarlo).
Las cifras de la página corresponden al benchmark histórico; las corridas de los cuatro servicios se consultan en Experimentos.

## Publicar el panel real en /panel (investigado, no hecho)
1. El front se compila sin tocar código: `VITE_SENTINEL_URL=/panel npx vite build --base /panel/` desde `apps/web` (probado).
2. Le faltan los datos: el panel pide `/v1/health`, `/v1/snapshot`, `/v1/tracks`, `/v1/tracks/:id`, `/v1/findings`, `/v1/attackers/:ip` y `/v1/evidence-demo`; se pueden guardar como JSON desde un servidor local con datos cargados.
3. `/v1/stream` es SSE y `/v1/copilot/messages` llama a Anthropic: un worker de 20 líneas respondería un stream vacío y un 503 de «solo lectura».
4. El servidor real (Hono + `node:sqlite` + Anthropic) no corre en Workers sin portarlo; para el panel vivo hace falta un VM o contenedor con Node 24.
5. Riesgo: una foto estática no muestra agentes nuevos; hay que decirlo en la página. Estimado: 45 minutos.
