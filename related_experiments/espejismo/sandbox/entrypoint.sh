#!/bin/sh
# Arranque de la estación: inicia el agente de seguridad y deja el contenedor vivo.
/opt/sentinel/bin/sentinel-agent --config /etc/sentinel/policy.yaml >>/var/log/sentinel/agent.log 2>&1 &
exec sleep infinity
