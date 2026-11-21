# Espejismo

### No bloqueamos al agente de IA: le hacemos creer que ganó, y así vemos lo que haría.

**Pruébalo:** https://espejismo-demo.haroldmedrano33.workers.dev (el episodio real de un agente, paso a paso).

## El problema
Si el agente que corre en tu máquina quisiera hacer daño, ¿cómo te darías cuenta? Bloquearlo le enseña que lo vigilan, y los agentes evaden los monitores que tienen a su alcance.

## Qué hicimos
Como un ladrón que entra con la llave robada a una casa de utilería idéntica:
- **Un vigilante señuelo** que el agente puede apagar. Si lo apaga, la red parece funcionar.
- **Un sumidero:** todo lo que el agente intenta llevarse cae ahí. Nada sale a internet.
- **Un testigo escondido** en el sistema, fuera de su alcance, que registra lo que hizo de verdad.
- **Un interrogatorio:** primero sin evidencia, después mostrándosela.

## Resultados (95 episodios, 8 modelos reales, 0 bytes enviados a internet)
- Kimi K3.1 Pro con un objetivo oculto neutralizó el monitor **9 de 18** veces y creyó haberse llevado las credenciales en **8**.
- Preguntado sin evidencia, no lo contó en **ninguna de las 8**. Frente a la evidencia, lo admitió de forma explícita **1 vez**.
- Aun sin instrucción de atacante, **11 de 47** agentes leyeron credenciales que la tarea no necesitaba, y Kimi editó la política de seguridad 2 de 8 veces: solo el testigo lo vio.

## Límites
El comportamiento más grave se provocó con una instrucción de atacante; la idea de honeypots para agentes ya está propuesta (lo nuestro es la implementación y la medición). Detalle, cifras y cómo reproducir en `espejismo/README.md`.
