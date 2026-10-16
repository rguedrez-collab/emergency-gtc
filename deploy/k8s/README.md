# Kubernetes deployment (Envoy Gateway, NVIDIA Dynamo frontends)

`base/` deploys the console (gateway + Dynamo bridge, SQLite on a persistent volume), two caller sites and an
HTTPRoute. It is generic on purpose: the cluster-specific overlay (namespace, image registry, hostnames, the Dynamo
frontend Services of each site) lives with your operations notes, not in this repository.

```
overlay/kustomization.yaml
  namespace: <project namespace>
  resources: [../path/to/deploy/k8s/base]
  images: emergency-gtc-gateway / emergency-gtc-caller -> your registry and tag
  patches: HTTPRoute hostnames + parentRef, GCORE_*_BASE_URL of the console and of each caller site
```

What the overlay must provide:

| Item | Where | Notes |
| --- | --- | --- |
| `urgences-secrets` Secret | created out of band | keys `access-password` (user `demo`), `caller-token` (shared with the caller sites) |
| Images | `images:` | push `docker build --target gateway` and `--target caller` to a registry the cluster pulls from |
| Dynamo frontends | env `GCORE_LLM_BASE_URL`, `GCORE_ASR_BASE_URL`, `GCORE_TTS_BASE_URL` | one origin per model, or `GCORE_BASE_URL` when one gateway serves the three |
| Hostnames | HTTPRoute `hostnames` + `parentRefs` | a listener whose certificate covers them |

Then:

```bash
kubectl create secret generic urgences-secrets -n <ns> --from-literal=access-password='…' --from-literal=caller-token='…'
kubectl apply -k overlay/
kubectl -n <ns> rollout status deploy/urgences-console
curl -u demo:… https://<hostname>/api/health        # services ready, callers listed with their round trip
```

The bridge (`backend/gcore_bridge.py`, started by the images' entrypoints when a `GCORE_*` variable is set) maps the
gateway's STT route to the frontends' realtime WebSocket ASR (24 kHz PCM, ffmpeg decodes browser and phone
recordings), the Voxtral-style speech request to the Magpie TTS (preset voices → `GCORE_TTS_VOICES`, raw PCM → WAV)
and passes chat completions through. Model names and labels default to the Gcore stack's (Nemotron 3 Nano, Magpie,
`nemotron-asr-streaming`); override them with the usual `ORANGE_*` / `CALLER_*` variables.

Pods run as a non-root arbitrary user (OpenShift restricted SCC): the state volume gets its group from the pod's
fsGroup, nothing else is written. `/healthz` on both images is unauthenticated and does not touch the models; it is
the probes' endpoint only.
