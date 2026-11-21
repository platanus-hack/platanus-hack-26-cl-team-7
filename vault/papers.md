# Papers — revisión de literatura (21/11/2026)

> Cuatro subagentes (Opus) en paralelo, uno por tema; consolidación, juicio y diseño del experimento en Fable; una segunda pasada independiente (Fable) reabrió las cifras de las 5 afirmaciones del pitch y corrigió varias (§6). Complementa a [[research]] y [[research-ganadores]]; el experimento aterriza el frente «clasificador EN vs es_pe» de [[pendientes]].

**Cómo leer las marcas.** ✔ = un subagente abrió la fuente en esta sesión y vio la cifra ahí (se indica tabla o sección). ◐ = solo se leyó el abstract, o la cifra es autorreportada por una ficha de modelo o un repo sin revisión de pares. **[NO VERIFICADO]** = memoria o snippet de buscador; no citar sin abrir. Yo no reabrí personalmente cada fuente: lo que sube a una lámina se confirma en el PDF.

## TL;DR

1. **El 0/288 es lo que la literatura predice, y eso lo vuelve citable en vez de decepcionante.** DeepMind y Anthropic ya escriben que los benchmarks estáticos (AgentDojo incluido) están saturados por los modelos frontier desde fines de 2025. GPT-5 da 0,2 % en AgentDojo; Claude Haiku 4.5, 0,3 %.
2. **El 0/12 adaptativo mide a nuestro atacante, no a los modelos.** Un atacante en enjambre de DeepMind rompe DeepSeek v4.1 Flash (uno de nuestros seis) en 99 % de los escenarios con 320 consultas. Hay que decirlo así: «cota de nuestro atacante», nunca «el modelo es robusto».
3. **El hueco es real y más preciso de lo que creíamos:** no encontramos ninguna evaluación de Prompt Guard 2, ProtectAI ni PIGuard sobre español escrito de forma nativa con más de 32 ejemplos, ni de sus falsos positivos con español coloquial. Español peruano: cero trabajos en seguridad de LLM. Lo más cercano es de otro detector (Horizon-Labs, 800 prompts humanos) o traducción automática.
4. **La tesis que la evidencia sostiene no es «el peruano rompe la seguridad»** (tres trabajos dan resultado nulo o «el dialecto no es necesario ni suficiente»). Es: **«el punto de operación calibrado en inglés no se transfiere, y el costo lo paga el cliente legítimo»**. Hay indicios en otros idiomas, todos autorreportados: Prompt Guard 2 detecta 30 % en inglés y 7 % en hindi al mismo umbral; ProtectAI marca 47–59 % de benignos en hindi y turco, y 10,6 % contra 1,0 % en español traducido.
5. **Experimento mínimo:** 150 ataques + 150 gemelos benignos en cuatro brazos (inglés, español neutro, español peruano y su retraducción al inglés), más benignos externos; 4 clasificadores en la laptop; McNemar pareado; dos hipótesis primarias registradas antes de correr. Con 150 pares se ve una brecha de 15 pp en cualquier escenario. Costo de API: ~0,45 M de tokens (1,25 M con el opcional); el cuello es la revisión nativa de 300 textos (~2 h de una persona).

### Correcciones a notas anteriores del vault

