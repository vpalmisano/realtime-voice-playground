<script setup lang="ts">
import { computed, ref } from 'vue';
import { OpenAIRealtime } from './lib/providers/openai/realtime.ts';
import OpenaiSettings, {
  getOptions as getOpenaiOptions,
} from './providers/openai/OpenaiRealtime.vue';
import GoogleSettings, {
  getOptions as getGoogleOptions,
} from './providers/google/GoogleRealtime.vue';
import ElevenLabsSettings, {
  getOptions as getElevenLabsOptions,
} from './providers/elevenlabs/ElevenLabsRealtime.vue';
import PipelineSettings from './PipelineSettings.vue';
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
import { defineReference } from './utils.ts';
import { GoogleAIRealtime } from './lib/providers/google/realtime.ts';
import { ElevenLabsRealtime } from './lib/providers/elevenlabs/realtime.ts';
import { OpenAILLM } from './lib/providers/openai/llm.ts';
import LiveWaveform, { INPUT_COLOR, OUTPUT_COLOR } from './LiveWaveform.vue';
import { PipelineSession } from './lib/pipeline.ts';
import { getLlmProvider, getSttProvider, getTtsProvider } from './providers/index.ts';
import type { BaseProvider } from './lib/providers/base.ts';
import webrtcperf from './webrtcperf.ts';
import debug from 'debug';

const log = debug('realtime:app');

const PROVIDERS = ['Custom', 'ElevenLabs Realtime', 'Google Realtime', 'OpenAI Realtime'] as const;

const plotsEl = ref<HTMLElement | null>(null);
const waveformRef = ref<{
  addMarker: (x: number, color?: string, label?: string) => void;
} | null>(null);
const textInput = ref('');
const connected = ref(false);
const connecting = ref(false);
const clearStorageDialog = ref(false);
const inputStream = ref<MediaStream | null>(null);
const outputStream = ref<MediaStream | null>(null);
const provider = defineReference('provider', 'OpenAI Realtime', PROVIDERS);

const settingsComponent = computed(() => {
  switch (provider.value) {
    case 'OpenAI Realtime':
      return OpenaiSettings;
    case 'Google Realtime':
      return GoogleSettings;
    case 'ElevenLabs Realtime':
      return ElevenLabsSettings;
    default:
      return PipelineSettings;
  }
});

let session: BaseProvider | null = null;

async function onConnect() {
  if (connecting.value || connected.value) return;

  log(`onConnect provider: ${provider.value}`);
  connecting.value = true;

  try {
    setStartTime(performance.now());
    applyPerfConnectSettings();

    switch (provider.value) {
      case 'OpenAI Realtime':
        session = new OpenAIRealtime(getOpenaiOptions());
        break;
      case 'Google Realtime':
        session = new GoogleAIRealtime(getGoogleOptions());
        break;
      case 'ElevenLabs Realtime':
        session = new ElevenLabsRealtime(getElevenLabsOptions());
        break;
      default: {
        session = new PipelineSession(getSttProvider(), getLlmProvider(), getTtsProvider());
        break;
      }
    }

    if (!session) {
      throw new Error('Failed to create session');
    }
    session.on('notify', (message: string) => appendMessage(message));
    session.on('marker', (timeMs: number, color: string, message: string) =>
      waveformRef.value?.addMarker(timeMs, color, message),
    );
    session.on('close', onDisconnect);
    await session.start();

    if (session instanceof OpenAILLM) {
      await appendMessage(`Connected in ${Math.round(performance.now() - startTime)}ms\n`);
      connected.value = true;
      return;
    }

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
    log(`onConnect error: ${error}`);
    appendMessage(`> Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
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

function onClearStorage() {
  clearStorageDialog.value = false;
  localStorage.clear();
  location.reload();
}

async function onTurn(turn: webrtcperf.QuestionAnswerTurn) {
  log('turn %o', turn);
  let msg = turn.mediaFile ? `"${turn.mediaFile}" ` : '';
  const {
    questionStartTime,
    questionEndTime,
    answerStartTime,
    answerEndTime,
    answerInterruptedAt,
    answerTalkingAfterInterruption,
  } = turn;

  switch (turn.phase) {
    case 'question-start':
      msg += `question start`;
      waveformRef.value?.addMarker(questionStartTime, INPUT_COLOR, msg);
      break;
    case 'question-end':
      msg += `question end, duration: ${(questionEndTime - questionStartTime) / 1000}s`;
      waveformRef.value?.addMarker(questionEndTime, INPUT_COLOR, msg);
      break;
    case 'answer-start':
      msg += `answer start after: ${(answerStartTime - questionEndTime) / 1000}s`;
      waveformRef.value?.addMarker(answerStartTime, OUTPUT_COLOR, msg);
      break;
    case 'answer-end':
      msg += `answer end, duration: ${(answerEndTime - answerStartTime) / 1000}s`;
      waveformRef.value?.addMarker(answerEndTime, OUTPUT_COLOR, msg);
      break;
    case 'answer-interrupted':
      msg += `answer interrupted`;
      if (answerTalkingAfterInterruption && answerInterruptedAt) {
        waveformRef.value?.addMarker(answerInterruptedAt, '#FF0000', msg);
        msg += `, talking after interruption for ${answerTalkingAfterInterruption / 1000}s`;
      }
      waveformRef.value?.addMarker(answerEndTime, '#FF0000', msg);
      break;
  }
  await appendMessage(`${msg}\n`);
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="py-6" fluid>
        <v-toolbar density="comfortable" class="mb-4 px-0" flat color="transparent">
          <v-toolbar-title>Realtime Voice Playground</v-toolbar-title>
          <v-spacer />
          <v-btn
            icon="mdi-delete-sweep"
            variant="text"
            color="error"
            aria-label="Clear saved settings"
            title="Clear all saved settings"
            @click="clearStorageDialog = true"
          />
          <v-btn
            icon="mdi-github"
            variant="text"
            href="https://github.com/vpalmisano/realtime-voice-playground"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          />
        </v-toolbar>

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

        <v-dialog v-model="clearStorageDialog" max-width="420">
          <v-card>
            <v-card-title>Clear saved settings?</v-card-title>
            <v-card-text>
              This will remove all saved settings from localStorage and reload the page.
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="clearStorageDialog = false">Cancel</v-btn>
              <v-btn color="error" variant="tonal" @click="onClearStorage">Clear</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <div class="d-flex flex-column ga-4 my-4" v-if="!connected">
          <v-card variant="elevated">
            <component :is="settingsComponent" />
          </v-card>
        </div>

        <div class="d-flex flex-wrap ga-2 my-4">
          <PerfSettings :connected="connected" @turn="onTurn" />
        </div>

        <div class="mb-4">
          <LiveWaveform
            ref="waveformRef"
            :input-media="inputStream"
            :output-media="outputStream"
            input-color="#1976D2"
            output-color="#388E3C"
            :window-seconds="300"
            :height="180"
          />
        </div>

        <MessagesLog />

        <div class="d-flex flex-wrap align-center ga-2 mb-4">
          <v-text-field
            v-model="textInput"
            label="Send a message to LLM..."
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
