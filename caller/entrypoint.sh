#!/usr/bin/env bash
# Container entrypoint for the caller-site image: the caller service, plus the Dynamo bridge (backend/gcore_bridge.py)
# when GCORE_BASE_URL or the per-model GCORE_*_BASE_URL variables are set — the site's LLM and TTS are then Dynamo
# frontends and the service's requests (Voxtral-style speech, OpenAI chat) are translated on loopback.
set -euo pipefail

pids=()
stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; }
trap stop TERM INT

if [[ -n "${GCORE_BASE_URL:-}${GCORE_LLM_BASE_URL:-}${GCORE_TTS_BASE_URL:-}" ]]; then
  bridge="http://127.0.0.1:${GCORE_BRIDGE_PORT:-8101}"
  export GCORE_ASR_BASE_URL="${GCORE_ASR_BASE_URL:-${GCORE_BASE_URL:-${GCORE_LLM_BASE_URL}}}"  # the bridge wants all three; a caller never transcribes
  export CALLER_LLM_MODEL="${CALLER_LLM_MODEL:-${GCORE_LLM_MODEL:-nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8}}"
  export GCORE_LLM_MODEL="${GCORE_LLM_MODEL:-$CALLER_LLM_MODEL}"
  export CALLER_LLM_URL="${CALLER_LLM_URL:-$bridge/v1/chat/completions}"
  export CALLER_TTS_URL="${CALLER_TTS_URL:-$bridge/tts}"
  export CALLER_TTS_MODEL="${CALLER_TTS_MODEL:-nvidia/magpie-tts-multilingual}"
  python3 -u backend/gcore_bridge.py &
  pids+=($!)
fi

python3 -u caller/service.py &
pids+=($!)

set +e
wait -n "${pids[@]}"
status=$?
stop
wait
exit "$status"
