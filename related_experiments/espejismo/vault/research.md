# Research — impacto de la idea y alternativas (21/11/2026)

> Hecho por tres subagentes en paralelo: incidentes y evidencia multilingüe (Opus), banca LatAm y regulación (Opus), alternativas, crítica y recomendación (Fable). Cada dato lleva URL abierta en la sesión; lo que no se pudo abrir está marcado **[NO VERIFICADO]**. Antes de citar una cifra en el pitch, conviene abrir el PDF: varios abstracts se leyeron con un extractor.

## TL;DR — recomendación

**Seguir, cambiando la tesis.** El esqueleto ya está, el hacking cierra el **dom 22/11 08:30** ([cronograma oficial](https://hack.platan.us/26-cl)) y ninguna alternativa le gana a esta idea bien contada.

- **Tesis nueva:** dejar «¿hay brecha entre español e inglés?», que puede salir nula. Pasar a «En Perú ya se mueve plata por chat con órdenes coloquiales. ¿La defensa que se compra funciona en el idioma del cliente?». El idioma pasa a ser una ablación, no la apuesta entera.
- **Riesgo 1: puede no haber «antes».** Un preprint midió ASR 0 % en `banking` contra modelos frontier sin defensa ([arXiv 2607.05518](https://arxiv.org/html/2607.05518), un autor, n=20). Hoy mismo hay que correr el baseline con **dos niveles de modelo**: el frontier y el barato que un banco desplegaría a escala.
- **Riesgo 2: la traducción puede debilitar el ataque.** En hindi el ASR bajó de 15/150 a 1/149 ([bhasha-shield](https://github.com/Sameerkc3579/bhasha-shield)). Hay que comparar los mismos pares en inglés y en español, con McNemar, y medir también la utilidad.
- **Resultado asegurado:** el clasificador evaluado aparte del agente, en inglés y en español peruano, sobre cientos de textos que incluyan benignos («pásale 50 lucas a mi causa al toque»). Es barato, con n grande, y cualquier resultado es un hallazgo.
- **El hueco que ocupamos:** no existe ningún benchmark de inyección indirecta en agentes con tools en español, menos en un dialecto. BabelDojo propone AgentDojo multilingüe, pero dice «the experiments have not been run yet». Lo honesto es presentarnos como los primeros en correrlo, y en un dialecto, no como los primeros en pensarlo.

### Cómo contarlo ante el jurado

- **Gancho:** «Para atacar a este agente no hay que hackear el banco: basta con transferirle un sol a la víctima con un mensaje».
  - Falta verificar que en AgentDojo la inyección viaja en el asunto de la transacción; se revisa en el esqueleto.
  - No afirmar que Yape o Plin tienen campo de mensaje sin comprobarlo en la app.
- **Ancla real:**
  - [Plin WhatsApp de Interbank](https://gestion.pe/economia/plin-whastapp-la-apuesta-de-interbank-para-pagar-sin-salir-del-chat-noticia/): «Pásale a Carlos S/20 para el almuerzo».
  - [Mibanco con IA agéntica en WhatsApp](https://pressperu.com/2026/07/23/mibanco-lleva-la-ia-agentica-de-aws-a-whatsapp-para-transformar-el-acceso-a-las-microfinanzas-en-peru/).
  - [BCP: «ejecutar, no solamente preguntar»](https://rpp.pe/economia/economia/banca-en-peru-alista-nueva-forma-de-realizar-transacciones-con-aplicativo-movil-via-conversacion-con-asistente-ia-noticia-1712828).
  - Yape: [15,5 M de usuarios activos al mes](https://www.peru-retail.com/credicorp-destaca-crecimiento-de-yape-tras-llegar-a-mas-de15-millones-de-usuarios-activos-mensuales/).
  - [SBS 2286-2024](https://img.lpderecho.pe/wp-content/uploads/2024/06/Resolucion-SBS-02286-2024-LPDerecho.pdf): el banco paga las operaciones no reconocidas.
- **Frase de cierre, según lo que den los datos:**
  - Si hay brecha en el clasificador: «La defensa que depende de entender el idioma falla cuando cambia el idioma; la que revisa la acción, no».
  - Si no hay brecha: «El modelo caro se defiende solo; el barato, que es el que se despliega a escala, no».
- **Guion de 3 minutos:**
  1. 0:00–0:30 — gancho y los tres productos reales.
  2. 0:30–1:15 — ataque en vivo: «¿cuánto gasté este mes?» lleva a leer una transacción envenenada y a transferir.
  3. 1:15–2:00 — el mismo ataque con el proxy: la confirmación muestra el destino y el monto reales y se bloquea.
  4. 2:00–2:40 — tabla con ASR, utilidad y confirmaciones por tarea, con IC; y la barra del clasificador en inglés contra español peruano.
  5. 2:40–3:00 — frase de cierre y repo abierto con el dataset y el harness.
- **Preguntas que va a hacer el jurado:**
  - «Si todo pide confirmación, el ASR es 0 por construcción»: reportar cuántas confirmaciones por tarea pide el proxy.
  - «La defensa es la familia de CaMeL y Progent, y ya se vio en otras sedes de esta gira» ([CrafterWIKI Bogotá](https://crafterwiki.com/hackathons/platanus-hack-26-bogota/)): el aporte no es el proxy, es la medición en el idioma del cliente.
  - «¿Pusieron la inyección en español sobre tareas y entorno en inglés?»: hay que traducir también el entorno y las tareas, o la comparación queda contaminada.
- **Orden de trabajo:**
  1. Baseline en inglés con dos modelos.
  2. Clasificador evaluado aparte.
  3. Proxy.
  4. Traducción del entorno.
  5. Si todo da cero, la historia es el clasificador más el costo en utilidad.

---

## 1. El problema es real: incidentes de prompt injection en agentes con tools

- **EchoLeak, M365 Copilot (CVE-2025-32711).** Un correo con instrucciones ocultas, cero clics. **Evadió el clasificador XPIA de Microsoft**, un argumento directo contra confiar solo en un clasificador. Divulgado el 11/06/2025. https://arxiv.org/abs/2509.10540 (CVSS 9.3 [NO VERIFICADO])
- **Slack AI (20/08/2024).** Un canal público filtró secretos de canales privados mediante un enlace Markdown. https://promptarmor.substack.com/p/data-exfiltration-from-slack-ai-via
- **GitHub MCP (26/05/2025).** Un issue malicioso llevó a Claude Desktop a filtrar repos privados en un PR público. https://invariantlabs.ai/blog/mcp-github-vulnerability
- **Perplexity Comet (20/08/2025).** Un comentario oculto en Reddit terminó en robo de cuenta usando el OTP sacado de Gmail. Brave advierte que el agente opera con todos los privilegios del usuario «en banca». https://brave.com/blog/comet-prompt-injection/
- **Gemini, memoria persistente (10/02/2025).** Invocación diferida de tools mediante un documento. https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/
- **OpenAI Atlas (22/12/2025).** OpenAI admite que la inyección es «poco probable que se resuelva del todo» y lista «enviar dinero» entre los daños. https://openai.com/index/hardening-atlas-against-prompt-injection/
- **Grok + Bankrbot (04/05/2026), el caso más cercano a banca.** Un prompt en código Morse llevó a dos agentes a transferir unos USD 150–200k en tokens. https://oecd.ai/en/incidents/2026-05-04-4a73 · https://incidentdatabase.ai/cite/1556/
- **Copilot Studio y Salesforce Agentforce (15/04/2026).** Fuga de datos mediante formularios públicos; OECD lo registra como explotado. https://oecd.ai/en/incidents/2026-04-15-d934
- **ShadowLeak, ChatGPT Deep Research (sep-2025)** [NO VERIFICADO]: https://www.radware.com/blog/threat-intelligence/shadowleak/
- **OWASP LLM01:2025.** El escenario #9 son instrucciones en otros idiomas para evadir filtros. https://genaisecuritylab.com/llmrisk/llm01-prompt-injection/
- **UK AISI × Gray Swan (mar–abr 2025).** 1,8 M de intentos y 22 modelos. ASR de la inyección **indirecta 27,1 % contra 5,7 % de la directa**; todos los modelos cayeron en todos los comportamientos al menos una vez. https://arxiv.org/abs/2507.20526
  - Segunda ronda (mar-2026), solo indirecta: ASR entre 0,5 % (Claude Opus 4.5) y 8,5 % (Gemini 2.5 Pro). https://arxiv.org/abs/2603.15714
- **Anthropic (24/11/2025).** Agente de navegador frente a un atacante adaptativo: 8,0 % sin salvaguardas y 1,4 % con ellas. Lo describe como «lejos de ser un problema resuelto». https://www.anthropic.com/research/prompt-injection-defenses
- **Google DeepMind, «Lessons from Defending Gemini against IPI».** https://arxiv.org/abs/2505.14534

No se encontró **ningún caso público de prompt injection contra un agente bancario en LatAm**: el riesgo se muestra con la demo.

## 2. Las defensas fallan más fuera del inglés

- **Deng et al. (ICLR 2024).** Los idiomas de pocos recursos generan unas 3 veces más contenido dañino; en el escenario intencional, 80,92 % en ChatGPT y 40,71 % en GPT-4. https://arxiv.org/abs/2310.06474
- **Yong et al.** AdvBench traducido a idiomas de pocos recursos rompe GPT-4 el 79 % de las veces; en idiomas de muchos recursos, bastante menos. https://arxiv.org/abs/2310.02446
- **Atil et al. (nov-2025), 10 idiomas, incluido el español.** La alineación no se transfiere de forma uniforme. En español con el ataque Logic: GPT-4o 44 %, Sonnet 4 19 % y Llama-3.1-8B 69 % de respuestas inseguras. https://arxiv.org/html/2511.00689
- **Uysal et al. (jun-2026).** Ningún modelo resiste más en otro idioma que en inglés. Sin español y con inyección directa. https://arxiv.org/html/2606.29602
- **Prompt Guard v1.** TPR de 97,5 % en inglés contra 91,5 % en multilingüe (traducido); 71,4 % en inyección indirecta. https://github.com/meta-llama/PurpleLlama/blob/main/Prompt-Guard/MODEL_CARD.md
  - Basta separar las letras con espacios para que el ASR pase de menos del 3 % a casi el 100 %. https://www.theregister.com/2024/07/29/meta_ai_safety/
- **Llama Prompt Guard 2.** Sin cifras por idioma; admite una brecha multilingüe en el modelo de 22M. En AgentDojo previene el 81,2 % (86M) con 3 % de pérdida de utilidad. https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Prompt-Guard-2/86M/MODEL_CARD.md
- **bhasha-shield, la evidencia más directa:** AgentDojo en hindi y bengalí; repo personal, sin revisión de pares. https://github.com/Sameerkc3579/bhasha-shield
  - Con el umbral ajustado en inglés, PromptGuard 2 **detecta 0 % en los otros idiomas**, aunque su AUC está entre 0,94 y 0,99.
  - ProtectAI da 47–65 % de falsos positivos fuera del inglés, contra 2 % en inglés.
  - La traducción debilita el ataque: 15/150 en inglés contra 1/149 traducido.
- **Lakera PINT.** Incluye español: 1.298 de sus 4.314 entradas no están en inglés. No desglosa por idioma y lo mantiene un proveedor de detectores. https://github.com/lakeraai/pint-benchmark
- **Guardrails multilingües.** Yang et al. concluyen que «siguen siendo inefectivos». https://arxiv.org/abs/2410.22153 (las cifras de Llama-Guard-3 están [NO VERIFICADO])
- **Lo más cercano al español:**
  - Piloto de Apart Research con español de Bogotá sobre Gemini: 62,5 % de los subobjetivos con algún bypass, sin grupo de control. https://apartresearch.com/sprints/projects/beyond-english-assessing-the-robustness-of-llm-safety-mechanisms-against-structural-jailbreaks-in-spanish-s4zk
  - MDPI 16(21):11039, inyección indirecta en RAG con español e inglés [NO VERIFICADO].
  - Dataset en Hugging Face `edithngalame/prompt-injection-en-es` [NO VERIFICADO].

## 3. Baseline citable: AgentDojo y afines

- **AgentDojo (NeurIPS D&B 2024).** Suite `banking`: **11 tools, 16 tareas de usuario y 9 tareas de inyección**, unos 144 pares (verificarlo en el esqueleto). https://arxiv.org/html/2406.13352v3
- **GPT-4o con el ataque `important_instructions`, sin defensa:** utilidad 69,0 % y ASR 47,7 % según la Tabla 3; la Tabla 5 dice 57,7 %, así que hay que citar la que corresponda a la configuración.
- **Defensas sobre GPT-4o:**

  | Defensa | Utilidad | ASR |
  |---|---|---|
  | Tool filter | 73,1 % | 6,8 % |
  | Delimitación de datos (estilo spotlighting) | 72,7 % | 41,7 % |
  | Detector de inyección (ProtectAI) | 41,5 % | 8,0 % |
  | Repetir el prompt | 85,5 % | 27,8 % |

  El detector es el baseline natural del clasificador: baja el ASR, pero **se lleva la mitad de la utilidad**.
- **Resultados oficiales**, ASR sin defensa: Claude 3.7 Sonnet 7,31 %, gpt-4o-mini 27,19 % y gemini-2.0-flash 20,83 %. https://agentdojo.spylab.ai/results/
- **CaMeL** resuelve el 77 % de las tareas con seguridad demostrable. https://arxiv.org/abs/2503.18813
- **Spotlighting.** https://arxiv.org/abs/2403.14720
- **MELON.** https://arxiv.org/abs/2502.05174
- **Meta-SecAlign.** https://arxiv.org/abs/2507.02735
- **BabelDojo**, AgentDojo multilingüe, sin experimentos corridos: es trabajo concurrente que hay que citar. Los subagentes dieron dos URLs y no está aclarado cuál es la canónica: https://github.com/faerber-lab/BabelDojo · https://github.com/himanshubeniwal/BabelDojo
- **Riesgo del baseline frontier en cero:** https://arxiv.org/html/2607.05518
- **AutoDojo**, atacante adaptativo: 13,2 % en `banking` contra setups defendidos [NO VERIFICADO].

## 4. Impacto regional: agentes que ya mueven dinero

- **Interbank, Plin WhatsApp (31/10/2025).** Transfiere con órdenes coloquiales por texto o voz («Plineale S/15 al Yape de Jimena»), con tope de S/100 por operación. https://gestion.pe/economia/plin-whastapp-la-apuesta-de-interbank-para-pagar-sin-salir-del-chat-noticia/
- **Mibanco.** Agente de AWS en WhatsApp que ejecuta transacciones: S/10,6 M desembolsados y 357k interacciones. https://pressperu.com/2026/07/23/mibanco-lleva-la-ia-agentica-de-aws-a-whatsapp-para-transformar-el-acceso-a-las-microfinanzas-en-peru/
- **BCP.** Asistente de voz Clara (1 de cada 4 llamadas). Anuncia transacciones por conversación. https://pqs.pe/actualidad/bcp-lanza-asistente-virtual-para-consultas-telefonicas-con-ia-generativa/ · https://rpp.pe/economia/economia/banca-en-peru-alista-nueva-forma-de-realizar-transacciones-con-aplicativo-movil-via-conversacion-con-asistente-ia-noticia-1712828
- **Nubank (Brasil).** Pix por voz, texto o imagen con IA generativa; 2 M de clientes en WhatsApp. https://nu.com/es/sala-de-prensa/clientes/nubank-aprovecha-la-ia-para-escalar-las-operaciones-con-pix
- **Mercado Pago (Argentina).** Asistente que transfiere y paga a partir de texto, voz, una captura de chat o la foto de una boleta, «con confirmación». https://www.eldestapeweb.com/tecnologia/inteligencia-artificial/mercado-pago-lanza-en-argentina-su-propio-asistente-de-ia-20251217162930
  - Ojo: leer una captura o una boleta abre una vía de inyección indirecta por imagen.
- **BBVA Perú, Blue:** 1 M de clientes atendidos. https://www.bbva.com/es/pe/innovacion/blue-el-asistente-virtual-de-bbva-atiende-mas-de-cuatro-millones-de-consultas-en-peru/
- **Bci:** primeros agentes de servicio al cliente previstos para 2025. https://www.df.cl/df-lab/tecnologia/centro-de-inteligencia-artificial-de-bci-busca-implementar-los-primeros
- **Yape:** 15,5 M de usuarios activos al mes, el 82 % de la población económicamente activa. https://www.peru-retail.com/credicorp-destaca-crecimiento-de-yape-tras-llegar-a-mas-de15-millones-de-usuarios-activos-mensuales/
- **NTT DATA (2025):** el 48 % de los bancos de LatAm prioriza la IA generativa. https://www.acis.org.co/blog/noticias-2/revolucion-en-el-sector-financiero-el-48-de-los-bancos-en-latinoamerica-apuesta-por-la-ia-generativa-para-ganar-ventaja-competitiva-revela-estudio-1531

### Fraude digital

- **Perú.**
  - Denuncias por fraude informático: 11.810 en 2021 y 29.455 en 2025. https://andina.pe/agencia/noticia-fraude-informatico-y-suplantacion-identidad-son-los-ciberdelitos-mas-denunciados-1092617.aspx
  - Asbanc proyecta S/257 M en amenazas entre jul-2025 y dic-2026. https://gestion.pe/tu-dinero/fraude-digital-amenaza-cuentas-de-ahorro-por-s-257-millones-por-donde-atacan-delincuentes-noticia/
- **Chile.**
  - CMF: más de 1,3 M de reclamos por fraude en 2023–2024. https://www.cmfchile.cl/portal/estadisticas/617/articles-100079_doc_pdf.pdf
  - ABIF: la tasa de fraude es unas 6,5 veces la de la UE. https://chocale.cl/2026/03/ley-de-fraudes-cifras-2025-reclamos-de-usuarios/
- **Arup:** USD 25,6 M perdidos por un CFO falso hecho con deepfake. https://fortune.com/europe/2024/05/17/arup-deepfake-fraud-scam-victim-hong-kong-25-million-cfo

## 5. Regulación

- **EU AI Act, art. 15.5.** Los sistemas de alto riesgo deben resistir a terceros que intenten alterar su uso o sus salidas, incluidos los «ejemplos adversarios».
  - El Anexo III 5.b es scoring crediticio; un agente que solo hace pagos no entra explícitamente.
  - El digital omnibus (Reg. 2026/1744) mueve las obligaciones del Anexo III al 2/12/2027.
  - Multas de hasta €15 M o el 3 % de la facturación.
  - https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:02024R1689-20260727
- **Chile, proyecto de ley de IA (boletín 16821-19).** Está en segundo trámite en el Senado, con cuatro niveles de riesgo. https://www.camara.cl/legislacion/proyectosdeley/tramitacion.aspx?prmID=17429&prmBOLETIN=16821-19 (lo de la comisión del 10/11/2026 está [NO VERIFICADO])
- **Chile, Ley 21.719 de datos personales.** https://www.bcn.cl/leychile/navegar?idNorma=1209272
  - Vigencia legal desde el 1/12/2026; crea la Agencia de Protección de Datos Personales.
  - Art. 8 bis: decisiones automatizadas. Arts. 14 quinquies y sexies: seguridad y reporte de brechas.
  - **Postergación al 15/10/2027:** el Senado la aprobó el 28/10 ([Senado](https://www.senado.cl/comunicaciones/noticias/segundo-tramite-proyecto-que-posterga-entrada-en-vigencia-de-ley-de)). Otra fuente dice que el Congreso la despachó el 17/11 y queda pendiente de publicación ([Varela](https://www.varelaabogados.cl/post/ley-proteccion-datos-personales-chile-21719)). En el pitch no conviene afirmar una fecha.
  - Multas de hasta 20.000 UTM [NO VERIFICADO en el texto oficial].
- **Chile, Ley 21.663 Marco de Ciberseguridad.** Banca y medios de pago son servicios esenciales; reporte al CSIRT en 3 h y en 72 h; multas de hasta 40.000 UTM. https://www.bcn.cl/leychile/navegar?idNorma=1202434
- **Perú, reglamento de la Ley 31814 (DS 115-2025-PCM).** Considera de alto riesgo los activos críticos de banca. El art. 31.4 exige supervisión humana capaz de «detener, corregir o invalidar» decisiones. El sector financiero tiene 1 año de adecuación, con vencimiento en sep-2026. https://busquedas.elperuano.pe/dispositivo/NL/2436426-1
- **SBS 2286-2024.** Desde el 1/07/2025 el banco responde por las operaciones no reconocidas, salvo culpa del usuario. https://img.lpderecho.pe/wp-content/uploads/2024/06/Resolucion-SBS-02286-2024-LPDerecho.pdf
  - Es el mejor argumento económico: **la pérdida por un agente engañado la paga el banco**.

## 6. Alternativas evaluadas (no ganan)

- **A1. Agentes de código en CI que filtran secretos por un issue.**
  - Evidencia: [PromptPwnd, Aikido (04/12/2025)](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents) y [Comment and Control, CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-github-actions-security-20260503-csa-st/).
  - Demo: un repo con secretos canario y unos 40 issues maliciosos, con y sin proxy.
  - Métrica: canarios filtrados sobre N, y porcentaje de triage correcto.
  - Por qué no gana: Aikido ya lo publicó y el problema solo aparece con configuraciones inseguras.
- **A2. Agente de atención que entrega datos de otro cliente (Ley 21.719).**
  - Evidencia: [8 de 17 plugins de chatbot, presentes en unos 8.000 sitios, no verifican el historial (IEEE S&P 2026)](https://arxiv.org/abs/2511.05797).
  - Demo: 200 clientes sintéticos con RUT y una batería de ataques; la defensa es autorización atada a la sesión.
  - Métrica: registros ajenos filtrados por cada 100 ataques.
  - Por qué no gana: es control de acceso clásico («eso no es IA») y el gancho legal se cae con la postergación.
- **A3. Supply chain de skills y MCP.**
  - Evidencia: [Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/), con 36,8 % de skills con fallas y 76 maliciosas.
  - Por qué no gana: el escáner ya existe gratis (agent-scan); sería competir con un producto.
- **Descartadas sin demo:**
  - Voz y deepfake: problema real en Chile esta semana ([BioBio 18/11](https://www.biobiochile.cl/noticias/ciencia-y-tecnologia/moviles-y-apps/2026/11/18/mama-soy-yo-advierten-por-peligrosa-estafa-de-whatsapp-que-puede-clonar-la-voz-de-tu-hijo.shtml)), pero no hay una métrica antes/después honesta en 24 h.
  - Agentes de navegador: infraestructura frágil para una demo en escenario.
