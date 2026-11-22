# Reaper

<<<<<<< HEAD
**Si a un agente de IA que te ataca le niegas la prueba de que su ataque funcionó, se queda sin rumbo.** Reaper se pone delante de tus servidores: detecta al agente que anda sondeando, lo desvía a una copia falsa, le niega la confirmación y le muestra a tu equipo qué buscaba y qué arreglar.
=======
Desde la raíz, ejecuta `pnpm start` para abrir [Sentinel](http://127.0.0.1:8787) y
`pnpm services` en otra terminal para abrir los [cuatro servicios](http://127.0.0.1:9120).
El panel de Reaper tiene una página por sitio protegido, con su caso CVE, el resultado con y sin Reaper,
el replay del ataque, todo el tráfico en HTTP crudo lado a lado y el arreglo propuesto. Funciona sin VM
ni claves con la grabación incluida; **Modo demo** (o `?demo=1`) la recorre con ←/→. El laboratorio
activo está en [`apps/sentinel/lab`](apps/sentinel/lab/).
Consulta [la guía local](agent-detection/README.md#sentinel-evidence-demo) para los requisitos de ejecución.
>>>>>>> 3857d18 (Reaper panel: one page per site, CVE cases only, raw traffic, guided demo)

Proyecto de team-7 para Platanus Hack 26 Santiago, track AI Security. La descripción completa, con cifras, fuentes y límites, está en [`project-description.md`](project-description.md). Web: https://reaper.haroldmedrano33.workers.dev

## Correrlo

```bash
pnpm install
pnpm start      # el panel, en http://127.0.0.1:8787
pnpm services   # en otra terminal: los cuatro servicios de prueba, en http://127.0.0.1:9120
```

En **Experimentos** se inician corridas A/B (directo al servicio contra a través de Reaper), se revisan los resultados por proyecto y se reproduce una grabación. Requisitos de ejecución: [guía local](agent-detection/README.md#sentinel-evidence-demo).

## Qué hay en el repo

| Carpeta | Qué es |
|---|---|
| [`apps/`](apps/), [`packages/`](packages/), [`tools/`](tools/) | **El producto.** El panel (`apps/web`), el servidor y el laboratorio con el proxy y los servicios de prueba (`apps/sentinel`), los contratos compartidos y el simulador de tráfico |
| [`agent-detection/`](agent-detection/) | **La detección.** El motor de reglas, la tienda de demostración con su copia falsa y la evaluación |
| [`evidencia-agentes/`](evidencia-agentes/RESULTADOS.md) | **Evidencia.** 3 modelos de IA atacando a través de Reaper: 30 de 30 marcados y desviados, 0 de 30 agentes legítimos marcados |
| [`ultimo-paso/`](ultimo-paso/) | **Evidencia.** Datos crudos de los benchmarks: sin defensa, Cloudflare por defecto y los brazos de control |
| [`landing/`](landing/), [`landing-video/`](landing-video/) | La web, el pitch y el video explicativo |
| [`reports/`](reports/), [`research_notes/`](research_notes/) | Estado del arte: defensa contra agentes en el proxy y antecedentes en WAF |
| [`related_experiments/`](related_experiments/README.md) | **Cicatrices del pivoteo.** Lo que probamos antes de llegar aquí; no hace falta para correr Reaper |

## Sobre los nombres

En el código el producto se llama `sentinel` (paquetes `@sentinel/*`, `apps/sentinel`). Es el nombre con el que nació; **Reaper** es el nombre final. La historia completa de los pivotes está en [`related_experiments/`](related_experiments/README.md).
