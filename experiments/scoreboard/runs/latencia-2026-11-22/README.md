# Latencia que agrega Reaper (22/11/2026, 07:05 Santiago)

Cuánto tarda una petición directa al servicio y cuánto la misma petición pasando por Reaper.

| Respuesta | Directo (p50 / p95 / p99) | Por Reaper (p50 / p95 / p99) | Reaper agrega (p50 / p95 / p99) |
|---|---|---|---|
| JSON de 164 bytes | 0,24 / 0,27 / 0,33 ms | 0,45 / 0,53 / 0,72 ms | **0,21 / 0,26 / 0,39 ms** |
| HTML de 2 KB | 0,25 / 0,27 / 0,29 ms | 0,52 / 0,59 / 0,77 ms | **0,27 / 0,32 / 0,48 ms** |
| CSS de 5 KB | 0,29 / 0,37 / 0,40 ms | 0,84 / 1,03 / 1,17 ms | **0,55 / 0,66 / 0,77 ms** |
| JSON, 20 peticiones en paralelo | 3,00 / 3,42 ms (p50 / p95) | 5,39 / 6,20 ms | 2,39 / 2,78 ms |

2.000 peticiones por fila y por brazo, alternando directo y Reaper para cancelar la deriva, tras 50 de calentamiento.

## Cómo se midió
- Motor: `apps/sentinel/lab/cmd/engine` compilado con Go 1.27.3, en modo `revproxy`, delante de `targets.businesses.service`.
- Todo en una sola laptop (Apple Silicon), por loopback. Guion: `medir.py`. Datos: `resultado.json`.

## Límites
- Es el modo **proxy en Go** del motor, no el camino Envoy + `ext_proc` que usa el laboratorio de experimentos; ese agrega un salto gRPC y guarda la respuesta completa, y **no lo medimos**.
- Loopback: no incluye red. En producción el costo relativo es menor, porque la red domina.
- Respuestas chicas (hasta 5 KB). El costo crece con el tamaño de la respuesta inspeccionada: de 0,2 a 0,55 ms entre 164 bytes y 5 KB. No medimos respuestas grandes.
- Un servicio de prueba en Python de un solo proceso: la fila en paralelo mide sobre todo la cola de ese servicio.
- En el camino de la petición no hay ningún modelo de IA: son reglas fijas.
