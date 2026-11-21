# Papers — revisión de literatura (21/11/2026)

> Cuatro subagentes (Opus) en paralelo, uno por tema; consolidación, juicio y diseño del experimento en Fable; una segunda pasada independiente (Fable) reabrió las cifras de las 5 afirmaciones del pitch (resultado en §6). Complementa a [[research]] y [[research-ganadores]]; el experimento aterriza el frente «clasificador EN vs es_pe» de [[pendientes]].

**Cómo leer las marcas.** ✔ = un subagente abrió la fuente en esta sesión y vio la cifra ahí (se indica tabla o sección). ◐ = solo se leyó el abstract, o la cifra es autorreportada por una ficha de modelo o un repo sin revisión de pares. **[NO VERIFICADO]** = memoria o snippet de buscador; no citar sin abrir. Yo no reabrí personalmente cada fuente: lo que sube a una lámina se confirma en el PDF.

## TL;DR

1. **El 0/288 es lo que la literatura predice, y eso lo vuelve citable en vez de decepcionante.** DeepMind y Anthropic ya escriben que los benchmarks estáticos (AgentDojo incluido) están saturados por los modelos frontier desde fines de 2025. GPT-5 da 0,2 % en AgentDojo; Claude Haiku 4.5, 0,3 %.
2. **El 0/12 adaptativo mide a nuestro atacante, no a los modelos.** Un atacante en enjambre de DeepMind rompe DeepSeek v4.1 Flash (uno de nuestros seis) en 99 % de los escenarios con 320 consultas. Hay que decirlo así: «cota de nuestro atacante», nunca «el modelo es robusto».
3. **El hueco es real y más preciso de lo que creíamos:** nadie evaluó detectores de inyección (Prompt Guard 2, ProtectAI, PIGuard) sobre español escrito de forma nativa con más de 32 ejemplos, ni midió sus falsos positivos con textos benignos coloquiales en español. Español peruano: cero trabajos en seguridad de LLM.
4. **La tesis que la evidencia sostiene no es «el peruano rompe la seguridad»** (tres trabajos dan resultado nulo o «el dialecto no es necesario ni suficiente»). Es: **«el umbral calibrado en inglés no se transfiere, y el costo lo paga el cliente legítimo»**. En turco, hindi y bengalí ya se vio el patrón (AUC alta, detección casi nula al umbral por defecto; ProtectAI con 47–65 % de falsos positivos).
5. **Experimento mínimo:** 150 tripletas de ataque + 150 benignas (inglés / español neutro / español peruano), 4 clasificadores en la laptop, McNemar pareado, una hipótesis primaria registrada antes de correr. Costo de API: menos de 1 M de tokens; el cuello es la revisión nativa de 300 textos (~2 h de una persona).

### Correcciones a notas anteriores del vault

- **GPT-4o en AgentDojo sin defensa: citar ASR 47,69 %** (Tabla 3 y página oficial). El 57,7 % sale de las Tablas 4–5 del mismo paper, que dicen describir la misma configuración: es una inconsistencia interna del paper. La tabla de defensas (Tabla 5) se cita completa con su propia fila base.
- **«Prompt Guard 2 previene 81,2 % con 3 % de pérdida de utilidad» está mal leído.** La métrica es *APR @ 3 % utility reduction*: el umbral se elige para perder 3 % y se mide cuánto previene ahí. No es una pérdida medida de forma independiente.
- **arXiv 2607.05518 no es un estudio de ASR:** es aiAuthZ, reporte técnico de un autor. El dato de `banking` son 20 pares y 2 modelos (Fable 5 y Gemini 3 Flash), ambos 0 % sin defensa. Sirve como corroboración anecdótica.
- **BabelDojo:** los dos repos son el mismo sitio de proyecto sin experimentos, sin paper y sin resultados. Citar `faerber-lab/BabelDojo` (organización, más commits).
- **«0/288 → ASR < 1,3 %» no se puede decir:** las 288 corridas no son independientes (6 modelos, mismas tareas). Reportar por celda (0/24, IC95 0–13,8 %) y por modelo (0/48, 0–7,4 %).
- **Usamos AgentDojo v1.2.1 y ya existe v1.2.2:** decirlo en el README.
- **Nombre del modelo:** la card de Opus 5 dice «GPT 5.6 Luna» y la de Haiku 5.5 «GPT-6 Luna». Confirmar cuál es el id que corrimos antes de comparar con cifras ajenas.
- **Nuestra condición `es_pe` es híbrida:** la plantilla está en español peruano, pero `{goal}`, las tareas y el entorno siguen en inglés (`run.py`, `ES_PE_TEMPLATE`). bhasha-shield midió que justo esa mezcla cambia el resultado (15/150 con plantilla inglesa y objetivo en hindi, 1/149 con todo en hindi). Va en limitaciones.

---

## 1. Bibliografía anotada

### 1.1 Inyección indirecta en agentes con tools: benchmarks y métricas