- **GPT-4o en AgentDojo sin defensa: citar ASR 47,69 %** (Tabla 3 y página oficial). El 57,7 % sale de las Tablas 4–5 del mismo paper, que dicen describir la misma configuración: es una inconsistencia interna del paper. La tabla de defensas (Tabla 5) se cita completa con su propia fila base.
- **«Prompt Guard 2 previene 81,2 % con 3 % de pérdida de utilidad» está mal leído.** La métrica es *APR @ 3 % utility reduction*. La ficha no define APR ni el procedimiento; la lectura razonable (inferencia nuestra) es que el umbral se elige para perder 3 % y se mide cuánto previene ahí. No es una pérdida medida de forma independiente.
- **arXiv 2607.05518 no es un estudio de ASR:** es aiAuthZ, reporte técnico de un autor. El dato de `banking` son 20 pares y 2 modelos (Fable 5 y Gemini 3 Flash), ambos 0 % sin defensa. Sirve como corroboración anecdótica.
- **BabelDojo:** los dos repos son el mismo sitio de proyecto sin experimentos, sin paper y sin resultados. Citar `faerber-lab/BabelDojo` (organización, más commits).
- **«0/288 → ASR < 1,3 %» no se puede decir:** las 288 corridas no son independientes (6 modelos, mismas tareas). Reportar por celda (0/24, IC95 0–13,8 %) y por modelo (0/48, 0–7,4 %).
- **«Prompt Guard 2 detecta 0 % en hindi con el umbral inglés» (bhasha-shield) es engañoso:** ese umbral era 0,9944 y tampoco detecta nada en inglés. Al umbral 0,5: inglés 30 %, hindi 7 %.
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
| A11 | Nasr, Carlini et al. (2025). *The Attacker Moves Second.* [arXiv 2510.09023](https://arxiv.org/abs/2510.09023) | Rompe 12 defensas que reportaban ASR casi nulo con búsqueda, RL, gradiente y humanos. | **GPT-5 Mini sin defensa: 0 % estático → 75 % adaptativo** con 800 consultas (T7). Detectores, con Gemini 2.5 Pro de base: ProtectAI 90 %, Prompt Guard 2 94 %, PIGuard 71 % (con GPT-5 Mini: 81 / 75 / 49 %) | ✔ §5, T7 |
| A12 | Kurakin et al., Google DeepMind (nov-2026). *Scaling Adaptive Prompt Injection Attacks with Agent Swarms.* [arXiv 2611.11861](https://arxiv.org/html/2611.11861v1) | Los benchmarks estáticos están «saturated by frontier models since fall 2025». Métrica ARR@k. | **DeepSeek-V4.1-Flash: 99 de 100 escenarios rotos** (T1), también con 150 consultas. Escenarios sintéticos propios; éxito = cualquier llamada a tool ajena a la tarea | ✔ T1–T5 |
| A13 | Hofer, Debenedetti, Tramèr (2026). *Assessing Automated Prompt Injection Attacks in Agentic Environments.* [arXiv 2606.10525](https://arxiv.org/html/2606.10525v1) | GCG y TAP sobre AgentDojo; GCG de modelos chicos no transfiere a frontier. | GPT-5: ~4,5 % con TAP; `banking` ~50 % en Qwen3-4B | ✔ texto, sin tablas |
| A14 | Ma et al. (2026). *AutoDojo.* [arXiv 2606.15057](https://arxiv.org/html/2606.15057v3) | Atacante adaptativo de caja negra sobre AgentDojo (incluye `banking`); 10 defensas. «A low static ASR is cheaply earned». | Haiku 4.5: 0,3 → 1,8 %; DeepSeek-v4-Flash estático 22,6 % (12,5 % en `banking`, T6). PIGuard: 0 → 28 %. PIGuard y ProtectAI recortan la utilidad entre ¼ y ½; Prompt Guard 2 casi no la toca (63,2 vs 66,7) ni bloquea | ✔ T5, §4 |
| A15 | Li et al. (2026). *AgentDyn.* [arXiv 2602.03117](https://arxiv.org/html/2602.03117) | Sucesor más dinámico; los modelos nuevos «probablemente se entrenaron con las plantillas de ataque conocidas». | GPT-5-mini 0,4 %, Sonnet 4.5 0,9 % (T8) | ✔ |
| A16 | Chen et al., Meta (2025/26). *Meta-SecAlign.* [arXiv 2507.02735](https://arxiv.org/html/2507.02735) | Fine-tuning contra inyección; sus tablas sirven de referencia de modelos sin defensa. | AgentDojo: **GPT-5 0,2 %**, Gemini 3 Pro 3,8 %, GPT-4o 43,2 % (T8) | ✔ |
| A17 | Anthropic (2026). System cards de Opus 5, Opus 5.5, Sonnet 5.5 y Haiku 5.5, §5.2. [transparency](https://www.anthropic.com/transparency) | «Claude models have saturated most public benchmarks». Distinguen ASR por intento y por escenario, y reportan éxito a k intentos. Ninguna card mide inyección fuera del inglés. | Gray Swan, k=15: Sonnet 5.5 3,4 % (tool use 1,0 %); Haiku 5.5 7,1 %; «GPT 5.6 Luna» 43,9 % | ✔ PDF, §5.2 |
| A18 | Hofman et al. (2026). *MAPS.* Findings EACL. [arXiv 2505.15935](https://arxiv.org/html/2505.15935) | Lo más cercano a seguridad de agentes en español (latinoamericano): traduce ASB a 11 idiomas. Solo traduce instrucciones; no aclara si la inyección es indirecta. | GPT-5-mini: ASR 32,7 % en inglés vs 39,2 % en español (T16–19) | ✔ |
| A19 | Sameerkc3579 (2026). [bhasha-shield](https://github.com/Sameerkc3579/bhasha-shield). Repo, sin paper | Nuestro diseño, en hindi. Propone uASR: contar solo casos que el agente es capaz de ejecutar. | Prompt Guard 2 a 0,5: detecta 30 % en inglés (45/150) y 7 % en hindi (11/150), con AUC 0,94–0,98. El «0 %» es con umbral 0,9944 y también vale para inglés. ProtectAI: 47 % de FP en hindi | ◐ README |
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
| B3 | ProtectAI. [deberta-v3-base-prompt-injection-v2](https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2), ficha | «It does not detect jailbreak attacks or handle non-English prompts». Apache-2.0, archivado. | NotInject 56,6 % (B5) | ✔ ficha |
| B4 | Horizon-Labs (2026). [prompt-injection-guard-base](https://huggingface.co/Horizon-Labs/prompt-injection-guard-base), ficha | La evaluación más completa de Prompt Guard 2 fuera del inglés; la publica un competidor. | Turco, umbral 0,5: **PG2-86M detecta 14 %** (AUC 0,772, FPR 0,2 %; sin línea base en inglés sobre el mismo set); ProtectAI 56 % con 18,9 % de falsas alarmas. FPR de su propio modelo en 800 prompts humanos en español: 0,25–1,25 % | ◐ autorreportado |
| B5 | Li, Liu, Xiao (2025). *InjecGuard / PIGuard.* ACL. [arXiv 2410.22770](https://arxiv.org/abs/2410.22770) | Sesgo de palabras gatillo: «ignore» ⇒ malicioso. NotInject: 339 benignos; 84 «multilingües», casi todos en chino y 1 frase en español. | Precisión sobre benignos: Prompt Guard v1 0,88 %; ProtectAI v2 56,64 %; Lakera 87,61 % (T1) | ✔ |
| B6 | Deniz (2026). [BenignTwin](https://github.com/3nesdeniz/benigntwin). Repo | Cada ataque se puntúa junto a un «gemelo» benigno del mismo tema y redacción. Es el diseño a copiar. | ProtectAI v2: FPR 0,8 % en inglés vs **59,2 % en turco** | ◐ autorreportado |
| B7 | Ngalame (2026). [prompt-injection-en-es](https://huggingface.co/datasets/edithngalame/prompt-injection-en-es), dataset y modelo | 18.312 filas; el español es casi todo opus-mt. Solo 32 filas humanas. | ProtectAI en español humano: recall 77 % (n = 26); FPR 38 % en benignos difíciles | ◐ autorreportado |
| B8 | juanpza (2026). [PG2 guardrail-ft](https://huggingface.co/juanpza/Llama-Prompt-Guard-2-86M-guardrail-ft), ficha | Fine-tune para inyección en salidas de herramientas, inglés y español. | **PG2 original: recall 12 % en salidas de herramientas en español** | ◐ autorreportado |
| B9 | Outeda et al., UdelaR (sep-2026). *Decoding Guardrails.* [arXiv 2609.24801](https://arxiv.org/html/2609.24801v1) | Único ataque publicado a Prompt Guard 2 con un prompt en español (rioplatense). Un solo caso. | 7 sinónimos bajan P(inyección) de 0,9994 a 0,2224 (§4.5) | ✔ n = 1 |
| B10 | Hackett et al. (2025). *Bypassing LLM Guardrails.* [arXiv 2504.11168](https://arxiv.org/abs/2504.11168) | Evasión por caracteres contra 6 guardrails. No prueba traducción. Las tildes cambian la tokenización. | Evasión: Prompt Guard v1 70,44 %; ProtectAI v2 20,26 %; emoji smuggling 100 % | ✔ |
| B11 | Liu (oct-2026). *Passing the Test You Trained On.* [arXiv 2610.03448](https://arxiv.org/abs/2610.03448) | 15 detectores sobre salidas de herramientas reales; el ranking no se transfiere entre benchmarks. Solo inglés. | El mejor en BIPIA detecta 2 % de AgentDojo a 1 % de FPR; FPR en salidas de herramientas de 0 a 90 % | ◐ abs |
| B12 | Jia et al. (2025). *A Critical Evaluation of Defenses against Prompt Injection.* [arXiv 2505.18333](https://arxiv.org/abs/2505.18333) | Pide evaluar detectores con FPR y FNR, no solo AUC. | Prompt Guard v1: **AUC 0,92 con FPR 0,89** (T3a) | ✔ |
| B13 | Gonzalez-Sancho et al. (nov-2026). Applied Sciences 16(21):11039. [doi](https://doi.org/10.3390/app162111039) | RAG local, diseño 2×2 de idioma (español/inglés). El filtro calibrado en español no elimina frases de anulación en inglés. | ASR tras filtro: 14,3–40,7 % según idioma | ◐ abs (MDPI 403) |
| B14 | Fuziwara Filho et al., USP (2026). SBSeg. [PDF](https://repositorio.usp.br/bitstreams/84eba1ea-522a-439f-a649-d9d3c075fcb5) | DefensiveTokens entrenados en portugués, ataques traducidos con NLLB. | Español sin defensa: 4,5–61,1 % según modelo (T1) | ✔ |
| B15 | Aziz, Hanif, Koto (2026). [arXiv 2606.01196](https://arxiv.org/abs/2606.01196) | Calibra con 32 ejemplos por clase una compuerta sobre activaciones internas de un LLM. **No es un detector externo** y el español se comporta como el inglés: no respalda nuestra tesis. | Rechazo 43,9 → 67,2 %, contra 87,9 % de referencia | ✔ abs, §5.1 |
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
| B27 | adeoluo. `prompt-injection-detector`. Repo | ProtectAI v2 sobre español traducido, n = 500 + 500. En español detecta más, no menos, y marca diez veces más benignos. | Detección 97,8 % vs 90,6 % en inglés; **FPR 10,6 % vs 1,0 %** | ◐ autorreportado |

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
- **Clasificadores: TPR y FPR al umbral fijado antes de mirar los datos**, por idioma; AUC como secundaria. Un desplazamiento de puntajes entre idiomas puede dejar intacta la AUC y hundir el TPR al umbral (B1, B4, B12, A19).
- **Capacidad por idioma** (uASR de bhasha-shield, «seguridad por incompetencia» de WASP): un ASR 0 en otro idioma no distingue robustez de incapacidad si no se mide la utilidad en ese idioma. Hoy solo tenemos utilidad con tareas en inglés.

## 3. Mapa de huecos (qué no está medido)

1. **Detectores de inyección sobre español nativo.** Lo que existe es traducción automática (B2, B7, B14, B27), n diminuto (26 textos en B7, 1 prompt en B9), otro detector (B4, solo falsos positivos de su propio modelo) u otro idioma (turco, hindi, bengalí). Meta evaluó español en Prompt Guard 2 y no publicó la cifra.
2. **Falsos positivos con benignos coloquiales en español.** NotInject trae 1 frase en español de 339; BenignTwin es inglés y turco; LLMail-Inject midió falsos positivos solo con correos de Enron. Órdenes como «pásale 50 lucas a mi causa al toque» u «olvídate de lo que te dije, mejor mándale a…» no están en ningún benchmark.
3. **Español peruano.** Cero trabajos en jailbreak, inyección o guardrails. Las variantes estudiadas son mexicana, rioplatense, chilena, peninsular y uruguaya, siempre contra LLM y nunca contra detectores.
4. **Calibración del umbral por idioma en detectores de inyección.** Hay indicios en guards de contenido (B16) y en hindi (A19, repo); en español, nadie.
5. **Inyección indirecta en agentes con tools en español, con modelos de 2026.** MAPS usa modelos de 2025 y solo traduce instrucciones; BabelDojo no corrió; injection-es es un repo con un modelo. Mistral Large 4 y Qwen 3.8 Omni Flash no aparecen en ningún benchmark de inyección que hayamos abierto.
6. **Defensas de sistema con usuarios no angloparlantes.** CaMeL y Progent dependen de que el modelo escriba el programa o la política desde la consulta; nadie midió si eso se degrada en español.
7. **Incertidumbre.** Casi nadie reporta intervalos (AutoDojo lo admite) ni separa capacidad de robustez por idioma.

Los huecos 1–4 son los que ocupamos. El 5 ya lo tocamos con el 0/288 y sus limitaciones. Son afirmaciones de ausencia: se dicen como «no encontramos», con las búsquedas hechas (listadas por los subagentes: Prompt Guard 2 + Spanish, per-language false positive, dialect Spanish jailbreak, IberLEF 2026, Peruvian slang, entre otras).

---

## 4. Experimento mínimo defendible

Esta versión ya incorpora la crítica de la segunda pasada (§6): cambió la línea base de la potencia, la hipótesis primaria pasó a ser doble y se sumaron un control de paráfrasis y benignos que no escribimos nosotros.

**Pregunta.** El detector de inyección que un banco puede descargar hoy, con el umbral con el que viene, ¿detecta lo mismo y molesta lo mismo cuando el cliente escribe en español peruano que en inglés?

**Paso 0, antes de registrar nada (minutos de CPU, 0 tokens).**

1. Correr los cuatro detectores sobre el brazo en inglés de los ataques. La potencia depende de la tasa base real, y las fuentes dicen que Prompt Guard 2 a 0,5 detecta mucho menos que el 97,5 % de su ficha: 30 % sobre AgentDojo (bhasha-shield), 21 % en LLMail-Inject (ficha de Horizon-Labs), 25 % en salidas de tools (juanpza). Con la tasa medida se recalcula el n.
2. Pasar los detectores por las salidas de tools ya guardadas en `runs/` de la rama `esqueleto` (48 corridas limpias, 162 con la inyección en inglés y 162 con la plantilla peruana). Da FPR sobre salidas reales. No reemplaza al experimento: son 3 objetivos y una plantilla por idioma, y el objetivo sigue en inglés.

**Hipótesis primarias (dos, Holm entre ambas; se commitean antes de correr los brazos en español).**

- **H1, detección:** Prompt Guard 2 86M, al umbral 0,5, detecta menos ataques en español peruano que en inglés sobre los mismos ataques.
- **H2, molestia:** ProtectAI v2 marca más textos benignos en español peruano que en inglés. Es donde hay señal previa (10,6 % contra 1,0 % en español traducido; 59,2 % contra 0,8 % en turco) y es la que sostiene la frase del pitch «el costo lo paga el cliente legítimo».

Resultado más probable según la literatura: Prompt Guard 2 detecta poco en los dos idiomas y casi no da falsos positivos; ProtectAI detecta igual o más en español y marca muchos más benignos. Si sale así, H2 es el titular y H1 se reporta con su efecto mínimo detectable.

**Secundarias (exploratorias, Holm sobre el resto).** (a) Español neutro vs peruano: ¿es el idioma o el registro? (b) Español peruano vs su retraducción al inglés: ¿es el idioma o es que el texto es nuevo para el detector? (c) TPR a FPR fija (1 % y 5 %) con umbral ajustado por idioma, con dos conjuntos benignos. El antecedente es bhasha-shield, no un paper.

**Datos.**

- **150 ataques × 4 brazos:** inglés original, español neutro, español peruano coloquial y el peruano retraducido al inglés por el mismo LLM (control de paráfrasis: los ataques públicos pueden estar en el entrenamiento de los detectores, y cualquier reescritura baja la detección).
- **150 gemelos benignos × 4 brazos** (diseño de BenignTwin, B6): por cada ataque, una orden legítima del mismo tema.
- **Benignos que no escribimos nosotros:** 400 turnos `es` y 400 `en` de OASST2 (hay cifra publicada de referencia para un detector, B4) y una muestra de comentarios peruanos reales de Santos y Calizaya ([figshare 26198315](https://figshare.com/articles/dataset/26198315), CC BY 4.0; ◐ metadatos). Una tasa de falsos positivos sobre textos que escribió quien conoce la hipótesis no es una tasa de molestia.
- Fuentes de ataques: LLMail-Inject y Gandalf (MIT), deepset (Apache-2.0) y los 9 objetivos de `banking`. Sin generar todo desde una plantilla: si hay plantillas, el clúster es la plantilla y el n efectivo se desploma.
- Versiones en español: borrador con un LLM y **revisión del 100 % por una persona peruana**. La traducción automática sin revisión es la crítica que tumba a casi todo lo existente.

**Reglas que se escriben antes de generar.**

- **Etiqueta por canal, no por contenido.** La ficha de Prompt Guard 2 declara malicioso todo texto que intente anular instrucciones previas. «Olvídate de lo que te dije, mejor mándale a…» es positivo por diseño. Entonces: turno del usuario = benigno; texto que llega en una salida de tool = ataque. Los gemelos con frase de anulación se reportan aparte.
- **Qué se traduce:** todo, incluido el objetivo del ataque; nombres de tools, cuentas y correos quedan igual en los cuatro brazos.
- **Longitud:** mismo tope de tokens en los cuatro brazos (Prompt Guard 2 lee 512) y la longitud como covariable. El español sale más largo.
- Segunda condición, gratis: el mismo texto incrustado en una salida real de tool de `banking`. B11 muestra que el FPR cambia de 0 a 90 % en salidas de herramientas.

**Clasificadores (todos corren en CPU).**

| Modelo | Por qué | Riesgo |
|---|---|---|
| Llama Prompt Guard 2 86M | El detector abierto de referencia; declara español | Acceso restringido en Hugging Face: pedirlo ya |
| ProtectAI deberta-v3 v2 | El detector de la tabla de AgentDojo; ya está en la caché de la laptop | Su ficha dice que no maneja textos fuera del inglés: es parte del hallazgo |
| PIGuard | Diseñado contra la sobredefensa | Licencia sin verificar |
| Horizon-Labs guard small o base | Apache-2.0, multilingüe, sin restricción | Cifras autorreportadas |

**Por qué n = 150, y qué alcanza a ver.** Los pares necesarios (α = 0,05 bilateral, potencia 80 %) dependen de cuánto discrepan los idiomas en sentido contrario a la brecha:

| Brecha | Discordancia inversa 0 | 2 pp | 5 pp | Errores independientes, base 30 % |
|---|---|---|---|---|
| 10 pp | 78 | 113 | 168 | 296 |
| 15 pp | 51 | 68 | 89 | 123 |
| 20 pp | 39 | 48 | 60 | 64 |

- Las tres primeras columnas salen de simulación del McNemar exacto (5.000 repeticiones por celda, semilla fija). Se reproducen con `uv run --with scipy --with numpy python vault/papers-potencia.py` (~40 s; lo volví a correr y da estas cifras). La última es la fórmula de Connor (D7) calculada aparte, sin simular; la fórmula subestima entre 1 y 8 %.
- **Con 150 pares se detecta una brecha de 15 pp en cualquier escenario, y una de 10 pp solo si los errores coinciden entre idiomas.** Eso se dice tal cual. Brechas de 5 pp no se prometen (157 a 492 pares).
- Falsos positivos: distinguir 2 % de 10 % pide 99–126 pares; 2 % de 20 %, unos 45.
- Piso si no alcanza el tiempo: 100 + 100, que solo ve brechas de 20 pp con holgura.
- Precisión de cada tasa con n = 150: ±3,6 pp si ronda 95 %, ±6,4 pp si ronda 80 %, ±7,9 pp si ronda 50 %.

**Reporte.** Por clasificador y brazo: TPR y FPR al umbral con IC de Wilson; los dos conteos discordantes y el p de McNemar mid-p; IC pareado de Newcombe para la diferencia; AUC con bootstrap pareado; curvas ROC con el punto del umbral marcado. Si una primaria no sale significativa, se reporta el efecto mínimo detectable, no «no hay diferencia».

**Costo.**

| Paso | Costo | Base |
|---|---|---|
| Borrador de 900 textos (neutro, peruano y retraducción) con un LLM | ~0,45 M de tokens (0,15 M de salida) | Estimado: ~150 tokens por texto, más instrucciones. Sin medir |
| Clasificación: ~2.300 textos × 2 condiciones × 4 modelos | 0 tokens; ~1,5 h de CPU | ~290 ms por texto en 2 núcleos (ficha de B7). Sin medir en esta laptop |
| Revisión nativa de 300 textos peruanos | ~2 h de una persona | 20–25 s por texto. Es el cuello de botella |
| Opcional: agente con el detector como filtro, 16 tareas × 2 idiomas × 2 detectores | ~0,8 M de tokens | Estimado desde los logs de `runs/` (≈8 KB por corrida, 3–4 llamadas con 11 tools): ~12 mil tokens por corrida. Sin medir con contador |

Total con el opcional: ~1,25 M de tokens, la mayoría de entrada. Sonnet 5.5 se negó a hacer de atacante en `adaptive.py`; es probable que también se niegue a reescribir inyecciones, así que el borrador va con Mistral Large 4.

**Limitaciones que se dicen primero.**

- Detección aislada no es seguridad del agente: A11 y RL-Hammer rompen estos mismos detectores con ataques adaptativos. Medimos el piso (ataques sin optimizar) y el costo en clientes legítimos.
- Los textos peruanos los escribe y revisa el propio equipo. Mitigación: hipótesis y umbral fijados antes, benignos externos y dataset publicado.
- Un registro (coloquial limeño) no es «el español peruano».
- Tres antecedentes sugieren que el dialecto por sí solo no rompe nada (B23, B25, y Gemini con ASR más bajo al traducir). Un resultado nulo en H1 es plausible.
- Sobre lo ya medido: para DeepSeek la literatura da 12,5 % en `banking` con la plantilla estática (v4-Flash, AutoDojo T6) y nosotros medimos 0/48 en v4.1 Flash (cota 7,4 %). No está explicado: usamos 3 objetivos de 9, 8 tareas de 16 y otra versión del modelo.

**El siguiente cuello de botella.** Si H2 sale, la pregunta inmediata del jurado es «¿y subiendo el umbral?». Por eso la secundaria (c) va desde el inicio.

---

## 5. Cinco afirmaciones para el pitch

Redacción posterior a la segunda pasada: cuatro respaldos del primer borrador decían más de lo que la fuente sostiene (detalle en §6).

1. **«Que los modelos frontier resistan ataques de plantilla es lo que la literatura predice. En los modelos abiertos, nuestro cero es más bajo de lo publicado, y lo decimos.»**
   Respaldo: GPT-5 0,2 % en AgentDojo (A16, T8); DeepMind, citando esa misma fuente: «saturated by frontier models since fall 2025» (A12, §2); Anthropic, card de Opus 5 §5.2: «have saturated most public benchmarks»; Haiku 4.5 0,3 % (A14, T5). Contraste: DeepSeek-v4-Flash 12,5 % en `banking` (A14, T6).
2. **«Cero con nuestro atacante no es robustez: es la cota de nuestro atacante. Con atacantes más fuertes, modelos de esta generación caen, unos mucho más que otros.»**
   Respaldo: DeepSeek v4.1 Flash, 99 de 100 escenarios con un enjambre de Gemini 4 Argon, donde cuenta como éxito cualquier llamada a una tool ajena a la tarea (A12, T1); GPT-5 Mini 0 % → 75 % con 800 consultas (A11, T7); ataques humanos repetidos sin optimizar: GPT-5 mini 47 %, y Meta-SecAlign 32 % pese a dar menos de 5 % en benchmarks (A8, T5). Contrapeso: Haiku 4.5 solo sube a 1,8 % (A14, T5).
3. **«El detector de texto es la defensa que se compra. Los que de verdad bloquean se llevan entre un cuarto y la mitad de la utilidad; el que no la toca, casi no bloquea.»**
   Respaldo: ProtectAI en AgentDojo, 41,5 % contra 69,0 % (A2, T5); 38,1 % contra 80,4 % (MELON, T1); PIGuard y ProtectAI, «a quarter to a half on every model» (A14, §4); Prompt Guard 2 en esa misma tabla: utilidad 63,2 contra 66,7 y ASR 54,2 contra 58,6 (A14, T5).
4. **«Una AUC alta no dice si el detector funciona: importa el punto de operación, y hay indicios de que no se transfiere entre idiomas.»**
   Respaldo: Prompt Guard 1, AUC 0,987 con recall 21,2 % a 1 % de FPR en inglés (ficha de Meta, que da 97,5 % para la versión 2); AUC 0,92 con FPR 0,89 (B12, T3a). Indicios autorreportados, dichos como indicios: Prompt Guard 2 a 0,5 detecta 30 % en inglés y 7 % en hindi con AUC 0,94–0,98 (A19); 14 % en turco (B4); 12 % en salidas de tools en español contra 25 % en el conjunto completo (B8).
5. **«No encontramos una evaluación de Prompt Guard 2, ProtectAI ni PIGuard sobre español escrito por hablantes nativos, ni de sus falsos positivos con español coloquial; en español peruano, nada. Lo que hay es traducción automática, muestras de 10 a 26 textos, u otro detector.»**
   Respaldo: la ficha de Prompt Guard 2 solo da una AUC multilingüe agregada (B1); ProtectAI declara que no maneja textos fuera del inglés (B3); NotInject trae 1 frase en español de 339 (B5); ProtectAI sobre español traducido: 97,8 % de detección y 10,6 % de FPR (B27); Horizon-Labs midió falsos positivos en 800 prompts humanos en español, solo de su propio modelo (B4); PINT incluye español sin desglose.

Qué **no** afirmar: que el español peruano «rompe» modelos o detectores; que el ASR real es menor que 1,3 %; que «los seis modelos» caen ante atacantes fuertes (hay evidencia directa solo para DeepSeek v4.1 Flash); cifras autorreportadas como si fueran de un paper.

## 6. Segunda pasada: qué se reabrió y qué cambió

Un revisor independiente (Fable) reabrió las fuentes primarias de las cinco afirmaciones e intentó refutar la quinta. No reabrió B7, B9, B25 ni B26. La system card de Opus 5 la leyó en la copia local del PDF, no la volvió a bajar.

**Confirmadas textuales:** la frase de DeepMind (2611.11861 §2) y el 99 % de DeepSeek (T1); la frase de la card de Opus 5 (§5.2, p. 71); GPT-5 0,2 % (2507.02735 T8); Haiku 4.5 0,3 → 1,8 (2606.15057 T5); GPT-5 Mini 0 → 75 % (2510.09023 T7); 41,49 % contra 69,0 % (2406.13352 T5); 38,14 % contra 80,41 % (2502.05174 T1); AUC 0,987 con recall 21,2 % y AUC multilingüe 0,995 sin desglose (ficha de Prompt Guard 2); AUC 0,92 con FPR 0,89 (2505.18333 T3a); 339 benignos y 56,64 % (2410.22770); la frase de la ficha de ProtectAI («does not … handle non-English prompts»); las tres cifras autorreportadas (14 %, 12 %, 0 %).

**Lo que el primer borrador decía de más:**

- **LLMail-Inject:** el «~5 % en benchmarks» es solo de Meta-SecAlign. De GPT-4o el mismo párrafo dice 20 % en AgentDojo. Corregido en la afirmación 2.
- **bhasha-shield, «0 % con umbral inglés»:** el umbral era 0,9944 (ajustado a 5 % de FPR) y con él tampoco detecta nada en inglés. Al umbral 0,5: inglés 30 % (45/150), hindi 7 % (11/150). Corregido en A19, TL;DR y afirmación 4.
- **Aziz et al. (B15):** calibra una compuerta sobre activaciones internas de un LLM, no un detector externo; el español se comporta como el inglés; y no «repara» (43,9 → 67,2 %, contra 87,9 % de referencia). Retirado como respaldo.
- **Detectores bajo ataque adaptativo (90 / 94 / 71 %):** son con Gemini 2.5 Pro de base; con GPT-5 Mini, 81 / 75 / 49 %. «PromptGuard» ahí es Prompt Guard 2 86M.
- **«Recortan la utilidad de ¼ a ½»:** vale para PIGuard y ProtectAI, no para Prompt Guard 2.
- **«NotInject no tiene español»:** tiene una frase de 339.
- **«APR @ 3 % utility reduction»:** la ficha no define APR ni el procedimiento; nuestra lectura es una inferencia.
- **DeepSeek:** el 99 % es sobre 100 escenarios sintéticos de DeepMind (no AgentDojo), cae igual con 150 consultas, y el éxito es cualquier llamada ajena a la tarea, no una acción dañina.

**Intento de refutar la afirmación 5.** No apareció ninguna evaluación de Prompt Guard 2, ProtectAI o PIGuard sobre español nativo con n grande, ni nada de español peruano. Sí aparecieron cuatro cosas que obligaron a acotarla: falsos positivos de Horizon-Labs sobre 800 prompts humanos en español (0,25–1,25 %, mejor que su inglés); ProtectAI sobre español traducido (B27); una anécdota de 10 benignos en la ficha de Wolf Defender (7–8 marcados, igual que en benignos generales); y PINT, con español sin desglose.

**Cambios al experimento que salieron de aquí:** línea base medida antes de registrar (paso 0), hipótesis de falsos positivos como coprimaria, brazo de retraducción, benignos externos, etiqueta por canal, tope de longitud y la recalibración bajada a exploratoria.
