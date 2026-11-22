# Cicatrices del pivoteo

Lo que está en esta carpeta **no es el producto**: es el camino que nos llevó a [Reaper](../README.md). Pivoteamos tres veces en 36 horas y preferimos dejarlo a la vista antes que borrarlo. Nada de aquí hace falta para correr Reaper.

| Cuándo | Qué probamos | Qué aprendimos | Dónde quedó |
|---|---|---|---|
| Sáb. 21/11, mañana | Evaluar un detector de inyecciones en español | El detector que AgentDojo trae como defensa marca como ataque la mitad de los mensajes legítimos en español: filtrar texto no alcanza | [`agentdojo/`](agentdojo/README.md), [`langs_bias/`](langs_bias/) |
| Sáb. 21/11, tarde | **Espejismo**: una casa de utilería con un vigilante señuelo para ver qué hace un agente cuando cree que nadie mira (95 corridas, 8 modelos) | Lo que el agente cuenta ayuda, pero no alcanza: hay que mirar lo que hace | [`espejismo/`](espejismo/README.md) |
| Sáb. 21/11, noche | **Último Paso**: un proxy que le niega al atacante la prueba de que su ataque funcionó | Sin esa prueba, el agente no declara éxito. Es la idea que hoy vive dentro de Reaper | [`ultimo-paso/`](ultimo-paso/README.md), [`bench-cloudflare/`](bench-cloudflare/) |
| Sáb. 21/11 | Primer panel de demostración | Sirvió de base para el panel actual | [`demo-david/`](demo-david/README.md) |

**Los nombres también son cicatriz.** El producto se llamó Sentinel, después Centinela, por unas horas Gríngola, y finalmente **Reaper**. En el código sigue llamándose `sentinel` (paquetes `@sentinel/*`, carpeta `apps/sentinel`): renombrarlo a horas del cierre era riesgo sin beneficio.
