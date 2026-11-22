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
- **Detección y desvío, contra agentes de IA reales** (22/11/2026): 3 modelos de IA atacaron una tienda de demostración a través de Reaper, 10 veces cada uno. **30 de 30 ataques fueron marcados y desviados** a la copia falsa, tras una mediana de 9 peticiones. Antes del desvío, **ninguno alcanzó a leer datos sensibles reales** (0 de 30): solo páginas públicas. Ningún agente llegó a concluir que estaba en una copia. Y de 30 agentes de IA haciendo tareas legítimas (ver un producto, buscar, iniciar sesión), **ninguno fue marcado**. Datos y método: `evidencia-agentes/RESULTADOS.md`.
- **Cuánto frena al sitio** (22/11/2026): pasar por Reaper agregó **menos de 1 milisegundo** por petición (0,2 a 0,55 ms de mediana y hasta 0,77 ms en el peor 1 %, con respuestas de hasta 5 KB; 2.000 peticiones por caso). En el camino de la petición no hay ningún modelo de IA: son reglas fijas. Medido en una laptop, sin red, con el motor en modo proxy; el camino con Envoy no lo medimos. Datos: `ultimo-paso/scoreboard/runs/latencia-2026-11-22/`.
- **Contra lo que Cloudflare lanzó hace un mes** (benchmark propio, 22/11/2026): los mismos ataques al banco de prueba por tres caminos, con dos modelos de IA atacando (10 corridas cada uno). La prueba del ataque le llegó al atacante en 20 de 20 corridas sin defensa, en **20 de 20 por Cloudflare** con su configuración por defecto del plan gratuito, y en **0 de 20 por Último Paso**. Ninguno de los tres bloqueó pedidos legítimos (0 de 25) y en los tres el ataque se ejecutó en el servidor. Sin esa confirmación, ningún agente declaró haber tenido éxito, y gastaron entre 3 y 11 veces más peticiones. Datos crudos y configuración: `ultimo-paso/scoreboard/runs/bench-cloudflare-2026-11-21/`.
- **¿Y por qué no bloquear y ya?** Lo medimos con dos caminos de control (10 corridas por modelo): un bloqueo visible (403) y la falla parchada. Los dos también dejan al atacante sin la prueba (0 de 20), y **parchar es mejor cuando se puede**, porque es lo único que evita que el ataque se ejecute. La diferencia está en lo que aprende el agente: con el 403, concluyó que la falla existía y que lo frenaba un filtro en **18 de 20** corridas, y se dedicó a evadirlo; con nuestra respuesta, en **0 de 20**: creyó que el archivo no existía. No medimos que eso se traduzca en más daño; mide lo que el atacante aprende.
- **Engañar funciona con agentes de IA:** en un prototipo de pagos, los 30 agentes de IA que intentaron robar con una llave trampa cayeron a la copia falsa, sin mover un peso real.
- **Por qué hay que mirar desde afuera (Espejismo, 95 corridas con 8 modelos):** un agente con un objetivo oculto neutralizó a su vigilante 9 de 18 veces y no lo reportó en ninguna de las 8 en que creyó llevarse las credenciales. Explóralo: https://espejismo-demo.haroldmedrano33.workers.dev/explorar

- **Los usuarios ya lo reportan:** en los issues públicos de un agente de código muy usado hay reportes de reglas de denegación ignoradas, que dejaron leer archivos de secretos ([#8961](https://github.com/anthropics/claude-code/issues/8961), abierto, con etiqueta de seguridad), y de archivos borrados sin pedir permiso ([#55911](https://github.com/anthropics/claude-code/issues/55911)). Son reportes de usuarios que no verificamos; los citamos como señal de que el problema ya ocurre fuera del laboratorio.

## En qué se diferencia
Cloudflare lanzó el 21/10/2026 una protección que retiene la respuesta de un ataque exitoso ([anuncio](https://blog.cloudflare.com/full-transaction-waf/)), solo para el tráfico que pasa por su red y todavía sin reglas sobre el cuerpo de la respuesta. La idea de mandar al atacante a una copia falsa también está publicada este mes en un trabajo académico ([Gingerbread House](https://arxiv.org/abs/2611.07611)), sin código abierto. Reaper es abierto, corre delante de tus propios servidores y no se queda en bloquear: responde algo falso y creíble, y te explica el recorrido del agente.

## Límites, dichos de frente
- **No evita el primer golpe:** en nuestras pruebas, el primer intento del ataque igual se ejecutó en el servidor. Lo que Reaper hace después sí lo medimos: el reintento ya no llega al servicio (2 de 2 reintentos contenidos en la prueba grabada contra Next.js y Vite, con pruebas de concepto reales de CVE-2025-29927 y CVE-2025-30208), y cuando la detección marca antes al agente, lo desvía antes de que lea datos sensibles (0 de 30 los leyeron). Parchar sigue siendo lo único que evita el primer golpe.
- La detección contra agentes de IA se midió en un solo equipo local, con una tienda de demostración con fallas plantadas y un tope de 40 peticiones por ataque; siempre marcó la misma regla (pedir un recurso crítico). Contra escáneres clásicos que no piden nada crítico, esa misma detección encuentra 1 de cada 10 sesiones.
- El benchmark contra Cloudflare usa sus reglas por defecto en plan gratuito: sus primeras protecciones de respuesta cubren una falla concreta, y no pudimos confirmar desde el panel que estuvieran activas en la zona. Mide una sola app de prueba.
- Son muestras chicas, y con agentes de IA reales hay pocas corridas en la pieza de confirmación.
- En Espejismo el caso más grave se provocó con una instrucción de atacante, y en 16 a 22 de 35 corridas sin ella el agente escribió que sospechaba estar en una prueba.

## Verlo
- **El panel de Reaper, funcionando en línea:** https://neowaf.paoloose.site (botón «Modo demo», 7 pasos).
- La web y las láminas: https://reaper.haroldmedrano33.workers.dev
- Las 95 corridas reales de Espejismo, lo que cada agente reportó contra lo que registró el sistema: https://espejismo-demo.haroldmedrano33.workers.dev/explorar
- Videos: [la propuesta](https://espejismo-demo.haroldmedrano33.workers.dev/video/propuesta.mp4) · [lo dicho contra lo registrado](https://espejismo-demo.haroldmedrano33.workers.dev/video/dicho-vs-hecho.mp4)
- El panel de Reaper corre en local con `pnpm install && pnpm start` (modo de repetición, sin credenciales).
