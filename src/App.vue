<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
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
import InworldSettings, {
  getOptions as getInworldOptions,
} from './providers/inworld/InworldRealtime.vue';
import PipelineSettings, {
  getLlmProvider as getLlmProviderName,
  getSttProvider as getSttProviderName,
  getTtsProvider as getTtsProviderName,
} from './PipelineSettings.vue';
import EventsLog, { appendEvent, setStartTime, startTime } from './EventsLog.vue';
import PerfSettings, {
  applyPerfConnectSettings,
  getVadOptions,
  maybeDownloadResponseAudio,
  maybeSaveResponseAudio,
  startEstimateQuestionAnswerDelay,
  startWebrtcperfPlots,
  stopWebrtcperfPlots,
  stopEstimateQuestionAnswerDelay,
} from './PerfSettings.vue';
import { defineReference } from './utils.ts';
import { GoogleAIRealtime } from './lib/providers/google/realtime.ts';
import { ElevenLabsRealtime } from './lib/providers/elevenlabs/realtime.ts';
import { InworldRealtime } from './lib/providers/inworld/realtime.ts';
import { OpenAILLM } from './lib/providers/openai/llm.ts';
import LiveWaveform, { INPUT_COLOR, OUTPUT_COLOR } from './LiveWaveform.vue';
import { PipelineSession } from './lib/pipeline.ts';
import { getLlmProvider, getSttProvider, getTtsProvider } from './providers/index.ts';
import type { BaseProvider } from './lib/providers/base.ts';
import webrtcperf from './webrtcperf.ts';
import debug from 'debug';
import type { SnackbarMessage } from 'vuetify/lib/components/VSnackbarQueue/VSnackbarQueue.mjs';

const log = debug('realtime:app');

const PROVIDERS = [
  'Custom',
  'ElevenLabs Realtime',
  'Google Realtime',
  'Inworld Realtime',
  'OpenAI Realtime',
] as const;

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

const pipelineStages = computed(() => {
  if (provider.value === 'Custom') {
    return [
      { role: 'STT', name: getSttProviderName() },
      { role: 'LLM', name: getLlmProviderName() },
      { role: 'TTS', name: getTtsProviderName() },
    ];
  }
  return [{ role: 'Speech-to-Speech', name: provider.value }];
});

const settingsComponent = computed(() => {
  switch (provider.value) {
    case 'OpenAI Realtime':
      return OpenaiSettings;
    case 'Google Realtime':
      return GoogleSettings;
    case 'ElevenLabs Realtime':
      return ElevenLabsSettings;
    case 'Inworld Realtime':
      return InworldSettings;
    default:
      return PipelineSettings;
  }
});

let session: BaseProvider | null = null;

const notificationsQueue = ref<SnackbarMessage[]>([]);
const progressNotifications = reactive(new Map<string, { text: string; value: number }>());

