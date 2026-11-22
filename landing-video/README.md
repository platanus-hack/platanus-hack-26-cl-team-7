# Centinela explicado (78,8 s, 1920x1080)

Video para entender Centinela de un vistazo (equipo, mentores, jurado). Metáfora de punta a punta: un ladrón (un agente de IA atacante) prueba puertas y ventanas de una casa (tu sitio).

| Escena | Qué muestra |
|---|---|
| 1 · El problema | El ladrón prueba, lee la respuesta, ajusta y vuelve a probar, a velocidad de máquina |
| 2 · Por qué bloquear no alcanza | El portazo le avisa que lo vieron y busca otra entrada |
| 3 · Cuatro pasos | 1 Detecta · 2 Engaña (casa de utilería) · 3 Le niega la prueba · 4 Te lo muestra (panel dibujado como esquema, no es captura) |
| 4 · Lo que medimos | Tres cartas, cada una con su límite en pantalla |
| 5 · De dónde sale la idea | Espejismo y el cierre |

Hecho con HyperFrames en un solo `index.html`; estilo, tipografías, música y utilidades de `related_experiments/espejismo/vault/espejismo-propuesta/`. Cada línea de `narracion.txt` es un subtítulo.

## Cambiar algo

- Solo imagen o texto en pantalla: editar `index.html` y renderizar.
- Guion: editar `narracion.txt`, `VELOCIDAD=1.2 ./voz.sh fxEPMjHccsIr94VUOijN eleven_multilingual_v2` (lee la clave del Llavero, servicio `ELEVENLABS_API_KEY`) y `python3 sincronizar.py`, que reescribe tiempos de escenas, subtítulos, música y efectos. Falla si cambia una frase ancla o si el total sale de 60–80 s.
- Revisar: `npx hyperframes check` y `npx hyperframes snapshot --at 6.5,12.9,16.4,23.6,28.9,36.3,44.2,63.6,72,78`.
- Renderizar (uno a la vez): `npx hyperframes render --quality high --workers 2 --output /tmp/centinela-explicado.mp4` y `ffmpeg -y -i /tmp/centinela-explicado.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 192k ~/Downloads/centinela-explicado.mp4`.

## Cifras (verificadas el 22/11 contra su fuente)

| En el video | Fuente |
|---|---|
| 5 de 5 intentos sin que la prueba le llegue al atacante | `ultimo-paso/README.md`: «Mock bank, scripted 5/5 → 0/5» |
| 0 de 34 pedidos legítimos bloqueados | `ultimo-paso/README.md`: «blocked 0 of 34 benign requests» |
| El ataque igual se ejecuta en el servidor | `ultimo-paso/README.md` (columna de ejecución 5/5 → 5/5) y Límites de `project-description.md` |
| 30 de 30 agentes de IA cayeron a la copia falsa | `project-description.md` y `gtm-centinela.md` (rama `motor-espejo`); no se reabrió el dato crudo en esta sesión |
| 0 falsas alarmas; detecta 1 de cada 10 sesiones de sondeo | `agent-detection/eval/RESULTS.md`: 0 de 172 sesiones humanas marcadas; recall 10,50 % (44 de 419) |
| Aún no se probó con agentes de IA | `RESULTS.md`: «probing_ai recall n/a (0 sessions)» |
| 95 corridas, 8 modelos; 9 de 18; no lo reportó en ninguna de 8 | `related_experiments/espejismo/results/RESUMEN.md` |

## Decisiones y límites

- Respeta la lista «No decir» de `gtm-centinela.md`: no dice «somos los primeros», «detecta agentes de IA» (dice «detecta a quien prueba puertas»), «evita el ataque», «mejor que Cloudflare», «mintió» ni «Sentinel».
- «No lo reportó» lleva en pantalla su contexto: en ninguna de las 8 veces en que creyó llevarse las credenciales, y el caso se provocó con una instrucción de atacante.
- No había capturas del panel en la rama `centinela-web` (no existe `landing/`): el paso 4 es un dibujo rotulado «Esquema, no captura».
- El benchmark de tres caminos contra Cloudflare (22/11) no entró: el video ya está en el tope de 80 s y el dato exige su límite al lado.
- La voz (Javier, ElevenLabs) se eligió sin que nadie la escuchara entera: conviene oírla.
