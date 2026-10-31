<script lang="ts">
import { ref } from 'vue';
import {
  buildTurnDetection,
  DEFAULT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_VOICE,
  EAGERNESS_OPTIONS,
  TRANSPORTS,
  TURN_DETECTION_TYPES,
  type OpenAIRealtimeOptions,
} from '../../lib/providers/openai/realtime';
import {
  OPENAI_REALTIME_FALLBACK_MODELS,
  OPENAI_TRANSCRIPTION_FALLBACK_MODELS,
  OPENAI_VOICES,
  fetchModels,
  fetchVoices,
} from '../../lib/providers/openai/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';

const PREFIX = 'OpenaiRealtime:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
    void loadTranscriptionModels(v);
    void loadVoices();
  }, 500);
});

const models = ref<string[]>([...OPENAI_REALTIME_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const transcriptionModels = ref<string[]>([...OPENAI_TRANSCRIPTION_FALLBACK_MODELS]);
const transcriptionModelsLoading = ref(false);
const transcriptionModel = defineReference<string>(
  `${PREFIX}TranscriptionModel`,
  DEFAULT_TRANSCRIPTION_MODEL,
);

const voices = ref<string[]>([...OPENAI_VOICES]);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);

const transport = defineReference(`${PREFIX}Transport`, 'websocket', TRANSPORTS);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const turnDetectionType = defineReference(
  `${PREFIX}TurnDetectionType`,
  'semantic_vad',
  TURN_DETECTION_TYPES,
);
const eagerness = defineReference(`${PREFIX}Eagerness`, 'auto', EAGERNESS_OPTIONS);
const threshold = defineReference(`${PREFIX}Threshold`, 0.5);
const prefixPaddingMs = defineReference(`${PREFIX}PrefixPaddingMs`, 300);
const silenceDurationMs = defineReference(`${PREFIX}SilenceDurationMs`, 500);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'realtime');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI models:', error);
    models.value = [...OPENAI_REALTIME_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

async function loadTranscriptionModels(key: string) {
  transcriptionModelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'transcription');
    transcriptionModels.value = fetched;
    if (!fetched.includes(transcriptionModel.value)) {
      transcriptionModel.value = fetched.includes(DEFAULT_TRANSCRIPTION_MODEL)
        ? DEFAULT_TRANSCRIPTION_MODEL
        : (fetched[0] ?? DEFAULT_TRANSCRIPTION_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI transcription models:', error);
    transcriptionModels.value = [...OPENAI_TRANSCRIPTION_FALLBACK_MODELS];
  } finally {
    transcriptionModelsLoading.value = false;
  }
}

async function loadVoices() {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices();
    voices.value = fetched;
    if (!fetched.includes(voice.value)) {
      voice.value = fetched.includes(DEFAULT_VOICE) ? DEFAULT_VOICE : (fetched[0] ?? DEFAULT_VOICE);
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI voices:', error);
    voices.value = [...OPENAI_VOICES];
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): OpenAIRealtimeOptions {
  if (!apiKey.value) {
    throw new Error('OpenAI API key is required');
  }
  return {
    transportType: transport.value,
    model: model.value,
    voice: voice.value,
    transcriptionModel: transcriptionModel.value,
    apiKey: apiKey.value,
    context: context.value || undefined,
    turnDetection: buildTurnDetection({
      type: turnDetectionType.value,
      eagerness: eagerness.value,
      threshold: threshold.value,
      prefixPaddingMs: prefixPaddingMs.value,
      silenceDurationMs: silenceDurationMs.value,
    }),
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

onMounted(() => {
  void loadModels(apiKey.value);
  void loadTranscriptionModels(apiKey.value);
  void loadVoices();
});
</script>

<template>
  <v-row class="pa-4">
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="OpenAI API Key"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="model"
        :items="models"
        :loading="modelsLoading"
        label="Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="transport"
        :items="[...TRANSPORTS]"
        label="Transport"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="voice"
        :items="voices"
        :loading="voicesLoading"
        label="Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="transcriptionModel"
        :items="transcriptionModels"
        :loading="transcriptionModelsLoading"
        label="Transcription Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>

    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Context (instructions)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>

    <v-col cols="12">
      <v-row density="compact">
        <v-col cols="12" md="6" lg="3">
          <v-select
            v-model="turnDetectionType"
            :items="[...TURN_DETECTION_TYPES]"
            label="Turn detection"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </v-col>
        <v-col v-if="turnDetectionType === 'semantic_vad'" cols="12" md="6" lg="3">
          <v-select
            v-model="eagerness"
            :items="[...EAGERNESS_OPTIONS]"
            label="Eagerness"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </v-col>
        <template v-else-if="turnDetectionType === 'server_vad'">
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="threshold"
              label="Threshold"
              type="number"
              step="0.01"
              min="0"
              max="1"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="prefixPaddingMs"
              label="Prefix padding (ms)"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="silenceDurationMs"
              label="Silence duration (ms)"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
        </template>
      </v-row>
    </v-col>
  </v-row>
</template>

<style scoped></style>
