# Realtime Voice Playground

[Live demo](https://vpalmisano.github.io/realtime-voice-playground/) · [Hugging Face Space](https://huggingface.co/spaces/vpalmisano/realtime-voice-playground)

An interactive webapp for trying voice AI — either **end-to-end realtime** models (OpenAI, Google, ElevenLabs, Inworld, Phonic) or a **custom STT → LLM → TTS pipeline** with different providers.
Configure options, chat by text or mic, and optionally run scripted Q&A with [webrtcperf-js](https://github.com/vpalmisano/webrtcperf-js).

![Demo](public/docs/demo.png)

## Features

- **Modes**:
  - **OpenAI / Google / ElevenLabs / Inworld / Phonic Realtime** — single-provider voice-to-voice sessions
  - **Custom** — compose a pipeline from separate STT, LLM, and TTS providers
- **Custom pipeline providers**:
  - **STT**: AssemblyAI, Cohere (local), ElevenLabs, Google, Gradium, Mistral (local), Nvidia (local), OpenAI
  - **LLM**: Anthropic, Google, Nvidia (local), OpenAI
  - **TTS**: AssemblyAI, Cartesia, ElevenLabs, Google, Gradium, Gradium Phonon (local), OpenAI, Speechify
- **Transports**: WebSocket or WebRTC (OpenAI / Inworld Realtime); WebSocket (Google, ElevenLabs, Gradium, Phonic)
- **Session options**: model, voice, transcription, turn detection, and system instructions
- **Chat**: send text messages or speak via the microphone
- **Live waveform**: input/output audio visualization while connected
- **Fake audio input**: play audio file prompts from `public/audio/` and measure Q&A timing (start/end, latency, interruptions)
- **Save response audio**: download assistant replies as WAV
- **Tool demo**: sample `get_weather` function tool via `@openai/agents` (OpenAI Realtime)
- Settings persist in `localStorage`

## Requirements

- Node.js 24+
- API keys for the providers you use:

| Provider   | Where to get a key                                                                 | Notes                                         |
| ---------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| OpenAI     | [platform.openai.com/api-keys](https://platform.openai.com/api-keys)               | Realtime, STT, LLM, and/or TTS                |
| Anthropic  | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | LLM (Custom pipeline)                         |
| Google     | [aistudio.google.com/apikey](https://aistudio.google.com/apikey)                   | Gemini Live, STT, LLM, and/or TTS             |
| ElevenLabs | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) | Realtime needs `convai_write`; also STT/TTS   |
| Inworld    | [platform.inworld.ai](https://platform.inworld.ai)                                 | Realtime WebRTC/WebSocket; Basic (Base64) key |
| Phonic     | [phonic.ai](https://www.phonic.ai)                                                 | Realtime WebSocket STS; API key               |
| Gradium    | [gradium.ai](https://gradium.ai)                                                   | STT/TTS (Custom pipeline)                     |
| Cartesia   | [cartesia.ai](https://cartesia.ai)                                                 | TTS (Custom pipeline)                         |
| Speechify  | [console.sws.speechify.com](https://console.sws.speechify.com)                     | TTS (Custom pipeline)                         |
| AssemblyAI | [assemblyai.com/dashboard/home](https://www.assemblyai.com/dashboard/home)         | STT/TTS (Custom pipeline)                     |

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`), choose a **Provider** mode, paste the matching API key(s), set options, and click **Connect**.

## Usage

### Shared

| Control                  | What it does                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Provider**             | `Custom`, `ElevenLabs Realtime`, `Google Realtime`, `Inworld Realtime`, `OpenAI Realtime`, or `Phonic Realtime` |
| **Use fake audio input** | Override mic with scripted clips; shows audio-input buttons                                                     |
| **Save output audio**    | Write assistant PCM to WAV downloads                                                                            |
| **Q&A estimator**        | Min talking/silent duration and detector (`simple` / `silero`)                                                  |

With fake audio enabled and connected, click a prompt under **Audio inputs** to inject that clip as the microphone stream. Turn timing is logged in the messages panel.

### Custom (STT → LLM → TTS)

Pick a provider for each stage in the stepper. Audio is transcribed by STT, text goes to the LLM, and the LLM reply is spoken by TTS.

| Stage | Providers                                                                            | Typical defaults                              |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| STT   | AssemblyAI, Cohere, ElevenLabs, Google, Gradium, Mistral, Nvidia, OpenAI             | e.g. `universal-3-6-pro`, `gpt-4o-transcribe` |
| LLM   | Anthropic, Google, Nvidia, OpenAI                                                    | e.g. `claude-sonnet-5-5`, `gpt-5.4`           |
| TTS   | AssemblyAI, Cartesia, ElevenLabs, Google, Gradium, Gradium Phonon, OpenAI, Speechify | e.g. `assemblyai-tts-1`, `eleven_flash_v2_5`  |

Gradium STT/TTS use WebSocket via [`@gradium/sdk`](https://www.npmjs.com/package/@gradium/sdk). Because Gradium’s token endpoint does not return CORS headers on the preflight, install and enable the [Access-Control-Allow-Origin](https://mybrowseraddon.com/access-control-allow-origin.html) browser extension before connecting.

**Cohere Transcribe** runs on-device via [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) + WebGPU ([`onnx-community/cohere-transcribe-03-2026-ONNX`](https://huggingface.co/onnx-community/cohere-transcribe-03-2026-ONNX), no API key). Language must be selected (14 supported); VAD gates each turn before batch transcription.

**Gradium Phonon** runs on-device via [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) (WASM worker + [`gradium/phonon-31m-en`](https://huggingface.co/gradium/phonon-31m-en) GGUF, no API key). Weights and voices cache in the browser after the first download.

Each stage has its own API key and model/voice fields. Keys and options are stored separately per provider.

### OpenAI Realtime

| Control                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| **Transport**           | `websocket` or `webrtc`                                   |
| **Model**               | Realtime model id (default `gpt-realtime-2.1`)            |
| **Voice**               | Assistant voice (e.g. `alloy`, `marin`, …)                |
| **Transcription model** | Input audio transcription                                 |
| **Context**             | System instructions for the agent                         |
| **Turn detection**      | `semantic_vad` (eagerness) or `server_vad` (threshold, …) |

### Google Realtime

| Control     | What it does                                  |
| ----------- | --------------------------------------------- |
| **Model**   | Gemini Live model (default `gemini-3.8-live`) |
| **Voice**   | Prebuilt voice (default `Puck`)               |
| **Context** | System instructions                           |

### ElevenLabs Realtime

Uses the [OpenAI Realtime–compatible](https://elevenlabs.io/docs/eleven-agents/guides/openai-realtime-compatibility) WebSocket API (`wss://api.elevenlabs.io/v1/convai/realtime`). The app mints an ephemeral client secret from your API key, then connects with `@openai/agents`.

| Control            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| **Model**          | `eleven_realtime_v1_mini` (default) or `eleven_realtime_v1_max` |
| **Voice**          | Assistant voice (e.g. `brian`, `rachel`, …)                     |
| **Context**        | System instructions                                             |
| **Turn detection** | `semantic_vad` (eagerness) or `server_vad` (threshold, …)       |

The API key needs the **`convai_write`** permission (enable Conversational AI write access, or disable key restrictions) under [API Keys](https://elevenlabs.io/app/settings/api-keys).

### Inworld Realtime

Supports [WebRTC](https://docs.inworld.ai/realtime/quickstart-webrtc) and [WebSocket](https://docs.inworld.ai/realtime/quickstart-websocket). The app mints a session token from your Base64 API key. WebRTC exchanges SDP with `/v1/realtime/calls` and uses the `oai-events` data channel; WebSocket connects to `/api/v1/realtime/session` with the `bearer_<token>` subprotocol and streams base64 PCM16 @ 24 kHz.

| Control                 | What it does                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| **Transport**           | `webrtc` (default) or `websocket`                                        |
| **LLM model**           | e.g. `openai/gpt-4o-mini` (default), `google-ai-studio/gemini-2.5-flash` |
| **TTS model**           | `inworld-tts-2` (default) or `inworld-tts-2-flash`                       |
| **Voice**               | Assistant voice (e.g. `Clive`, `Dennis`, …)                              |
| **Transcription model** | `inworld/inworld-stt-1`                                                  |
| **Context**             | System instructions                                                      |
| **Turn detection**      | `semantic_vad` (eagerness) or `server_vad` (threshold, …)                |

Paste the **Basic (Base64)** credential from [Inworld Portal → API Keys](https://platform.inworld.ai).

### Phonic Realtime

Uses Phonic’s speech-to-speech WebSocket (`wss://api.phonic.ai/v1/sts/ws`). The app mints a short-lived session token from your API key (browsers cannot set `Authorization` on WebSockets), then streams PCM16 @ 16 kHz. Audio chunks are capped at 40 ms per Phonic’s API.

| Control         | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| **Model**       | `phonic-1` (default) or `phonic-0.5`                            |
| **Voice**       | Assistant voice id (e.g. `sabrina`, `grant`, …)                 |
| **Agent**       | Optional agent name; leave empty for agentless config overrides |
| **Project**     | Project name (default `main`)                                   |
| **Turn taking** | `eager` … `very_patient` (default `standard`)                   |
| **Context**     | System prompt                                                   |

Get an API key from [Phonic](https://www.phonic.ai).

## Scripts

| Command                           | Description                   |
| --------------------------------- | ----------------------------- |
| `npm run dev`                     | Dev server (`--host 0.0.0.0`) |
| `npm run build`                   | Typecheck + production build  |
| `npm run preview`                 | Preview the production build  |
| `npm run lint` / `lint:check`     | ESLint fix / check            |
| `npm run format` / `format:check` | Prettier write / check        |

## Stack

- Vue 3, Vite, TypeScript, Vuetify
- [`@openai/agents`](https://github.com/openai/openai-agents-js) Realtime (WebRTC / WebSocket; also used for ElevenLabs Realtime)
- [`openai`](https://github.com/openai/openai-node) for OpenAI STT / LLM / TTS
- [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) Anthropic LLM
- [`@google/genai`](https://github.com/googleapis/js-genai) Gemini Live, STT, LLM, TTS
- [`@elevenlabs/elevenlabs-js`](https://github.com/elevenlabs/elevenlabs-js) / [`@elevenlabs/client`](https://github.com/elevenlabs/elevenlabs-js) ElevenLabs Realtime, STT, TTS
- [`@cartesia/cartesia-js`](https://github.com/cartesia-ai/cartesia-js) Cartesia TTS
- [`@gradium/sdk`](https://www.npmjs.com/package/@gradium/sdk) Gradium STT / TTS
- [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) Cohere / Mistral / Nvidia on-device models
- [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) Gradium Phonon on-device TTS
- [`assemblyai`](https://www.npmjs.com/package/assemblyai) AssemblyAI STT/TTS
- [`@speechify/api`](https://docs.sws.speechify.com) Speechify TTS
- Phonic Realtime via WebSocket STS (`wss://api.phonic.ai/v1/sts/ws`)
- [`@vpalmisano/webrtcperf-js`](https://github.com/vpalmisano/webrtcperf-js) for fake media, Q&A turns, and plots

## Licenses

This project is [ISC](LICENSE). Most dependencies are MIT, Apache-2.0, or ISC.

**Gradium Phonon** (Custom TTS):

- Runtime [`phonon-tts`](https://www.npmjs.com/package/phonon-tts): MIT OR Apache-2.0
- Model [`gradium/phonon-31m-en`](https://huggingface.co/gradium/phonon-31m-en) and voices [`gradium/phonon-voices`](https://huggingface.co/gradium/phonon-voices): Apache 2.0 (commercial use allowed)
