# Centinela explicado (v3, 75,6 s, 1920x1080)

Video para entender Centinela de un vistazo (equipo, mentores, jurado). Orden desde la v2 (encuadre de Harold, 22/11 01:00): **primero el hallazgo, después el producto**. Metáfora de punta a punta: un ladrón (un agente de IA atacante) prueba puertas y ventanas de una casa (tu sitio).

| Escena | Tiempo | Qué muestra |
|---|---|---|
| 0 · El hallazgo | 0–18 s | «Si le niegas la prueba, se queda sin rumbo». Tres barras: 20 de 20 sin defensa, 20 de 20 por Cloudflare por defecto, 0 de 20 con nuestra pieza; sus límites al lado |
| 1 · El problema | 18–27 s | El ladrón prueba, lee la respuesta, ajusta y vuelve a probar, a velocidad de máquina |
| 2 · Por qué bloquear no alcanza | 27–31 s | El portazo le avisa que lo vieron y busca otra entrada |
| 3 · Para quién y cuatro pasos | 31–60 s | Equipos chicos con servidores propios. 1 Detecta · 2 Engaña · 3 Le niega la prueba · 4 Te lo muestra (captura real del panel) |
| 4 · Los límites | 60–68 s | Una sola app de prueba, reglas por defecto, sin confirmar en el panel de Cloudflare, el ataque igual se ejecuta; y el límite de la detección |
| 5 · Cierre | 68–76 s | «Bloquear le avisa. Centinela controla lo que el agente cree que pasó.» |

## Estilo (v3, dirección de Harold del 22/11)

Minimalista, de producto agéntico: fondo claro casi monocromo, un solo acento, líneas finas, píldoras y mucho aire (referencia de tono y ritmo: elevenlabs.io, visto en el navegador; no se copió marca, textos ni maquetación). Sans para las frases y monoespaciada para todo lo de «máquina». La protagonista es la **traza del agente** (petición → respuesta → siguiente intento): reemplaza a los dibujos de la casa y el ladrón, que siguen en la voz y en dos rótulos («ladrón = agente de IA», «casa = tu sitio»). Las trazas son ilustraciones y lo dicen en su cabecera.

**Marca:** `landing/marca/` todavía no existía en `centinela-web` (commit `98bcf59`). Colores (modo claro), fuentes (Reddit Sans, JetBrains Mono) y logo salen de la landing actual de esa rama. Cuando exista `landing/marca/`: cambiar los tokens de `:root` en `index.html`, los dos `.woff2` de `assets/fonts/` y el SVG del ojo, y renderizar.

Versiones anteriores: v2 (mismo guion y voz, estilo oscuro con dibujos) en `~/Downloads/centinela-explicado-v2.mp4` y commit `6073084`. La v1 (78,8 s; sin el hallazgo, con «lo que medimos» en tres cartas y Espejismo) en `~/Downloads/centinela-explicado-v1.mp4` y commit `635f482`.

Hecho con HyperFrames en un solo `index.html`; música, efectos y utilidades (`voz.sh`, `sincronizar.py`) de `related_experiments/espejismo/vault/espejismo-propuesta/`. Cada línea de `narracion.txt` es un subtítulo.

## Cambiar algo

- Solo imagen o texto en pantalla: editar `index.html` y renderizar.
- Guion: editar `narracion.txt`, `VELOCIDAD=1.2 ./voz.sh fxEPMjHccsIr94VUOijN eleven_multilingual_v2` (lee la clave del Llavero, servicio `ELEVENLABS_API_KEY`) y `python3 sincronizar.py`, que reescribe tiempos de escenas, subtítulos, música y efectos. Falla si cambia una frase ancla o si el total sale de 60–80 s.
- Revisar: `npx hyperframes check` y `npx hyperframes snapshot --at 0.2,11.5,17.5,20.5,30,32.5,56.5,59,62,67,74`.
- Renderizar (uno a la vez): `npx hyperframes render --quality high --workers 2 --output /tmp/centinela-explicado.mp4` y `ffmpeg -y -i /tmp/centinela-explicado.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k ~/Downloads/centinela-explicado.mp4`.

## Cifras (verificadas el 22/11 contra su fuente)

| En el video | Fuente |
|---|---|
| 20 de 20 sin defensa, 20 de 20 por Cloudflare (protección por defecto, plan gratuito), 0 de 20 con Último Paso; 2 modelos de IA, 10 corridas cada uno | `project-description.md` de main, «Lo que medimos» (benchmark propio, 22/11). No se abrieron los datos crudos de `ultimo-paso/scoreboard/runs/bench-cloudflare-2026-11-21/` en esta sesión |
| Sin esa prueba ningún agente declaró éxito y gastaron entre 3 y 11 veces más peticiones | Mismo párrafo |
| Límites: una sola app de prueba, reglas por defecto, sin confirmar en el panel de Cloudflare, el ataque se ejecutó en los tres caminos | `project-description.md`, «Límites, dichos de frente» y «Lo que medimos» |
| La detección no tuvo falsas alarmas; detecta 1 de cada 10 sesiones de sondeo; no se probó con agentes de IA | `agent-detection/eval/RESULTS.md`: 0 de 172; recall 10,50 % (44 de 419); «probing_ai recall n/a» |
| Para equipos chicos con servidores propios, sin equipo de seguridad | `gtm-centinela.md`, «Para quién» |

## Decisiones y límites

- Respeta la lista «No decir» de `gtm-centinela.md`: no dice «somos los primeros», «detecta agentes de IA» (dice «detecta a quien prueba puertas»), «evita el ataque», «mejor que Cloudflare» ni «Sentinel». Las barras llevan su límite en la misma pantalla.
- El hallazgo dura 18 s, no los 10 pedidos: decir el dato completo (tres caminos y el «3 a 11 veces») no entra en menos.
- **Paso 4:** `assets/panel/panel.png` es la captura real `landing/img/arreglo-propuesto.png` de la rama `centinela-web` (panel en local con un sondeo de prueba, según su README), recortada sin la barra superior y con un recuadro negro sobre una palabra: el nombre «Sentinel» del nodo central. Los aros y rótulos turquesa son del video, no del panel. Las rutas de las trazas (`/admin`, `/.env`, `/api/pagos`…) son ilustrativas, no datos medidos. La captura no muestra el botón de aprobar; «que una persona aprueba» sale de `project-description.md`.
- Para dar lugar al hallazgo salieron de la v1 las cifras 5 de 5, 0 de 34, 30 de 30 y Espejismo (9 de 18).
- **Voz:** Javier (ElevenLabs, `eleven_multilingual_v2`, velocidad 1,2; 71,7 s). Transcrita con Whisper (`medium`, es): dice el guion completo y todas las cifras; Whisper escribe «Sentinela», que suena igual que «Centinela». En la v1 se comparó con Nico, que se comió dos palabras. **Nadie la escuchó entera antes de entregar: conviene oírla.**
