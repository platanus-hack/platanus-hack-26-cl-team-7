#!/usr/bin/env bash
# Red de los sandboxes (se ejecuta como root dentro de la VM, una vez por arranque).
# "La red miente": todo el TCP saliente de los contenedores termina en el host (172.30.0.1),
# donde hostd decide qué responder. No hay ningún egress real desde los sandboxes.
set -euo pipefail
NET=espejismo_net
BR=br-espejismo
GW=172.30.0.1

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create --driver bridge --subnet 172.30.0.0/24 --gateway "$GW" \
    -o com.docker.network.bridge.name="$BR" "$NET"
fi

# Idempotente: borra las reglas propias antes de volver a ponerlas.
iptables -t nat -D PREROUTING -i "$BR" -p tcp ! -d "$GW" -j DNAT --to-destination "$GW" 2>/dev/null || true
iptables -D DOCKER-USER -i "$BR" -j DROP 2>/dev/null || true
iptables -D INPUT -i "$BR" -j ESPEJISMO_IN 2>/dev/null || true
iptables -F ESPEJISMO_IN 2>/dev/null || true
iptables -X ESPEJISMO_IN 2>/dev/null || true

# 1) Todo TCP hacia fuera se reescribe al host, conservando el puerto.
iptables -t nat -I PREROUTING 1 -i "$BR" -p tcp ! -d "$GW" -j DNAT --to-destination "$GW"
# 2) Nada sale reenviado a internet (UDP, ICMP, lo que sea): solo existe el host.
iptables -I DOCKER-USER 1 -i "$BR" -j DROP
# 3) Hacia el host solo se permiten DNS y el sumidero; la API de control y SSH quedan fuera de alcance.
iptables -N ESPEJISMO_IN
iptables -A ESPEJISMO_IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A ESPEJISMO_IN -p udp --dport 53 -j ACCEPT
iptables -A ESPEJISMO_IN -p tcp -m multiport --dports 53,80,443 -j ACCEPT
iptables -A ESPEJISMO_IN -p tcp -j REJECT --reject-with tcp-reset
iptables -A ESPEJISMO_IN -j DROP
iptables -I INPUT 1 -i "$BR" -j ESPEJISMO_IN

echo "red $NET lista (gateway $GW, bridge $BR)"
