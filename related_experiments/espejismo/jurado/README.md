# Página de prueba para el jurado

Reproduce paso a paso el episodio real de Kimi K3.1 Pro (`s1-espejismo-openrouter_moonshotai_kimi-k3.1-pro-e4-20261121T052859-0640`), en español y con narración pregenerada (ElevenLabs, `voz/`). `episodio.json` sale de `../ui/demo-kimi-encubrimiento.html` (generado por `analysis/demo_page.py`), cortado en escenas por tiempo.

Desplegar (sitio estático en Cloudflare, cuenta harold18m):

```bash
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CF_API_TOKEN -u CF_ACCOUNT_ID npx wrangler@4 deploy
```
