#!/usr/bin/env bash
# Run the F5 AI Guardrails tee proxy (and its demo webhook dashboard) in front of the local LLM endpoint.
# Usage:  bash guardrail_proxy.sh [start|stop|status|logs|stats]
#
# Inputs, created once by hand (never committed, never printed):
#   $ORANGE_HOME/.acr-password   registry pull password (chmod 600), provided by F5
#   $ORANGE_HOME/tee-proxy.env   from tee-proxy.env.example: registry, image, pull user, F5 token and project
#
# Both containers share the host network: the proxy reaches the LLM on 127.0.0.1:8000, the gateway reaches the
# proxy on 127.0.0.1:${LISTEN_PORT}, the proxy posts events to the dashboard on 127.0.0.1:9090.
set -euo pipefail
BASE=${ORANGE_HOME:-$(cd "$(dirname "$0")" && pwd)}
ENV_FILE=$BASE/tee-proxy.env
getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' ' ; }
IMAGE=${ACR_IMAGE:-$(getenv ACR_IMAGE)}
REGISTRY=${ACR_REGISTRY:-$(getenv ACR_REGISTRY)}
PULL_USER=${ACR_USER:-$(getenv ACR_USER)}
TEE_PORT=${TEE_PORT:-$(getenv LISTEN_PORT)}; TEE_PORT=${TEE_PORT:-8080}
action=${1:-start}

case "$action" in
  start)
    test -s "$ENV_FILE" || { echo "Missing $ENV_FILE (copy tee-proxy.env.example and fill it in)" >&2; exit 1; }
    { test -n "$IMAGE" && test -n "$REGISTRY" && test -n "$PULL_USER"; } || { echo "ACR_IMAGE, ACR_REGISTRY and ACR_USER must be set in $ENV_FILE (values provided by F5)" >&2; exit 1; }
    test -s "$BASE/.acr-password" || { echo "Missing $BASE/.acr-password (registry pull password)" >&2; exit 1; }
    grep -Eq '^UPSTREAM_URL=http://(127\.0\.0\.1|localhost):[0-9]+/?$' "$ENV_FILE" || { echo "UPSTREAM_URL must point at the local LLM endpoint in $ENV_FILE" >&2; exit 1; }
    if ! grep -Eq '^F5_AIS_TOKEN=.+' "$ENV_FILE" && ! grep -Eq '^F5_AIS_MOCK=true' "$ENV_FILE"; then
      echo "F5_AIS_TOKEN is empty: scans would fail. Fill it, or set F5_AIS_MOCK=true for a chain test." >&2; exit 1; fi
    docker login -u "$PULL_USER" --password-stdin "$REGISTRY" < "$BASE/.acr-password"
    docker pull "$IMAGE"
    docker rm -f llm-tee-proxy llm-tee-dashboard >/dev/null 2>&1 || true
    docker run -d --name llm-tee-dashboard --restart unless-stopped --network host -e RECEIVER_PORT=9090 "$IMAGE" python -m webhook_receiver
    docker run -d --name llm-tee-proxy --restart unless-stopped --network host --env-file "$ENV_FILE" "$IMAGE"
    for attempt in {1..30}; do
      if curl -s --max-time 2 "http://127.0.0.1:$TEE_PORT/tee/healthz" | grep -q '"ok"'; then
        curl -s --max-time 5 "http://127.0.0.1:$TEE_PORT/tee/readyz"; echo
        echo "Tee proxy up on 127.0.0.1:$TEE_PORT (dashboard on 127.0.0.1:9090). In the gateway's .env set:"
        echo "  ORANGE_LLM_URL=http://127.0.0.1:$TEE_PORT/v1/chat/completions"
        echo "then restart the gateway (server.py)."
        exit 0
      fi
      sleep 1
    done
    echo "Proxy did not answer on 127.0.0.1:$TEE_PORT/tee/healthz; check: docker logs llm-tee-proxy" >&2; exit 1 ;;
  stop)   docker rm -f llm-tee-proxy llm-tee-dashboard ;;
  status) docker ps --filter "name=llm-tee" --format '{{.Names}} {{.Status}} {{.Image}}'
          curl -s --max-time 5 "http://127.0.0.1:$TEE_PORT/tee/healthz"; echo; curl -s --max-time 5 "http://127.0.0.1:$TEE_PORT/tee/readyz"; echo ;;
  stats)  curl -s --max-time 5 "http://127.0.0.1:$TEE_PORT/tee/stats" ;;
  logs)   docker logs --tail 100 llm-tee-proxy ;;
  *) echo "usage: $0 [start|stop|status|logs|stats]" >&2; exit 2 ;;
esac
