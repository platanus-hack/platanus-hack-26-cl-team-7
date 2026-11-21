# Verificación del pipeline de detección

Ejecución real `pipeline-6cc4c600c3cf4869be28b791`. Sentinel inició los
servicios ficticios en Lima, envió las mismas entradas directamente y a través
de Envoy, y guardó las observaciones independientes junto con las decisiones
del proxy. Cada proyecto arrancó con estado limpio.

| Proyecto | Evidencia en A | Evidencia en B | Detección en B | Reglas instaladas | Acciones ejecutadas | Tráfico legítimo A / B |
|---|---:|---:|---:|---:|---:|---:|
| Bruma Print Works | 2/3 | 0/3 | 3/3 | 2/3 | 2/3 | 3/3 · 3/3 |
| Litoral Freight | 2/3 | 0/3 | 3/3 | 2/3 | 2/3 | 3/3 · 3/3 |
| Surco Rooms | 2/3 | 1/3 | 2/3 | 1/3 | 1/3 | 3/3 · 3/3 |
| Total | 6/9 | 1/9 | 8/9 | 5/9 | 5/9 | 9/9 · 9/9 |

Los cinco reintentos contenidos registraron la regla correspondiente y cero
solicitudes al upstream. El registro sin marcador de Surco llegó al cliente
en ambos brazos. Las nueve fixtures coincidieron con sus resultados esperados.
La detección del proxy en A es no aplicable.

OpenRouter devolvió referencias de catálogo e indicó cuál fixture fija
priorizar. Anthropic produjo el análisis de los tres proyectos. Firecrawl
quedó en estado parcial porque el entorno carecía de `FIRECRAWL_API_KEY`.
Los borradores de GitHub incluyen las referencias y correcciones curadas
con su procedencia visible. Las fixtures simulan resultados y emplean
indicadores inertes.

La reproducción `pipeline-cffdd7fb18684e3f802cb763` conservó las entradas,
los resultados por proyecto, los tiempos de las etapas y los borradores
de la ejecución original. La prueba automatizada confirma cero llamadas
al runner, OpenRouter, Firecrawl y Anthropic durante la reproducción.

Durante la validación pasaron `pnpm test` (95 pruebas),
`pnpm typecheck`, `pnpm lint`, `pnpm build`, `go vet ./...`,
`go test -count=1 ./...` y `python3 -m unittest scoreboard.test_pipeline_eval`.
Los archivos locales de la ejecución y el borrador de Litoral se guardaron
en `scoreboard/runs/pipeline-checks/`.

[Instrucciones para ejecutar y reproducir](../../README.md#pipeline-de-eficacia-de-detección)
