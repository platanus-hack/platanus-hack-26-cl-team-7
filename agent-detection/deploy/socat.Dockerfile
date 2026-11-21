# socat bridges that carry the twin's callback fetches to the router's relay (see
# docker-compose.yml: twin-egress and relay-bridge). Build context is the repo root.
FROM alpine:3.20

RUN apk add --no-cache socat \
    && adduser -S -u 10001 bridge \
    && mkdir -p /run/twin && chown bridge /run/twin
USER bridge

ENTRYPOINT ["socat"]