async function onConnect() {
  if (connecting.value || connected.value) return;

  log(`onConnect provider: ${provider.value}`);
  connecting.value = true;

  try {
    setStartTime(performance.now());
    applyPerfConnectSettings();

    switch (provider.value) {
      case 'OpenAI Realtime':
        session = new OpenAIRealtime(getOpenaiOptions(), getVadOptions());
        break;
      case 'Google Realtime':
        session = new GoogleAIRealtime(getGoogleOptions(), getVadOptions());
        break;
      case 'ElevenLabs Realtime':
        session = new ElevenLabsRealtime(getElevenLabsOptions(), getVadOptions());
        break;
      case 'Inworld Realtime':
        session = new InworldRealtime(getInworldOptions(), getVadOptions());
        break;
      default: {
        session = new PipelineSession(getSttProvider(), getLlmProvider(), getTtsProvider());
        break;
      }
    }

    if (!session) {
      throw new Error('Failed to create session');
    }
    session.on('notify', (message: string) => appendEvent(message));
    session.on('error', (text: string) => {
      notificationsQueue.value.push({ text, color: 'error' });
      appendEvent(`Error: ${text}`);
    });
    session.on('progress', (message: string, value: number) => {
      const rounded = Math.round(value);
      if (rounded >= 100) {
        progressNotifications.delete(message);
        return;
      }
      const existing = progressNotifications.get(message);
      if (existing) {
        existing.value = rounded;
        return;
      }
      progressNotifications.set(message, {
        text: message,
        value: rounded,
      });
    });
    session.on('marker', (timeMs: number, color: string, message: string) =>
      waveformRef.value?.addMarker(timeMs, color, message),
    );
    session.on('close', onDisconnect);
    await session.start();

    if (session instanceof OpenAILLM) {
      appendEvent(`Connected in ${Math.round(performance.now() - startTime)}ms`);
      connected.value = true;
      return;
    }

    if (!session.sourceAudioTrack || !session.outputAudioTrack) {
      throw new Error('Failed to get audio tracks');
    }

    inputStream.value = new MediaStream([session.sourceAudioTrack]);
    outputStream.value = new MediaStream([session.outputAudioTrack]);

    await maybeSaveResponseAudio(session.outputAudioTrack);

    if (!session.sourceAudioVad || !session.outputAudioVad) {
      throw new Error('Failed to get voice activity detectors');
    }
    await startEstimateQuestionAnswerDelay(session.sourceAudioVad, session.outputAudioVad);

    appendEvent(`Connected in ${Math.round(performance.now() - startTime)}ms`);
    connected.value = true;

    startWebrtcperfPlots(plotsEl.value);
  } catch (error) {
    log(`onConnect error: ${error}`);
    notificationsQueue.value.push({
      text: error instanceof Error ? error.message : 'Unknown error',
      color: 'error',
    });
    onDisconnect(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    connecting.value = false;
  }
}

function onDisconnect(reason?: string) {
  if (!session) return;
  session.removeAllListeners();
  const { promptTokenCount, responseTokenCount } = session;
  appendEvent(
    `Disconnected${reason ? ` (${reason})` : ''}, tokens usage: ${promptTokenCount} input, ${responseTokenCount} output`,
  );
  maybeDownloadResponseAudio(session.outputAudioTrack);
  stopEstimateQuestionAnswerDelay();
  session.stop();
  session = null;
  inputStream.value = null;
  outputStream.value = null;
  connected.value = false;
  progressNotifications.clear();
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
  appendEvent(`Sending: "${text}"`);
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
      msg += `question end (${(questionEndTime - questionStartTime) / 1000}s)`;
      waveformRef.value?.addMarker(questionEndTime, INPUT_COLOR, msg);
      break;
    case 'answer-start':
      msg += `answer start, TTFA: ${(answerStartTime - questionEndTime) / 1000}s`;
      waveformRef.value?.addMarker(answerStartTime, OUTPUT_COLOR, msg);
      break;
    case 'answer-end':
      msg += `answer end (${(answerEndTime - answerStartTime) / 1000}s)`;
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
  appendEvent(msg);
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
          <v-col cols="12" md="6" lg="4" v-if="!connected">
            <v-select
              v-model="provider"
              :items="[...PROVIDERS]"
              label="Provider"
              variant="outlined"
              density="comfortable"
              hide-details
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

        <div class="d-flex flex-column ga-4 my-4">
          <v-card variant="elevated" v-if="!connected">
            <component :is="settingsComponent" />
          </v-card>
          <v-card v-else variant="elevated">
            <v-card-text class="pa-2">
              <v-timeline
                direction="horizontal"
                density="compact"
                side="end"
                truncate-line="both"
                size="small"
              >
                <v-timeline-item
                  v-for="stage in pipelineStages"
                  :key="`${stage.role}-${stage.name}`"
                  size="small"
                  dot-color="primary"
                >
                  <div class="text-caption text-medium-emphasis">{{ stage.role }}</div>
                  <div class="text-body-2 font-weight-medium">{{ stage.name }}</div>
                </v-timeline-item>
              </v-timeline>
            </v-card-text>
          </v-card>
        </div>

        <div class="my-4">
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

        <EventsLog />

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

      <v-snackbar
        :model-value="progressNotifications.size > 0"
        color="info"
        :timeout="-1"
        location="top"
        multi-line
      >
        <div
          v-for="[key, item] in progressNotifications"
          :key="key"
          class="d-flex align-center ga-2 mb-1"
        >
          <v-progress-circular :model-value="item.value" size="18" width="2" />
          <span>{{ item.text }}</span>
        </div>
      </v-snackbar>

      <v-snackbar-queue
        ref="errorsSnackbarQueue"
        v-model="notificationsQueue"
        :total-visible="5"
        closable
      ></v-snackbar-queue>
    </v-main>
  </v-app>
</template>
