<script lang="ts">
import { computed } from 'vue';
import webrtcperf from './webrtcperf';
import { appendMessage } from './MessagesLog.vue';
import { defineReference } from './utils';

const DETECTORS = ['simple', 'silero'] as const;
const QUESTIONS = __QUESTIONS__;

const overrideGetUserMedia = defineReference<boolean>('overrideGetUserMedia', false);
const saveResponseAudio = defineReference<boolean>('saveResponseAudio', false);
const minTalkingDurationMs = defineReference<number>('minTalkingDurationMs', 40);
const minSilentDurationMs = defineReference<number>('minSilentDurationMs', 1000);
const detector = defineReference('detector', 'silero', DETECTORS);
export const chunkMs = defineReference<number>('chunkMs', 80);

const showQuestions = computed(() => overrideGetUserMedia.value);

let stopQaDelayEstimation: (() => void) | null = null;
let emitTurn: ((turn: webrtcperf.QuestionAnswerTurn) => void) | null = null;

function onTurn(turn: webrtcperf.QuestionAnswerTurn) {
  emitTurn?.(turn);
}

export function applyPerfConnectSettings() {
  webrtcperf.params.overrideGetUserMedia = overrideGetUserMedia.value;
  webrtcperf.fakeStreamManager.muted = false;
  webrtcperf.fakeStreamManager.volume = 1.0;
}

export async function maybeSaveResponseAudio(track: MediaStreamTrack) {
  if (!saveResponseAudio.value) return;
  webrtcperf.overrides.getParticipantNameForSave = () => 'recv';
  await webrtcperf.saveMediaTrack(track, 'recv');
}

export function maybeDownloadResponseAudio(track: MediaStreamTrack | null) {
  if (!saveResponseAudio.value) return;
  if (track) webrtcperf.stopSaveMediaTrack(track);
  webrtcperf
    .downloadMediaFromStorage('recv.wav')
    .then(() => webrtcperf.deleteMediaFromStorage('recv.wav'))
    .catch(console.error);
}

export async function startEstimateQuestionAnswerDelay(
  sendTrack: MediaStreamTrack,
  recvTrack: MediaStreamTrack,
) {
  stopQaDelayEstimation =
    (await webrtcperf.estimateQuestionAnswerDelay({
      sendTrack,
      recvTrack,
      minTalkingDurationMs: minTalkingDurationMs.value,
      minSilentDurationMs: minSilentDurationMs.value,
      detector: detector.value,
      callback: onTurn,
    })) ?? null;
}

export function stopEstimateQuestionAnswerDelay() {
  stopQaDelayEstimation?.();
  stopQaDelayEstimation = null;
}

export function startWebrtcperfPlots(container: HTMLElement | null) {
  if (!container) return;
  webrtcperf.startPlots({
    intervalMs: 1000,
    container,
    enabledStats: [
      'outbound_audio_bitrate',
      'outbound_audio_packetsLossRate',
      'outbound_audio_roundTripTime',
      'inbound_audio_bitrate',
      'inbound_audio_packetsLossRate',
      'inbound_audio_jitterBuffer',
      'inbound_audio_insertedSamplesForDeceleration',
      'inbound_audio_removedSamplesForAcceleration',
      'outbound_websocket_bitrate',
      'outbound_websocket_messageRate',
      'outbound_websocket_bytes',
      'outbound_websocket_messages',
      'inbound_websocket_bitrate',
      'inbound_websocket_messageRate',
      'inbound_websocket_bytes',
      'inbound_websocket_messages',
    ],
  });
}

export function stopWebrtcperfPlots() {
  webrtcperf.stopPlots();
}

function onPlayQuestion(name: string) {
  webrtcperf
    .setMedia(`./audio/${name}`)
    .catch(error => appendMessage(`Error playing audio ${name}: ${error}\n`));
}
</script>

<script setup lang="ts">
import { onUnmounted } from 'vue';

defineProps<{
  connected: boolean;
}>();

const emit = defineEmits<{
  turn: [turn: webrtcperf.QuestionAnswerTurn];
}>();

emitTurn = turn => emit('turn', turn);
onUnmounted(() => {
  emitTurn = null;
});
</script>

<template>
  <div class="mb-4" v-if="!connected">
    <div class="text-subtitle-1 font-weight-bold mb-2">Q&A estimator settings</div>

    <v-row>
      <v-col cols="12" class="d-flex flex-wrap ga-2 align-center">
        <v-checkbox
          v-model="overrideGetUserMedia"
          label="Use fake audio input"
          hide-details
          density="compact"
        />
        <v-checkbox
          v-model="saveResponseAudio"
          label="Save output audio"
          hide-details
          density="compact"
        />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="4">
        <v-text-field
          v-model.number="minTalkingDurationMs"
          label="Min talking duration (ms)"
          type="number"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field
          v-model.number="minSilentDurationMs"
          label="Min silent duration (ms)"
          type="number"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-select
          v-model="detector"
          :items="[...DETECTORS]"
          label="Detector"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field
          v-model.number="chunkMs"
          label="Audio capture chunk size (ms)"
          type="number"
          min="20"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
    </v-row>
  </div>

  <div v-if="showQuestions && connected" class="mb-4">
    <div class="text-subtitle-1 font-weight-bold mb-2">Audio inputs</div>
    <div class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="question in QUESTIONS"
        :key="question"
        size="small"
        variant="outlined"
        :disabled="!connected"
        @click="onPlayQuestion(question)"
      >
        {{ question.replace('.mp3', '') }}
      </v-btn>
    </div>
  </div>
</template>
