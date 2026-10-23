<script lang="ts">
import { ref } from 'vue';
import {
  buildTurnDetection,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  EAGERNESS_OPTIONS,
  FALLBACK_MODELS,
  fetchModels,
  TRANSCRIPTION_MODELS,
  TRANSPORTS,
  TURN_DETECTION_TYPES,
  VOICES,
  type OpenAISessionOptions,
} from './lib/openai';
import { defineReference } from './lib/utils';
import { DEFAULT_CONTEXT } from './lib/provider';

let fetchModelsTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>('openaiApiKey', '', [], v => {
  if (fetchModelsTimer) clearTimeout(fetchModelsTimer);
  fetchModelsTimer = setTimeout(() => loadModels(v), 500);
});

const models = ref<string[]>([...FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>('openaiModel', DEFAULT_MODEL);
const transport = defineReference('openaiTransport', 'websocket', TRANSPORTS);
const voice = defineReference('openaiVoice', DEFAULT_VOICE, VOICES);
const transcriptionModel = defineReference(
  'openaiTranscriptionModel',
  'gpt-4o-transcribe',
  TRANSCRIPTION_MODELS,
);
const context = defineReference('openaiContext', DEFAULT_CONTEXT);
const turnDetectionType = defineReference(
  'openaiTurnDetectionType',
  'semantic_vad',
  TURN_DETECTION_TYPES,
);
const eagerness = defineReference('openaiEagerness', 'auto', EAGERNESS_OPTIONS);
const threshold = defineReference('openaiThreshold', 0.5);
const prefixPaddingMs = defineReference('openaiPrefixPaddingMs', 300);
const silenceDurationMs = defineReference('openaiSilenceDurationMs', 500);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key);
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched[0] ?? DEFAULT_MODEL;
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI models:', error);
    models.value = [...FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getSessionOptions(): OpenAISessionOptions {
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
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

onMounted(() => loadModels(apiKey.value));
</script>

<template>
  <v-row>
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
        :items="[...VOICES]"
        label="Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="transcriptionModel"
        :items="[...TRANSCRIPTION_MODELS]"
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
