#!/usr/bin/env bash
# Container entrypoint for the gateway image: the gateway, plus the Dynamo bridge (backend/gcore_bridge.py) when
# GCORE_BASE_URL or the per-model GCORE_*_BASE_URL variables are set. With the bridge, the gateway's model endpoints
# default to it (loopback inside the container) and the model identifiers / labels default to the Gcore stack's;
# without it the image behaves as before (ORANGE_GEMMA_URL / ORANGE_STT_URL / ORANGE_TTS_URL point at the services).
# If either process exits the container exits, so the restart policy brings both back together.
set -euo pipefail

pids=()
stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; }
trap stop TERM INT

if [[ -n "${GCORE_BASE_URL:-}${GCORE_LLM_BASE_URL:-}${GCORE_ASR_BASE_URL:-}${GCORE_TTS_BASE_URL:-}" ]]; then
  bridge="http://127.0.0.1:${GCORE_BRIDGE_PORT:-8101}"
  : "${GCORE_LLM_MODEL:=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8}"
  export GCORE_LLM_MODEL
  export ORANGE_GEMMA_URL="${ORANGE_GEMMA_URL:-$bridge/v1/chat/completions}"
  export ORANGE_STT_URL="${ORANGE_STT_URL:-$bridge/stt}"
  export ORANGE_TTS_URL="${ORANGE_TTS_URL:-$bridge/tts}"
  export ORANGE_LLM_MODEL="${ORANGE_LLM_MODEL:-$GCORE_LLM_MODEL}"
  export ORANGE_LLM_LABEL="${ORANGE_LLM_LABEL:-Nemotron 3 Nano}"
  export ORANGE_TTS_MODEL="${ORANGE_TTS_MODEL:-nvidia/magpie-tts-multilingual}"
  export ORANGE_TTS_LABEL="${ORANGE_TTS_LABEL:-Magpie}"
  export ORANGE_STT_MODELS="${ORANGE_STT_MODELS:-${GCORE_ASR_MODEL:-nemotron-asr-streaming}}"
  python3 -u backend/gcore_bridge.py &
  pids+=($!)
fi

python3 -u backend/server.py &
pids+=($!)

# The first process to exit decides the container's exit code; the other one is stopped with it.
set +e
wait -n "${pids[@]}"
status=$?
stop
wait
exit "$status"
