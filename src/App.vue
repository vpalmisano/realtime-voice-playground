<script setup lang="ts">
import { ref } from 'vue';
import { OpenAISession } from './lib/openai.ts';
import OpenaiSettings, { getSessionOptions as getOpenaiSessionOptions } from './OpenaiSettings.vue';
import GoogleSettings, { getSessionOptions as getGoogleSessionOptions } from './GoogleSettings.vue';
import ElevenLabsSettings, {
  getSessionOptions as getElevenLabsSessionOptions,
} from './ElevenLabsSettings.vue';
import MessagesLog, { appendMessage, setStartTime, startTime } from './MessagesLog.vue';
import PerfSettings, {
  applyPerfConnectSettings,
  maybeDownloadResponseAudio,
  maybeSaveResponseAudio,
  startEstimateQuestionAnswerDelay,
  startWebrtcperfPlots,
  stopEstimateQuestionAnswerDelay,
  stopWebrtcperfPlots,
} from './PerfSettings.vue';
import { defineReference } from './lib/utils.ts';
import { GoogleAISession } from './lib/google.ts';
import { ElevenLabsSession } from './lib/elevenlabs.ts';
import LiveWaveform from './LiveWaveform.vue';

const PROVIDERS = ['OpenAI', 'Google', 'ElevenLabs'] as const;

const plotsEl = ref<HTMLElement | null>(null);
const textInput = ref('');
const connected = ref(false);
const connecting = ref(false);
const inputStream = ref<MediaStream | null>(null);
const outputStream = ref<MediaStream | null>(null);
const provider = defineReference('provider', 'OpenAI', PROVIDERS);

let session: OpenAISession | GoogleAISession | ElevenLabsSession | null = null;

async function onConnect() {
  if (connecting.value || connected.value) return;

  connecting.value = true;

  try {
    setStartTime(performance.now());
    applyPerfConnectSettings();

    if (provider.value === 'OpenAI') {
      session = new OpenAISession(getOpenaiSessionOptions());
    } else if (provider.value === 'Google') {
      session = new GoogleAISession(getGoogleSessionOptions());
    } else if (provider.value === 'ElevenLabs') {
      session = new ElevenLabsSession(getElevenLabsSessionOptions());
    }

    if (!session) {
      throw new Error('Failed to create session');
    }
    session.on('close', onDisconnect);
    await session.start();

    if (!session.sourceAudioTrack || !session.outputAudioTrack) {
      throw new Error('Failed to get audio tracks');
    }

    inputStream.value = new MediaStream([session.sourceAudioTrack]);
    outputStream.value = new MediaStream([session.outputAudioTrack]);

    await maybeSaveResponseAudio(session.outputAudioTrack);
    await startEstimateQuestionAnswerDelay(session.sourceAudioTrack, session.outputAudioTrack);

    await appendMessage(`Connected in ${Math.round(performance.now() - startTime)}ms\n`);
    connected.value = true;

    startWebrtcperfPlots(plotsEl.value);
  } catch (error) {
    onDisconnect(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    connecting.value = false;
  }
}

function onDisconnect(reason?: string) {
  if (!session) return;
  session.removeAllListeners();
  const { promptTokenCount, responseTokenCount } = session;
  appendMessage(
    `Disconnected${reason ? ` (${reason})` : ''}, tokens usage: ${promptTokenCount} input, ${responseTokenCount} output\n`,
  );
  maybeDownloadResponseAudio(session.outputAudioTrack);
  stopEstimateQuestionAnswerDelay();
  session.stop();
  session = null;
  inputStream.value = null;
  outputStream.value = null;
  connected.value = false;
  setStartTime(0);
  stopWebrtcperfPlots();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => onDisconnect());
}
window.addEventListener('beforeunload', () => onDisconnect('Page unloaded'));

function onSendText() {
  const text = textInput.value.trim();
  if (!session || !text) return;
  appendMessage(`Sending: "${text}"\n`);
  session.sendMessage(text);
  textInput.value = '';
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="py-6" fluid>
        <div class="d-flex align-center justify-space-between mb-4">
          <h2 class="text-h5">Realtime Voice Playground</h2>
          <v-btn
            icon="mdi-github"
            variant="text"
            href="https://github.com/vpalmisano/realtime-voice-playground"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          />
        </div>

        <v-row>
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="provider"
              :items="[...PROVIDERS]"
              label="Provider"
              variant="outlined"
              density="comfortable"
              hide-details
              :disabled="connected"
            />
          </v-col>
          <v-col cols="12" md="6" lg="4">
            <v-btn color="primary" :loading="connecting" v-if="!connected" @click="onConnect">
              Connect
            </v-btn>
            <v-btn color="error" variant="tonal" v-if="connected" @click="() => onDisconnect()">
              Disconnect
            </v-btn>
          </v-col>
        </v-row>

        <div class="d-flex flex-wrap ga-2 my-4" v-if="!connected">
          <OpenaiSettings v-if="provider === 'OpenAI'" />
          <GoogleSettings v-if="provider === 'Google'" />
          <ElevenLabsSettings v-if="provider === 'ElevenLabs'" />
        </div>

        <div class="d-flex flex-wrap ga-2 my-4">
          <PerfSettings :connected="connected" />
        </div>

        <MessagesLog />

        <div v-if="connected && inputStream && outputStream" class="mb-4">
          <LiveWaveform
            :input-media="inputStream"
            :output-media="outputStream"
            input-color="#1976D2"
            output-color="#388E3C"
            :window-seconds="60"
            :height="160"
          />
        </div>

        <div class="d-flex flex-wrap align-center ga-2 mb-4">
          <v-text-field
            v-model="textInput"
            label="Type a message..."
            variant="outlined"
            density="comfortable"
            hide-details
            class="flex-grow-1"
            :disabled="!connected"
            @keyup.enter="onSendText"
          />
          <v-btn color="primary" :disabled="!connected" @click="onSendText"> Send text </v-btn>
        </div>

        <div ref="plotsEl" class="d-flex flex-wrap ga-2 mb-4" id="webrtcperf-plots"></div>
      </v-container>
    </v-main>
  </v-app>
</template>