| # | Cita | Hallazgo | Cifra clave | Marca |
|---|---|---|---|---|
| A1 | Greshake et al. (2023). *Not what you've signed up for.* [arXiv 2302.12173](https://arxiv.org/abs/2302.12173) | Define la inyección indirecta y su taxonomía; demostraciones en Bing Chat. | Sin benchmark | ◐ abs |
| A2 | Debenedetti et al. (2024). *AgentDojo.* NeurIPS D&B. [arXiv 2406.13352](https://arxiv.org/html/2406.13352) | 97 tareas de usuario, 27 de inyección, 629 casos. `banking`: 11 tools, 16 × 9 = 144 casos. Define utilidad, utilidad bajo ataque y ASR dirigido (§3.4). | GPT-4o: utilidad 69,0 %, ASR 47,69 % (T3). Detector ProtectAI: 41,5 % / 8,0 % (T5) | ✔ T1–T5 |
| A3 | AgentDojo, [página de resultados](https://agentdojo.spylab.ai/results/) | Dejó de actualizarse en feb-2025; no hay modelos de 2025-H2 ni 2026. | Claude 3.7 Sonnet: 7,31 %; 3.5 Sonnet (oct-24): 1,11 % | ✔ |
| A4 | Zhan et al. (2024). *InjecAgent.* Findings ACL. [arXiv 2403.02691](https://arxiv.org/html/2403.02691) | 1.054 casos; introduce ASR-valid (sobre salidas válidas) vs ASR-all. | GPT-4 ReAct: 23,6 % base, 47,0 % reforzado (T3) | ✔ |
| A5 | Yi et al. (2023/25). *BIPIA.* KDD 2025. [arXiv 2312.14197](https://arxiv.org/abs/2312.14197) | Primer benchmark de inyección indirecta, sin tools (correo, web, tablas, código). | — | ◐ abs |
| A6 | Zhang et al. (2025). *Agent Security Bench.* ICLR. [arXiv 2410.02644](https://arxiv.org/abs/2410.02644) | 10 escenarios, 400+ tools, 27 ataques y defensas, 13 modelos. | ASR promedio máximo 84,30 % | ◐ abs |
| A7 | Evtimov et al. (2025). *WASP.* [arXiv 2504.18575](https://arxiv.org/html/2504.18575) | Separa «agente desviado» de «objetivo logrado»; acuña *security through incompetence*. | Claude 3.7: 0,536 intermedio, 0,036 de punta a punta (T2) | ✔ |
| A8 | Abdelnabi et al. (2025). *LLMail-Inject.* [arXiv 2506.09956](https://arxiv.org/abs/2506.09956) | 839 participantes, 208.095 ataques humanos contra un agente de correo con defensas de producción. | ASR: GPT-4o 58 %, GPT-5 mini 47 %, Meta-SecAlign 32 %. Recall del clasificador de texto 42–68 % (T3) | ✔ abs, T3, T8 |
| A9 | Zou et al. (2025). Gray Swan × UK AISI. [arXiv 2507.20526](https://arxiv.org/abs/2507.20526) | 1,8 M de ataques, 22 agentes: casi todos violan la política en 10–100 consultas. | 60.000+ éxitos | ◐ abs |
| A10 | Dziemian et al. (2026). Gray Swan, ronda indirecta. [arXiv 2603.15714](https://arxiv.org/html/2603.15714) | 13 modelos, 41 escenarios. Todos cayeron al menos una vez; tool use es el entorno más débil. | ASR por intento: 0,5 % (Opus 4.5) a 8,5 % (Gemini 2.5 Pro); tool use 4,82 % (T2) | ✔ |
| A11 | Nasr, Carlini et al. (2025). *The Attacker Moves Second.* [arXiv 2510.09023](https://arxiv.org/abs/2510.09023) | Rompe 12 defensas que reportaban ASR casi nulo con búsqueda, RL, gradiente y humanos. | **GPT-5 Mini sin defensa: 0 % estático → 75 % adaptativo** (T7). Detectores: ProtectAI 90 %, Prompt Guard 94 %, PIGuard 71 % | ✔ §5, T7 |
| A12 | Kurakin et al., Google DeepMind (nov-2026). *Scaling Adaptive Prompt Injection Attacks with Agent Swarms.* [arXiv 2611.11861](https://arxiv.org/html/2611.11861v1) | Los benchmarks estáticos están «saturated by frontier models since fall 2025». Métrica ARR@k. | **DeepSeek-V4.1-Flash: 99 % de escenarios rotos con 320 consultas** (T1) | ✔ T1–T5 |
| A13 | Hofer, Debenedetti, Tramèr (2026). *Assessing Automated Prompt Injection Attacks in Agentic Environments.* [arXiv 2606.10525](https://arxiv.org/html/2606.10525v1) | GCG y TAP sobre AgentDojo; GCG de modelos chicos no transfiere a frontier. | GPT-5: ~4,5 % con TAP; `banking` ~50 % en Qwen3-4B | ✔ texto, sin tablas |
| A14 | Ma et al. (2026). *AutoDojo.* [arXiv 2606.15057](https://arxiv.org/html/2606.15057v3) | Atacante adaptativo de caja negra sobre AgentDojo (incluye `banking`); 10 defensas. «A low static ASR is cheaply earned». | Haiku 4.5: 0,3 → 1,8 %. PIGuard: 0 → 28 %. Detectores recortan la utilidad entre ¼ y ½ | ✔ T5, §4 |
| A15 | Li et al. (2026). *AgentDyn.* [arXiv 2602.03117](https://arxiv.org/html/2602.03117) | Sucesor más dinámico; los modelos nuevos «probablemente se entrenaron con las plantillas de ataque conocidas». | GPT-5-mini 0,4 %, Sonnet 4.5 0,9 % (T8) | ✔ |
| A16 | Chen et al., Meta (2025/26). *Meta-SecAlign.* [arXiv 2507.02735](https://arxiv.org/html/2507.02735) | Fine-tuning contra inyección; sus tablas sirven de referencia de modelos sin defensa. | AgentDojo: **GPT-5 0,2 %**, Gemini 3 Pro 3,8 %, GPT-4o 43,2 % (T8) | ✔ |
| A17 | Anthropic (2026). System cards de Opus 5, Opus 5.5, Sonnet 5.5 y Haiku 5.5, §5.2. [transparency](https://www.anthropic.com/transparency) | «Claude models have saturated most public benchmarks». Distinguen ASR por intento y por escenario, y reportan éxito a k intentos. Ninguna card mide inyección fuera del inglés. | Gray Swan, k=15: Sonnet 5.5 3,4 % (tool use 1,0 %); Haiku 5.5 7,1 %; «GPT 5.6 Luna» 43,9 % | ✔ PDF, §5.2 |
| A18 | Hofman et al. (2026). *MAPS.* Findings EACL. [arXiv 2505.15935](https://arxiv.org/html/2505.15935) | Lo más cercano a seguridad de agentes en español (latinoamericano): traduce ASB a 11 idiomas. Solo traduce instrucciones; no aclara si la inyección es indirecta. | GPT-5-mini: ASR 32,7 % en inglés vs 39,2 % en español (T16–19) | ✔ |
| A19 | Sameerkc3579 (2026). [bhasha-shield](https://github.com/Sameerkc3579/bhasha-shield). Repo, sin paper | Nuestro diseño, en hindi. Propone uASR: contar solo casos que el agente es capaz de ejecutar. | Prompt Guard 2: AUC 0,94–0,99 y 0 % detectado con umbral inglés; con umbral propio, 51 % a 2 % de FP. ProtectAI: 47 % de FP en hindi | ◐ README |
| A20 | cabetan (2026). [injection-es](https://github.com/cabetan/injection-es). Repo, sin paper | Agente de atención al cliente, español vs inglés, Haiku. 0 acciones inyectadas, pero repite la afirmación inyectada al cliente. | Avisó que no estaba verificada: 71 % (es) vs 86 % (en), McNemar p = 0,006 | ◐ README |
| A21 | Wang et al. (2025). *MCPTox.* [arXiv 2508.14925](https://arxiv.org/abs/2508.14925) | 45 servidores MCP reales, 1.348 casos. | ASR máximo 72,8 % | ◐ abs |
| A22 | Cao et al. (2025). *VPI-Bench.* [arXiv 2506.02456](https://arxiv.org/abs/2506.02456) · Kuntz et al. (2025). *OS-Harm.* [arXiv 2506.14866](https://arxiv.org/abs/2506.14866) | Inyección visual en agentes de computadora y navegador. | Hasta 51 % (computadora) y 100 % (navegador) | ◐ abs |
| A23 | Nguyen et al. (2026). *INFUSE.* [arXiv 2610.20776](https://arxiv.org/abs/2610.20776) | 19 modelos, 41.824 trayectorias; el juez LLM infla el ASR frente a la verificación por reglas. | 19,6 % vs 15,4 % | ◐ abs |
| A24 | Saban (2026). [arXiv 2606.05233](https://arxiv.org/abs/2606.05233) | Ataques hechos a mano de la literatura contra modelos actuales. | **0/140 en Sonnet 4.6 y GPT-5.4** (cota 95 %: 2,6 %) | ◐ abs |
| A25 | Kodathala (2026). *aiAuthZ.* [arXiv 2607.05518](https://arxiv.org/html/2607.05518) | Gateway de autorización; el dato de `banking` es marginal. | 0/20 sin defensa en Fable 5 y Gemini 3 Flash (T4) | ✔ §5.5 |
| A26 | [BabelDojo](https://github.com/faerber-lab/BabelDojo) | AgentDojo multilingüe planeado. «The experiments have not been run yet». | Sin resultados | ✔ README |

Sin abrir **[NO VERIFICADO]**: ToolEmu, AgentHarm, VWA-Adv, RedTeamCUA, MCPSecBench, MCP-SafetyBench, MIPIAD (2605.07269, inglés–bengalí), GAIA-v2-LILT (2604.24929, advierte que la traducción automática sin revisión nativa invalida comparaciones).

### 1.2 Robustez multilingüe, dialectos y clasificadores

| # | Cita | Hallazgo | Cifra clave | Marca |
|---|---|---|---|---|
| B1 | Meta (2025). Llama Prompt Guard 2, [ficha](https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Prompt-Guard-2/86M/MODEL_CARD.md) | Evalúa 8 idiomas (incluye español) pero publica solo una AUC multilingüe agregada, sin recall a un umbral ni desglose. El 22M no tiene preentrenamiento multilingüe. No fija umbral recomendado. | AUC inglés 0,998 / multilingüe 0,995 (86M); 0,995 / 0,942 (22M). Recall @1 % FPR solo en inglés: 97,5 %. **Prompt Guard 1: AUC 0,987 con recall 21,2 % @1 % FPR** | ✔ ficha |
| B2 | Meta (2024). Prompt Guard v1, [ficha](https://huggingface.co/meta-llama/Prompt-Guard-86M) | El set multilingüe es traducción automática. | TPR 97,5 % inglés vs 91,5 % multilingüe; indirecta 71,4 % | ✔ |
| B3 | ProtectAI. deberta-v3-base-prompt-injection-v2, ficha | Declara que no maneja textos fuera del inglés. Apache-2.0, archivado. | NotInject 56,6 % (B5) | ◐ vía B5–B7 |
| B4 | Horizon-Labs (2026). [prompt-injection-guard-base](https://huggingface.co/Horizon-Labs/prompt-injection-guard-base), ficha | La evaluación más completa de Prompt Guard 2 fuera del inglés; la publica un competidor. | Turco, umbral 0,5: **PG2-86M detecta 14 %** (AUC 0,772); ProtectAI 56 % con 18,9 % de falsas alarmas; PIGuard 15 % | ◐ autorreportado |
| B5 | Li, Liu, Xiao (2025). *InjecGuard / PIGuard.* ACL. [arXiv 2410.22770](https://arxiv.org/abs/2410.22770) | Sesgo de palabras gatillo: «ignore» ⇒ malicioso. NotInject: 339 benignos, sin español. | Precisión sobre benignos: Prompt Guard v1 0,88 %; ProtectAI v2 56,64 %; Lakera 87,61 % (T1) | ✔ |
| B6 | Deniz (2026). [BenignTwin](https://github.com/3nesdeniz/benigntwin). Repo | Cada ataque se puntúa junto a un «gemelo» benigno del mismo tema y redacción. Es el diseño a copiar. | ProtectAI v2: FPR 0,8 % en inglés vs **59,2 % en turco** | ◐ autorreportado |
| B7 | Ngalame (2026). [prompt-injection-en-es](https://huggingface.co/datasets/edithngalame/prompt-injection-en-es), dataset y modelo | 18.312 filas; el español es casi todo opus-mt. Solo 32 filas humanas. | ProtectAI en español humano: recall 77 % (n = 26); FPR 38 % en benignos difíciles | ◐ autorreportado |
| B8 | juanpza (2026). [PG2 guardrail-ft](https://huggingface.co/juanpza/Llama-Prompt-Guard-2-86M-guardrail-ft), ficha | Fine-tune para inyección en salidas de herramientas, inglés y español. | **PG2 original: recall 12 % en salidas de herramientas en español** | ◐ autorreportado |
| B9 | Outeda et al., UdelaR (sep-2026). *Decoding Guardrails.* [arXiv 2609.24801](https://arxiv.org/html/2609.24801v1) | Único ataque publicado a Prompt Guard 2 con un prompt en español (rioplatense). Un solo caso. | 7 sinónimos bajan P(inyección) de 0,9994 a 0,2224 (§4.5) | ✔ n = 1 |
| B10 | Hackett et al. (2025). *Bypassing LLM Guardrails.* [arXiv 2504.11168](https://arxiv.org/abs/2504.11168) | Evasión por caracteres contra 6 guardrails. No prueba traducción. Las tildes cambian la tokenización. | Evasión: Prompt Guard v1 70,44 %; ProtectAI v2 20,26 %; emoji smuggling 100 % | ✔ |
| B11 | Liu (oct-2026). *Passing the Test You Trained On.* [arXiv 2610.03448](https://arxiv.org/abs/2610.03448) | 15 detectores sobre salidas de herramientas reales; el ranking no se transfiere entre benchmarks. Solo inglés. | El mejor en BIPIA detecta 2 % de AgentDojo a 1 % de FPR; FPR en salidas de herramientas de 0 a 90 % | ◐ abs |
| B12 | Jia et al. (2025). *A Critical Evaluation of Defenses against Prompt Injection.* [arXiv 2505.18333](https://arxiv.org/abs/2505.18333) | Pide evaluar detectores con FPR y FNR, no solo AUC. | Prompt Guard v1: **AUC 0,92 con FPR 0,89** (T3a) | ✔ |
| B13 | Gonzalez-Sancho et al. (nov-2026). Applied Sciences 16(21):11039. [doi](https://doi.org/10.3390/app162111039) | RAG local, diseño 2×2 de idioma (español/inglés). El filtro calibrado en español no elimina frases de anulación en inglés. | ASR tras filtro: 14,3–40,7 % según idioma | ◐ abs (MDPI 403) |
| B14 | Fuziwara Filho et al., USP (2026). SBSeg. [PDF](https://repositorio.usp.br/bitstreams/84eba1ea-522a-439f-a649-d9d3c075fcb5) | DefensiveTokens entrenados en portugués, ataques traducidos con NLLB. | Español sin defensa: 4,5–61,1 % según modelo (T1) | ✔ |
| B15 | Aziz, Hanif, Koto (2026). [arXiv 2606.01196](https://arxiv.org/abs/2606.01196) | En idiomas de bajo recurso la representación separa bien, pero los puntajes se desplazan. | Recalibrar el umbral con **32 ejemplos por clase** lo repara; rechazo 87,9 → 43,9 % sin recalibrar | ◐ abs |
| B16 | Tasawong et al. (2025). *SEA-SafeguardBench.* [arXiv 2512.05501](https://arxiv.org/abs/2512.05501) | El umbral fijo de 0,5 subestima a ShieldGemma y Llama Guard 3; su óptimo es ~0,1. | Cifras en figura no leída | ✔ §5.2 texto |
| B17 | Yang et al. (2024). *Benchmarking LLM Guardrails in Handling Multilingual Toxicity.* [arXiv 2410.22153](https://arxiv.org/abs/2410.22153) | Solo agregados inglés vs no inglés; el desglose por idioma está en figuras. | Llama Guard 3, jailbreaks: 82,90 inglés / 71,38 multilingüe (T4) | ✔ |
| B18 | Qwen Team (2025). *Qwen3Guard.* [arXiv 2510.14276](https://arxiv.org/html/2510.14276v1) | Apache-2.0, 0,6–8B, categoría «Jailbreak». Trae español desglosado. | RTP-LX F1 inglés/español: Qwen3Guard-0.6B 90,2 / 85,3; Llama Guard 4 37,6 / 29,5 (T5) | ✔ |
| B19 | Kumar et al. (2025). *PolyGuard.* COLM. [arXiv 2504.04377](https://arxiv.org/abs/2504.04377) · NVIDIA (2025). *CultureGuard.* [arXiv 2508.01710](https://arxiv.org/html/2508.01710v4) | Guards de contenido multilingües con español. No detectan inyección. | Español 1–8 puntos bajo inglés, salvo en Aya | ✔ |
| B20 | Atil et al. (2025). [arXiv 2511.00689](https://arxiv.org/html/2511.00689) | El español no siempre es más débil: depende del modelo. | Ataque Logic, español/inglés: GPT-4o 44 / 61; **Sonnet 4 19 / 6**; Llama-3.1-8B 69 / 74 (T2) | ✔ |
| B21 | Deng et al. (2024). ICLR. [arXiv 2310.06474](https://arxiv.org/abs/2310.06474) · Yong et al. (2023). [arXiv 2310.02446](https://arxiv.org/abs/2310.02446) | Fundacionales de jailbreak multilingüe: los idiomas de pocos recursos producen más contenido dañino. | ~3×; GPT-4 79 % | ya en [[research]], no reabiertos |
| B22 | Yoo et al. (2025). *CSRT.* ACL. [arXiv 2406.15481](https://arxiv.org/abs/2406.15481) | Mezclar idiomas en una consulta aumenta los ataques logrados. | +46,7 % sobre inglés | ◐ abs |
| B23 | Xu (2026). *What Drives Dialectal Jailbreaks?* EMNLP. [arXiv 2609.31664](https://arxiv.org/abs/2609.31664) | Shanghainés y cantonés: **la forma dialectal «no es necesaria ni suficiente»**. | Traducción ingenua al dialecto: < 8 % | ◐ abs |
| B24 | Islam et al. (2026). *BanglaSafe.* [arXiv 2608.22335](https://arxiv.org/abs/2608.22335) | El registro formal periodístico evade más que el casual. | +17 pp | ◐ abs |
| B25 | González Ruiz et al. (2026, Apart). *Regional Spanish Slang.* [PDF](https://pys8vc40ox3z7qxp.public.blob.vercel-storage.com/files/38b4e6bc47b89b86-M-Safety-Across-Intra-Language-Variations_-A-Study-of-Regional-Spanish-Slang.pdf) | 20 prompts × 6 variantes del español (sin peruano). **Resultado nulo.** | Riesgo 0,900–0,927 en todas | ✔ PDF |
| B26 | Team Balam (2026, Apart). [Slang Bypass](https://apartresearch.com/sprints/projects/slang-bypass-benchmarking-alignment-failures-in-mexican-regional-spanish-4m8z) | Jerga mexicana vs neutro, sin test de significancia ni juez validado. | 20 vs 6 de 300 | ◐ página |

Sin abrir **[NO VERIFICADO]**: Abbasi et al. (SSRN 5244151: 19 modelos, inglés vs español traducido; es el antecedente más cercano y devuelve 403), Ghanim et al. (árabe transliterado, 2406.18725), PINT de Lakera, fichas de Llama Guard 4 y Granite Guardian.

### 1.3 Defensas: qué prometen, qué cuestan, qué las rompe

| Defensa | Familia | Utilidad sin ataque (base) | ASR que reportan | Ataque adaptativo que la rompe | Fuente y marca |
|---|---|---|---|---|---|
| CaMeL | Sistema: flujo de control y de datos | 77 % (84 % el mismo modelo con tools nativas); 2,82× tokens de entrada | ≈ 0 por diseño | No por reformular el texto. Sí por canales laterales (§7), *branch steering* en agentes de computadora (89,5 % contra un Dual-LLM simple), composición multiagente y modelos chicos (programas fallan hasta en 68 %) | [2503.18813](https://arxiv.org/abs/2503.18813) ✔; [2601.09923](https://arxiv.org/abs/2601.09923), [2610.03089](https://arxiv.org/abs/2610.03089), [2610.05640](https://arxiv.org/abs/2610.05640), [2611.17115](https://arxiv.org/abs/2611.17115) ◐ abs |
| Progent | Sistema: mínimo privilegio | «mantiene utilidad» | 39,9 → 1,0 % (AgentDojo) | Adaptativo propio: sube poco. Políticas escritas por modelos chicos: atacables en 14 de 15 | [2504.11703](https://arxiv.org/abs/2504.11703) ✔ §1, §6.1 |
| DRIFT | Sistema: reglas dinámicas | +18,9 puntos sobre CaMeL | 30,7 → 1,4 % | AutoDojo: 2,6 → 6,4 % | [2506.12104](https://arxiv.org/abs/2506.12104) ✔ §1 |
| FIDES | Sistema: control de flujo de información | no extraída | no extraída | No evaluada adaptativamente (que hayamos encontrado) | [2505.23643](https://arxiv.org/abs/2505.23643) ◐ abs |
| Tool filter | Sistema liviano | 73,1 % (69,0 %) | 6,8 % | Excluida por A11: el control no depende de los datos | A2 ✔ T5 |
| Meta-SecAlign | Modelo: fine-tuning | 84,5 % (59,8 %) | 1,9 % | **96 %** con búsqueda; 32 % con humanos | [2507.02735](https://arxiv.org/abs/2507.02735), A11, A8 ✔ |
| Spotlighting | Prompt | — | < 2 % | > 95 % | [2403.14720](https://arxiv.org/abs/2403.14720) ◐ abs; A11 ✔ §5.1 |
| Repetir el prompt | Prompt | 85,5 % (69,0 %) | 27,8 % | > 95 % | A2 ✔; A11 ✔ |
| MELON | Ejecución enmascarada | 68,0 % (80,4 %) | 0,24 % | 76–95 % | [2502.05174](https://arxiv.org/abs/2502.05174) ✔ T1; A11 ✔ |
| PromptArmor | Detector con LLM | — | < 1 % | Resiste a un fuzzer de plantillas (0,34 %); no probado contra A11 | [2507.15219](https://arxiv.org/abs/2507.15219) ✔ T3 |
| **ProtectAI v2** | **Detector de texto** | **41,5 % (69,0 %)**; 38,1 % (80,4 %) en MELON T1 | 8,0 % | **90 %**; RL-Hammer: detecta 17 %, y 0 % con recompensa de sigilo | A2, A11, [2510.04885](https://arxiv.org/abs/2510.04885) ✔ T7 |
| **Prompt Guard 2 86M** | **Detector de texto** | umbral fijado a −3 % de utilidad (ficha) | APR 81,2 % | **94 %**; RL-Hammer: detecta 16 %, y 0 % con sigilo | B1, A11, 2510.04885 ✔ |
| PIGuard | Detector de texto | 39,2 % (74,2 %, Gemini) | 0 % | 71 %; AutoDojo 0 → 28 % | A11 ✔ T7; A14 ✔ |
| Model Armor / Prompt Shields | Detector comercial | 58,8 % (74,2 %) | — | Model Armor 90 %; Prompt Shield 72 % de evasión por caracteres | A11 ✔; B10 ✔ |

Otras fuentes de esta sección:

- **Zhan et al. (2025).** *Adaptive Attacks Break Defenses Against IPI.* [arXiv 2503.00061](https://arxiv.org/abs/2503.00061). Ocho defensas rotas con más de 50 % de ASR; el detector fine-tuned pasa de 61 % a 1–10 % de detección con un sufijo adversarial (T2). ✔
- **Wen et al., Meta (2025).** *RL-Hammer.* [arXiv 2510.04885](https://arxiv.org/abs/2510.04885). 98 % contra GPT-4o y 72 % contra GPT-5 con jerarquía de instrucciones. ✔ T7
- **Yin et al. (2026).** *PIForge.* [arXiv 2609.33628](https://arxiv.org/abs/2609.33628). RL con currículo: 93,8 % contra «GPT-5.6-Luna» donde RL-Hammer saca 0 %. ◐ abs
- **Rando et al. (2025).** [arXiv 2502.02260](https://arxiv.org/abs/2502.02260). Posición: los problemas adversariales con LLM son más difíciles de definir y de evaluar. ◐ abs
- **Beurer-Kellner et al. (2025).** *Design Patterns for Securing LLM Agents.* [arXiv 2506.08837](https://arxiv.org/abs/2506.08837). Seis patrones; los agentes de aplicación específica sí se pueden asegurar por diseño. ✔ índice
- **Meta (31/10/2025).** [Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/). Como máximo dos de: entradas no confiables, datos sensibles, acciones externas. «Prompt injection is a fundamental, unsolved weakness in all LLMs». ✔
- **Google DeepMind (2025).** *Lessons from Defending Gemini.* [arXiv 2505.14534](https://arxiv.org/abs/2505.14534). Ap. I: tradujeron ataques a español, alemán, francés y chino; en 74 % de los casos la traducción **baja** el ASR. ✔
- **OpenAI (22/12/2025)**, [Atlas](https://openai.com/index/hardening-atlas-against-prompt-injection/): «unlikely to ever be fully solved». **Anthropic (24/11/2025)**, [browser use](https://www.anthropic.com/research/prompt-injection-defenses): 1,4 % con salvaguardas que incluyen clasificadores sobre todo el contenido no confiable; «a 1 % attack success rate still represents meaningful risk». ✔

Sin cifras extraídas (solo existencia y título): IsolateGPT, f-secure, ACE, Conseca, AgentSpec, ShieldAgent, GuardAgent, MCP-Guard, Task Shield, AgentArmor, Attention Tracker, DataSentinel, TaskTracker, Instruction Hierarchy. **[NO VERIFICADO]**: Dual LLM de Willison, EchoLeak/XPIA, Carlini et al. 2019.

**Dónde quedan los clasificadores de texto.** Son la defensa «que se compra»: se agregan sin rediseñar el agente, y los labs los usan como una capa más. En el mapa son la familia más débil ante un atacante adaptativo (71–94 % de ASR) y la más cara en utilidad dentro de un agente (ProtectAI deja AgentDojo en 41,5 % contra 69,0 %). Medir sus falsos positivos en español coloquial es medir exactamente su eje débil: si bloquea al cliente legítimo, es inusable antes de que aparezca un atacante.

### 1.4 Metodología para muestras chicas

| # | Cita | Qué recomienda | Marca |
|---|---|---|---|
| D1 | Wilson (1927). JASA 22:209–212. [JSTOR](https://www.jstor.org/stable/2276774) | Intervalo de score: no colapsa con 0 éxitos. Con k = 0, límite superior = z²/(n + z²). | ◐ cita; fórmula comprobada en script |
| D2 | Brown, Cai, DasGupta (2001). Statistical Science 16(2). [doi](https://doi.org/10.1214/ss/1009213286) | Wald tiene cobertura errática; Wilson o Jeffreys para n ≤ 40. | ◐ vía buscador |
| D3 | Hanley, Lippman-Hand (1983). JAMA 249:1743. [PDF](https://jhanley.biostat.mcgill.ca/c607/ch08/zero_numerator.pdf) | «Regla de tres»: con 0 de n, límite superior unilateral ≈ 3/n. | ◐ cita; comprobada numéricamente |
| D4 | Newcombe (1998). Stat Med 17:2635–2650 | IC de la **diferencia pareada**: método 10, basado en Wilson. | ✔ abs (Europe PMC) |
| D5 | Fagerland, Lydersen, Laake (2013). BMC Med Res Methodol 13:91. [doi](https://doi.org/10.1186/1471-2288-13-91) | **McNemar mid-p** es mejor que el exacto condicional y que el asintótico con corrección. | ✔ abs |
| D6 | Dietterich (1998). Neural Computation 10(7) | Para comparar clasificadores con una sola corrida, McNemar es el test aceptable; el de dos proporciones no pareado «nunca debería usarse». | ✔ abs |
| D7 | Connor (1987). Biometrics 43:207 · Lachenbruch (1992). Stat Med 11:1521 | n de pares para McNemar: n = [z_α√ψ + z_β√(ψ − δ²)]² / δ². En nuestra simulación subestima 1–8 %. | ◐ cita |
| D8 | Miller, Anthropic (2024). *Adding Error Bars to Evals.* [arXiv 2411.00640](https://arxiv.org/abs/2411.00640) | Error estándar agrupado por clúster, diferencias pareadas por pregunta y análisis de potencia antes de correr. | ✔ HTML |
| D9 | Bowyer, Aitchison, Ivanova (2025). ICML. [arXiv 2503.01747](https://arxiv.org/abs/2503.01747) | No usar el teorema central del límite con menos de unos cientos de datos. | ◐ abs |
| D10 | Card et al. (2020). EMNLP. [ACL](https://aclanthology.org/2020.emnlp-main.745/) | Con poca potencia, lo significativo exagera el efecto; calcular potencia antes. | ◐ abs |
| D11 | Dror et al. (2018). ACL. [ACL](https://aclanthology.org/P18-1128/) · Koehn (2004). [ACL](https://aclanthology.org/W04-3250/) · Berg-Kirkpatrick et al. (2012). [ACL](https://aclanthology.org/D12-1091/) | Protocolo de tests en NLP; bootstrap pareado; la significancia no se transfiere si cambia el dominio. | ✔ (Koehn y B-K en PDF) |
| D12 | UK AISI, Inspect. [Scoring metrics](https://inspect.aisi.org.uk/metrics.html) | `ci_wilson()` para puntajes binarios y `stderr(cluster=…)`. Cita de «práctica de la industria». | ✔ |
| D13 | Arawjo (2026). [arXiv 2609.35815](https://arxiv.org/abs/2609.35815) | Con N < 100, cuidado con los IC por bootstrap. | ◐ abs |
| D14 | DeLong et al. (1988). Biometrics 44:837 · Hanley, McNeil (1983). Radiology 148:839 | IC y test para AUC correlacionadas sobre los mismos casos. | ◐ metadatos |
| D15 | Holm (1979). Scand J Stat 6:65 | Comparaciones múltiples: el k-ésimo p más chico contra α/(m − k + 1). | ◐ cita |

**[NO VERIFICADO]** (citas de memoria, clásicas): McNemar (1947), Clopper-Pearson (1934), Agresti-Coull (1998), Benjamini-Hochberg (1995). No encontramos una crítica publicada a la potencia estadística de AgentDojo con n chico.

---

## 2. Métricas: cuál reportar

- **ASR dirigido y utilidad** (AgentDojo §3.4): lo que ya reporta `run.py`. Siempre con n e IC de Wilson, por celda.
- **Adaptativo: ASR por par y por intento, con el presupuesto.** El estándar hoy es éxito a k intentos (Gray Swan k = 1/10/15; ARR@k de DeepMind). Nuestro presupuesto fue de hasta 6 intentos por par; el de DeepMind, 320.
- **Clasificadores: TPR y FPR al umbral fijado antes de mirar los datos**, por idioma; AUC como secundaria. Un desplazamiento de puntajes entre idiomas puede dejar intacta la AUC y hundir el TPR al umbral (B1, B4, B12, B15).
- **Capacidad por idioma** (uASR de bhasha-shield, «seguridad por incompetencia» de WASP): un ASR 0 en otro idioma no distingue robustez de incapacidad si no se mide la utilidad en ese idioma. Hoy solo tenemos utilidad con tareas en inglés.

## 3. Mapa de huecos (qué no está medido)

1. **Detectores de inyección sobre español nativo.** Lo que existe es traducción automática (B2, B7, B14), n diminuto (26 textos en B7, 1 prompt en B9) u otro idioma (turco, hindi, bengalí). Meta evaluó español en Prompt Guard 2 y no publicó la cifra.
2. **Falsos positivos con benignos coloquiales en español.** NotInject no tiene español; BenignTwin es inglés y turco; LLMail-Inject midió falsos positivos solo con correos de Enron. Órdenes como «pásale 50 lucas a mi causa al toque» u «olvídate de lo que te dije, mejor mándale a…» no están en ningún benchmark.
3. **Español peruano.** Cero trabajos en jailbreak, inyección o guardrails. Las variantes estudiadas son mexicana, rioplatense, chilena, peninsular y uruguaya, siempre contra LLM y nunca contra detectores.
4. **Calibración del umbral por idioma en detectores de inyección.** Se demostró en guards de contenido (B15, B16) y en hindi (A19); en español, nadie.
5. **Inyección indirecta en agentes con tools en español, con modelos de 2026.** MAPS usa modelos de 2025 y solo traduce instrucciones; BabelDojo no corrió; injection-es es un repo con un modelo. Mistral Large 4 y Qwen 3.8 Omni Flash no aparecen en ningún benchmark de inyección que hayamos abierto.
6. **Defensas de sistema con usuarios no angloparlantes.** CaMeL y Progent dependen de que el modelo escriba el programa o la política desde la consulta; nadie midió si eso se degrada en español.
7. **Incertidumbre.** Casi nadie reporta intervalos (AutoDojo lo admite) ni separa capacidad de robustez por idioma.

Los huecos 1–4 son los que ocupamos. El 5 ya lo tocamos con el 0/288 y sus limitaciones. Son afirmaciones de ausencia: se dicen como «no encontramos», con las búsquedas hechas (listadas por los subagentes: Prompt Guard 2 + Spanish, per-language false positive, dialect Spanish jailbreak, IberLEF 2026, Peruvian slang, entre otras).

---

## 4. Experimento mínimo defendible

**Pregunta.** El detector de inyección que un banco puede descargar hoy, con el umbral con el que viene, ¿detecta lo mismo y molesta lo mismo cuando el cliente escribe en español peruano que en inglés?

**Hipótesis primaria (se commitea antes de correr, α = 0,05).** Prompt Guard 2 86M, al umbral por defecto (0,5), detecta menos ataques en español peruano que en inglés sobre los mismos ataques. Test: McNemar mid-p pareado.

**Secundarias (Holm sobre el resto).** (a) El FPR de ProtectAI v2 sobre benignos coloquiales es mayor en español peruano que en inglés. (b) Español neutro vs peruano: ¿es el idioma o el registro? (c) Recalibrar el umbral con 32 ejemplos por clase recupera la detección (método de B15), evaluado sobre los textos restantes.

**Datos: 150 tripletas de ataque + 150 tripletas benignas = 900 textos.**

- Cada tripleta es el mismo texto en inglés, español neutro y español peruano coloquial.
- Ataques: partir de ataques humanos en inglés con licencia abierta (LLMail-Inject y Gandalf, MIT; deepset, Apache-2.0) más los 9 objetivos de `banking`. Evitar generar todo desde una plantilla: si hay plantillas, el clúster es la plantilla y el n efectivo se desploma.
- Benignos: diseño de gemelos (B6). Por cada ataque, una orden legítima del mismo tema y con las mismas palabras gatillo: imperativos, «olvídate de», «mejor», montos, urgencia.
- Jerga: diccionario de Santos y Calizaya ([figshare 26198315](https://figshare.com/articles/dataset/26198315), CC BY 4.0, comentarios peruanos reales). ◐ metadatos
- Versiones en español: borrador con un LLM y **revisión del 100 % por una persona peruana**. La traducción automática sin revisión es la crítica que tumba a casi todo lo existente.
- Segunda condición, gratis: el mismo texto incrustado en una salida real de tool de `banking` (el campo de asunto de una transacción). B11 muestra que el FPR cambia de 0 a 90 % en salidas de herramientas.

**Clasificadores (todos corren en CPU).**

| Modelo | Por qué | Riesgo |
|---|---|---|
| Llama Prompt Guard 2 86M | El detector abierto de referencia; declara español | Acceso restringido en Hugging Face: pedirlo ya |
| ProtectAI deberta-v3 v2 | El detector de la tabla de AgentDojo; ya está en la caché de la laptop | Declara solo inglés: decirlo, es parte del hallazgo |
| PIGuard | Diseñado contra la sobredefensa | Licencia sin verificar |
| Horizon-Labs guard small o base | Apache-2.0, multilingüe, sin restricción | Cifras autorreportadas |

Control opcional: Prompt Guard 2 22M (sin preentrenamiento multilingüe; debería ser el peor en español).

**Por qué n = 150.** Calculado con simulación del McNemar exacto (5.000 repeticiones por celda, semilla fija, TPR base 95 % en inglés, potencia 80 %). Se reproduce con `uv run --with scipy --with numpy python vault/papers-potencia.py` (~40 s; lo volví a correr y da estas cifras):

| Brecha a detectar | Pares si los errores coinciden entre idiomas | Con 2 pp de discordancia inversa | Con 5 pp |
|---|---|---|---|
| 5 pp | 157 | 298 | 492 |
| 10 pp | 78 | 113 | 168 |
| 15 pp | 51 | 68 | 89 |
| 20 pp | 39 | 48 | 60 |

- 150 pares detectan 10 pp con discordancia baja y 15 pp aun corrigiendo 12 comparaciones con Holm (112–151).
- Para falsos positivos, distinguir 2 % de 10 % pide 99–126 pares; 2 % de 20 %, unos 45.
- **Piso si no alcanza el tiempo: 100 + 100**, declarando que solo se detectan brechas de 15 pp o más. Brechas de 5 pp no se prometen.
- Precisión de cada tasa con n = 150: ±3,6 pp si ronda 95 %, ±6,4 pp si ronda 80 %.

**Reporte.** Por clasificador e idioma: TPR y FPR al umbral con IC de Wilson; los dos conteos discordantes (b y c) y el p de McNemar mid-p; IC pareado de Newcombe para la diferencia; AUC con bootstrap pareado; curvas ROC de los tres idiomas con el punto del umbral marcado. Si la primaria no sale significativa, se reporta el efecto mínimo detectable, no «no hay diferencia».

**Costo.**

| Paso | Costo | Base |
|---|---|---|
| Borrador de 600 textos en español con un LLM | ~0,3 M de tokens (0,1 M de salida) | Estimado: 600 textos × ~150 tokens, más instrucciones. Sin medir |
| Clasificación: 900 textos × 2 condiciones × 4 modelos | 0 tokens; ~35 min de CPU | ~290 ms por texto en 2 núcleos (ficha de B7). Sin medir en esta laptop |
| Revisión nativa de 300 textos peruanos | ~2 h de una persona | 20–25 s por texto. Es el cuello de botella |
| Opcional: agente con el detector como filtro, 16 tareas × 2 idiomas × 2 detectores | ~0,8 M de tokens | Estimado desde los logs de `runs/` (≈8 KB por corrida, 3–4 llamadas con 11 tools): ~12 mil tokens por corrida. Sin medir con contador |

Total con el opcional: ~1,1 M de tokens, la mayoría de entrada. Sonnet 5.5 se negó a hacer de atacante en `adaptive.py`; es probable que también se niegue a reescribir inyecciones, así que el borrador va con Mistral Large 4.

**Experimento cero, sin gastar nada (hacerlo primero):** pasar los clasificadores por las salidas de tools ya guardadas en `runs/` de la rama `esqueleto` (48 corridas limpias, 162 con la inyección en inglés y 162 con la plantilla peruana). Da FPR sobre salidas reales y detección de las dos plantillas. No reemplaza al experimento: son 3 objetivos y una plantilla por idioma, y el objetivo sigue en inglés.

**Limitaciones que se dicen primero.**

- Detección aislada no es seguridad del agente: A11 y RL-Hammer rompen estos mismos detectores con ataques adaptativos. Medimos el piso (ataques sin optimizar) y el costo en clientes legítimos.
- Los textos peruanos los escribe y revisa el propio equipo: riesgo de escribir hacia la hipótesis. Mitigación: fijar umbral e hipótesis antes, y publicar el dataset.
- Un registro (coloquial limeño) no es «el español peruano».
- Tres antecedentes sugieren que el dialecto por sí solo no rompe nada (B23, B25, y Gemini con ASR más bajo al traducir). Un resultado nulo es plausible y también es el primer dato publicado.

**El siguiente cuello de botella.** Si hay brecha, la pregunta inmediata del jurado es «¿y recalibrando?». Por eso la secundaria (c) va incluida desde el inicio y no como trabajo futuro.

---

## 5. Cinco afirmaciones para el pitch

1. **«Que los seis modelos resistan 288 ataques de plantilla es lo que la literatura predice: esos benchmarks están saturados desde fines de 2025.»**
   Respaldo: DeepMind, A12 («saturated by frontier models since fall 2025»); Anthropic, A17 («have saturated most public benchmarks»); GPT-5 0,2 % en AgentDojo (A16, T8); Haiku 4.5 0,3 % (A14, T5).
2. **«Cero con nuestro atacante no es robustez: con atacantes más fuertes, estos mismos modelos caen.»**
   Respaldo: GPT-5 Mini sin defensa, 0 % estático → 75 % adaptativo (A11, T7); DeepSeek v4.1 Flash, 99 % de escenarios rotos con 320 consultas (A12, T1); ataques humanos, 47–58 % contra modelos que dan ~5 % en benchmarks (A8).
3. **«El detector de texto es la defensa que se compra, y la más cara para el cliente: en el benchmark de referencia se lleva casi la mitad de la utilidad.»**
   Respaldo: ProtectAI en AgentDojo, utilidad 41,5 % contra 69,0 % sin defensa (A2, T5); 38,1 % contra 80,4 % (MELON, T1); recortes de ¼ a ½ (A14).
4. **«Una AUC alta no dice si el detector funciona: importa el umbral, y el umbral calibrado en inglés no viaja.»**
   Respaldo: Prompt Guard 1, AUC 0,987 con recall 21,2 % a 1 % de FPR (B1, ficha de Meta); AUC 0,92 con FPR 0,89 (B12, T3a); recalibrar con 32 ejemplos por clase repara la caída (B15). Evidencia fuera del inglés, autorreportada y por eso dicha como «indicios»: turco 14 % (B4), hindi 0 % (A19), salidas de tools en español 12 % (B8).
5. **«No encontramos a nadie que haya medido estos detectores en español escrito por hablantes nativos, ni sus falsos positivos con lenguaje coloquial; en español peruano, nada.»**
   Respaldo: la ficha de Prompt Guard 2 solo da una AUC multilingüe agregada (B1); ProtectAI declara solo inglés (B3); NotInject no tiene español (B5); lo publicado en español son 26 textos (B7) y 1 prompt (B9); las variantes regionales estudiadas no incluyen la peruana (B25, B26).

Qué **no** afirmar: que el español peruano «rompe» modelos o detectores (no lo medimos y la literatura no lo apoya), que el ASR real es menor que 1,3 %, ni cifras autorreportadas como si fueran de un paper.

## 6. Segunda pasada sobre las cinco afirmaciones

Pendiente: se completa con el resultado de la verificación independiente.
