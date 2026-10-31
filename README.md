# realtime-voice-playground

[Live demo](https://vpalmisano.github.io/realtime-voice-playground/)

An interactive webapp for trying voice AI — either **end-to-end realtime** models (OpenAI, Google, ElevenLabs) or a **custom STT → LLM → TTS pipeline** with different providers.
Configure options, chat by text or mic, and optionally run scripted Q&A with [webrtcperf-js](https://github.com/vpalmisano/webrtcperf-js).

![Demo](docs/demo.png)

## Features

- **Modes**:
  - **OpenAI / Google / ElevenLabs Realtime** — single-provider voice-to-voice sessions
  - **Custom** — compose a pipeline from separate STT, LLM, and TTS providers
- **Custom pipeline providers**:
  - **STT**: ElevenLabs, Google, OpenAI
  - **LLM**: Google, OpenAI
  - **TTS**: Cartesia, ElevenLabs, Google, OpenAI, Speechify
- **Transports**: WebSocket or WebRTC (OpenAI Realtime); WebSocket (Google, ElevenLabs)
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

| Provider   | Where to get a key                                                                                         | Notes                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| OpenAI     | [platform.openai.com/api-keys](https://platform.openai.com/api-keys)                                       | Realtime, STT, LLM, and/or TTS             |
| Google     | [aistudio.google.com/apikey](https://aistudio.google.com/apikey)                                           | Gemini Live, STT, LLM, and/or TTS          |
| ElevenLabs | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys)                         | Realtime needs `convai_write`; also STT/TTS |
| Cartesia   | [cartesia.ai](https://cartesia.ai)                                                                         | TTS (Custom pipeline)                      |
| Speechify  | [console.sws.speechify.com](https://console.sws.speechify.com)                                             | TTS (Custom pipeline)                      |

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`), choose a **Provider** mode, paste the matching API key(s), set options, and click **Connect**.

## Usage

### Shared

| Control                  | What it does                                                   |
| ------------------------ | -------------------------------------------------------------- |
| **Provider**             | `Custom`, `ElevenLabs Realtime`, `Google Realtime`, or `OpenAI Realtime` |
| **Use fake audio input** | Override mic with scripted clips; shows audio-input buttons    |
| **Save output audio**    | Write assistant PCM to WAV downloads                           |
| **Q&A estimator**        | Min talking/silent duration and detector (`simple` / `silero`) |

With fake audio enabled and connected, click a prompt under **Audio inputs** to inject that clip as the microphone stream. Turn timing is logged in the messages panel.

### Custom (STT → LLM → TTS)

Pick a provider for each stage in the stepper. Audio is transcribed by STT, text goes to the LLM, and the LLM reply is spoken by TTS.

| Stage | Providers                                      | Typical defaults                          |
| ----- | ---------------------------------------------- | ----------------------------------------- |
| STT   | ElevenLabs, Google, OpenAI                     | e.g. `scribe_v2_realtime`, `gpt-4o-transcribe` |
| LLM   | Google, OpenAI                                 | e.g. `gpt-5.4`, `gemini-3.8-flash`        |
| TTS   | Cartesia, ElevenLabs, Google, OpenAI, Speechify | e.g. `eleven_flash_v2_5`, `sonic-latest` |

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
- [`@google/genai`](https://github.com/googleapis/js-genai) Gemini Live, STT, LLM, TTS
- [`@elevenlabs/elevenlabs-js`](https://github.com/elevenlabs/elevenlabs-js) / [`@elevenlabs/client`](https://github.com/elevenlabs/elevenlabs-js) ElevenLabs Realtime, STT, TTS
- [`@cartesia/cartesia-js`](https://github.com/cartesia-ai/cartesia-js) Cartesia TTS
- [`@speechify/api`](https://docs.sws.speechify.com) Speechify TTS
- [`@vpalmisano/webrtcperf-js`](https://github.com/vpalmisano/webrtcperf-js) for fake media, Q&A turns, and plots
