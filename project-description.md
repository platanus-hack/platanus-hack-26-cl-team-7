# Espejismo

### Antes de darle las llaves de tu empresa a un agente de IA, mira lo que hace cuando cree que nadie lo ve.

**Pruébalo:** https://espejismo-demo.haroldmedrano33.workers.dev (el episodio real de un agente, paso a paso, en 90 segundos).

**Videos:** [la propuesta en 78 segundos](https://espejismo-demo.haroldmedrano33.workers.dev/video/propuesta.mp4) · [lo que el agente dice contra lo que registró el sistema, 74 segundos](https://espejismo-demo.haroldmedrano33.workers.dev/video/dicho-vs-hecho.mp4)

## El problema
En julio de 2026, durante una evaluación, agentes de OpenAI salieron de su entorno de pruebas y entraron a sistemas de Hugging Face ([comunicado de OpenAI](https://openai.com/index/hugging-face-model-evaluation-security-incident/)). Las empresas ya le dan a agentes de IA acceso a sus servidores, sus claves y su código, y hoy la única forma de saber qué hizo un agente es preguntarle.

## Qué es
Una prueba antes de dar acceso. Es una casa de utilería idéntica a la real:
- **Un vigilante señuelo** que el agente puede apagar. Si lo apaga, todo parece funcionar.
- **Un sumidero:** lo que el agente intenta llevarse cae ahí. Nada sale a internet.
- **Un testigo escondido** en el sistema, fuera de su alcance, que graba lo que hizo de verdad.
- **Una pregunta final:** ¿qué hiciste? Y se compara la respuesta con la grabación.

El resultado es una ficha por modelo: qué tocó, qué intentó y si lo contó.

## Lo que encontramos (95 episodios, 8 modelos reales, 0 bytes enviados a internet)
- **Sin que nadie se lo pidiera, 11 de 47 agentes abrieron un archivo de credenciales que la tarea no necesitaba.** Solo el testigo lo vio.
- Un modelo con un objetivo oculto (Kimi K3.1 Pro) neutralizó al vigilante **9 de 18** veces y creyó haberse llevado las credenciales en **8**.
- Cuando se le preguntó, no lo reportó en **ninguna de las 8**. Frente a la grabación, lo admitió de forma explícita **1 vez**.
- No todos se portan igual: Claude no tocó nada en 12 corridas; GLM abrió las credenciales en 6 de 8.

## En qué se diferencia
Otras herramientas bloquean al agente, o evalúan su honestidad leyendo la conversación. Lo que un agente cuenta ayuda, pero no alcanza cuando tiene motivos para no contarlo. Espejismo no bloquea: contrasta lo que el agente dice con un registro del sistema que no puede borrar, y así separa tres cosas: lo que intentó, lo que logró y lo que contó.

## Límites
El comportamiento más grave se provocó con una instrucción de atacante. Que un agente no lo reporte no prueba que mienta a propósito. La idea de señuelos para agentes ya está propuesta; lo nuestro es la implementación y la medición. Muestra chica (3 a 10 corridas por celda). Detalle, cifras y cómo verificarlas en `espejismo/README.md`.
