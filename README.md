# realtime-voice-playground

[Live demo](https://vpalmisano.github.io/realtime-voice-playground/)

An interactive webapp for trying Voice-to-Voice AI realtime models from **OpenAI**, **Google**, and **ElevenLabs**.
Configure provider, model, and session options; chat by text or mic; optionally run scripted Q&A with [webrtcperf-js](https://github.com/vpalmisano/webrtcperf-js).

![Demo](docs/demo.png)

## Features

- **Providers**: OpenAI Realtime, Google Gemini Live, and ElevenLabs Realtime (OpenAI-compatible)
- **Transports**: WebSocket or WebRTC (OpenAI); WebSocket (Google, ElevenLabs)
- **Session options**: model, voice, transcription, turn detection, and system instructions
- **Chat**: send text messages or speak via the microphone
- **Live waveform**: input/output audio visualization while connected
- **Fake audio input**: play audio file prompts from `public/audio/` and measure Q&A timing (start/end, latency, interruptions)
- **Save response audio**: download assistant replies as WAV
- **Tool demo**: sample `get_weather` function tool via `@openai/agents` (OpenAI)
- Settings persist in `localStorage`

## Requirements

- Node.js 24+
- An [OpenAI API key](https://platform.openai.com/api-keys) with Realtime API access, and/or a [Google AI API key](https://aistudio.google.com/apikey) for Gemini Live, and/or an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) with Conversational AI write access (`convai_write`) for Realtime

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`), choose a **Provider**, paste the matching API key, set options, and click **Connect**.

## Usage

### Shared

| Control                  | What it does                                                   |
| ------------------------ | -------------------------------------------------------------- |
| **Provider**             | `OpenAI`, `Google`, or `ElevenLabs`                            |
| **Use fake audio input** | Override mic with scripted clips; shows audio-input buttons    |
| **Save output audio**    | Write assistant PCM to WAV downloads                           |
| **Q&A estimator**        | Min talking/silent duration and detector (`simple` / `silero`) |

With fake audio enabled and connected, click a prompt under **Audio inputs** to inject that clip as the microphone stream. Turn timing is logged in the messages panel.

### OpenAI

| Control                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| **Transport**           | `websocket` or `webrtc`                                   |
| **Model**               | Realtime model id (default `gpt-realtime-2.1`)            |
| **Voice**               | Assistant voice (e.g. `marin`, `alloy`, …)                |
| **Transcription model** | Input audio transcription                                 |
| **Context**             | System instructions for the agent                         |
| **Turn detection**      | `semantic_vad` (eagerness) or `server_vad` (threshold, …) |

### Google

| Control     | What it does                                  |
| ----------- | --------------------------------------------- |
| **Model**   | Gemini Live model (default `gemini-3.8-live`) |
| **Voice**   | Prebuilt voice (default `Puck`)               |
| **Context** | System instructions                           |

### ElevenLabs

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
- [`@openai/agents`](https://github.com/openai/openai-agents-js) Realtime (WebRTC / WebSocket; also used for ElevenLabs)
- [`@google/genai`](https://github.com/googleapis/js-genai) Gemini Live
- [`@elevenlabs/elevenlabs-js`](https://github.com/elevenlabs/elevenlabs-js) ElevenLabs Realtime
- [`@vpalmisano/webrtcperf-js`](https://github.com/vpalmisano/webrtcperf-js) for fake media, Q&A turns, and plots
