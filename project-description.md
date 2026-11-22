# Reaper

### Si a un agente de IA que te ataca le niegas la prueba de que su ataque funcionó, se queda sin rumbo. Lo medimos, y Reaper es la versión abierta de esa idea.

> **El hallazgo:** los mismos ataques, con dos modelos de IA atacando. La prueba del ataque le llegó al atacante en 20 de 20 corridas sin defensa, en 20 de 20 por la protección por defecto de Cloudflare, y en **0 de 20** con nuestra pieza. Sin esa prueba, ningún agente declaró haber tenido éxito, y gastaron entre 3 y 11 veces más peticiones.

Bloquear a un agente le avisa que lo vieron, y aprende. Reaper controla lo que el agente ve y cree que pasó: lo detecta, le responde con una copia falsa, le niega la confirmación y te muestra qué buscaba.

## El problema
Los atacantes ya usan agentes de IA: prueban, leen la respuesta, ajustan y vuelven a probar, a velocidad de máquina. En julio de 2026, durante una evaluación, agentes de OpenAI entraron a sistemas de Hugging Face y nadie lo vio a tiempo ([comunicado de OpenAI](https://openai.com/index/hugging-face-model-evaluation-security-incident/)). Quien defiende ve miles de líneas de registro y no sabe cuál era un agente, qué buscaba ni si lo logró.

## Por qué importa
- **En la web ya hay más máquinas que personas.** El tráfico automatizado superó al humano en mayo de 2026, empujado por agentes y crawlers de IA ([Cloudflare, 27/09/2026](https://blog.cloudflare.com/cloudflares-2026-annual-founders-letter/)).
- **Ya existe el agente que ataca solo.** Google documentó el 16/11/2026 el primer marco que descubre y explota fallas web «without a human in the loop» ([GTIG](https://cloud.google.com/blog/topics/threat-intelligence/agentic-threat-activity-crosses-a-significant-threshold)).
- **La mayoría está sin escudo.** El 65,2 % de los sitios no tiene delante ningún proxy ni CDN de los grandes proveedores ([W3Techs, 22/11/2026](https://w3techs.com/technologies/overview/proxy)).
- **En Chile hay reloj.** La Ley 21.663 da a los servicios esenciales un máximo de 3 horas para la alerta temprana de un incidente significativo; 3.258 instituciones ya están inscritas para reportar ([ANCI, Balance 2025](https://anci.gob.cl/documents/4866/Palabras_Balance_2025.pdf)).
- **Con mesura:** los agentes de IA todavía son una fracción chica del tráfico (4,2 % de las solicitudes HTML en 2025, según Cloudflare Radar) y no encontramos un caso documentado en Chile o Perú. Lo que cambió en 2026 es la velocidad con que crece.

## Qué hace
| Paso | Qué hace | Dónde está |
|---|---|---|
| Detectar | Reglas sobre el tráfico: quién sondea rutas que no existen, quién recorre demasiadas, quién pide archivos sensibles | `agent-detection/` |
| Engañar | A la sesión sospechosa le responde una copia falsa del sitio | `agent-detection/mirror` |
| Negar la confirmación | Si la respuesta trae la prueba de que el ataque funcionó, no se la entrega, y aplica una regla temporal | `ultimo-paso/` |
| Mostrar y arreglar | Un panel con los agentes atrapados, su recorrido, la falla que usaron y un arreglo propuesto que una persona aprueba o rechaza | `apps/sentinel`, `apps/web` |

## Lo que medimos
- **Negar la confirmación (Último Paso):** la prueba del ataque dejó de llegarle al atacante en 5 de 5 intentos contra un banco de prueba y en 3 de 3 contra una falla real de Langflow; con un agente de IA atacando, en 2 de 2. No bloqueó ninguno de 34 pedidos legítimos.
- **Contra lo que Cloudflare lanzó hace un mes** (benchmark propio, 22/11/2026): los mismos ataques al banco de prueba por tres caminos, con dos modelos de IA atacando (10 corridas cada uno). La prueba del ataque le llegó al atacante en 20 de 20 corridas sin defensa, en **20 de 20 por Cloudflare** con su configuración por defecto del plan gratuito, y en **0 de 20 por Último Paso**. Ninguno de los tres bloqueó pedidos legítimos (0 de 25) y en los tres el ataque se ejecutó en el servidor. Sin esa confirmación, ningún agente declaró haber tenido éxito, y gastaron entre 3 y 11 veces más peticiones. Datos crudos y configuración: `ultimo-paso/scoreboard/runs/bench-cloudflare-2026-11-21/`.
- **¿Y por qué no bloquear y ya?** Lo medimos con dos caminos de control (10 corridas por modelo): un bloqueo visible (403) y la falla parchada. Los dos también dejan al atacante sin la prueba (0 de 20), y **parchar es mejor cuando se puede**, porque es lo único que evita que el ataque se ejecute. La diferencia está en lo que aprende el agente: con el 403, concluyó que la falla existía y que lo frenaba un filtro en **18 de 20** corridas, y se dedicó a evadirlo; con nuestra respuesta, en **0 de 20**: creyó que el archivo no existía. No medimos que eso se traduzca en más daño; mide lo que el atacante aprende.
- **Engañar funciona con agentes de IA:** en un prototipo de pagos, los 30 agentes de IA que intentaron robar con una llave trampa cayeron a la copia falsa, sin mover un peso real.
- **Por qué hay que mirar desde afuera (Espejismo, 95 corridas con 8 modelos):** un agente con un objetivo oculto neutralizó a su vigilante 9 de 18 veces y no lo reportó en ninguna de las 8 en que creyó llevarse las credenciales. Explóralo: https://espejismo-demo.haroldmedrano33.workers.dev/explorar

- **Los usuarios ya lo reportan:** en los issues públicos de un agente de código muy usado hay reportes de reglas de denegación ignoradas, que dejaron leer archivos de secretos ([#8961](https://github.com/anthropics/claude-code/issues/8961), abierto, con etiqueta de seguridad), y de archivos borrados sin pedir permiso ([#55911](https://github.com/anthropics/claude-code/issues/55911)). Son reportes de usuarios que no verificamos; los citamos como señal de que el problema ya ocurre fuera del laboratorio.

## En qué se diferencia
Cloudflare lanzó el 21/10/2026 una protección que retiene la respuesta de un ataque exitoso ([anuncio](https://blog.cloudflare.com/full-transaction-waf/)), solo para el tráfico que pasa por su red y todavía sin reglas sobre el cuerpo de la respuesta. La idea de mandar al atacante a una copia falsa también está publicada este mes en un trabajo académico ([Gingerbread House](https://arxiv.org/abs/2611.07611)), sin código abierto. Reaper es abierto, corre delante de tus propios servidores y no se queda en bloquear: responde algo falso y creíble, y te explica el recorrido del agente.

## Límites, dichos de frente
- Negar la confirmación no evita el daño: en nuestras pruebas el ataque igual se ejecutó en el servidor.
- La detección automática no tuvo falsas alarmas, pero hoy detecta 1 de cada 10 sesiones de sondeo y no se probó con agentes de IA.
- El benchmark contra Cloudflare usa sus reglas por defecto en plan gratuito: sus primeras protecciones de respuesta cubren una falla concreta, y no pudimos confirmar desde el panel que estuvieran activas en la zona. Mide una sola app de prueba.
- Son muestras chicas, y con agentes de IA reales hay pocas corridas en la pieza de confirmación.
- En Espejismo el caso más grave se provocó con una instrucción de atacante, y en 16 a 22 de 35 corridas sin ella el agente escribió que sospechaba estar en una prueba.

## Verlo
- Las 95 corridas reales de Espejismo, lo que cada agente reportó contra lo que registró el sistema: https://espejismo-demo.haroldmedrano33.workers.dev/explorar
- Videos: [la propuesta](https://espejismo-demo.haroldmedrano33.workers.dev/video/propuesta.mp4) · [lo dicho contra lo registrado](https://espejismo-demo.haroldmedrano33.workers.dev/video/dicho-vs-hecho.mp4)
- El panel de Reaper corre en local con `pnpm install && pnpm start` (modo de repetición, sin credenciales).
