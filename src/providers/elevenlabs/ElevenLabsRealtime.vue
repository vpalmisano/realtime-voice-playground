<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  type ElevenLabsRealtimeOptions,
} from '../../lib/providers/elevenlabs/realtime';
import {
  ELEVENLABS_REALTIME_FALLBACK_MODELS,
  ELEVENLABS_VOICES,
  fetchModels,
  fetchVoices,
} from '../../lib/providers/elevenlabs/utils';
import {
  buildTurnDetection,
  EAGERNESS_OPTIONS,
  TURN_DETECTION_TYPES,
} from '../../lib/providers/openai/realtime';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'ElevenLabsRealtime:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
    void loadVoices(v);
  }, 500);
});

const models = ref<string[]>([...ELEVENLABS_REALTIME_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const voices = ref<{ name: string; id: string }[]>(
  ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id })),
);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const turnDetectionType = defineReference(
  `${PREFIX}TurnDetectionType`,
  'semantic_vad',
  TURN_DETECTION_TYPES,
);
const eagerness = defineReference(`${PREFIX}Eagerness`, 'medium', EAGERNESS_OPTIONS);
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
    console.error('Failed to fetch ElevenLabs realtime models:', error);
    models.value = [...ELEVENLABS_REALTIME_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

async function loadVoices(key: string) {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices(key);
    voices.value = fetched;
    if (
      !fetched.some(v => v.id === voice.value || v.name.toLowerCase() === voice.value.toLowerCase())
    ) {
      const fallback =
        fetched.find(v => v.name.toLowerCase() === DEFAULT_VOICE) ??
        fetched.find(v => v.id === DEFAULT_VOICE) ??
        fetched[0];
      voice.value = fallback?.id ?? DEFAULT_VOICE;
    }
  } catch (error) {
    console.error('Failed to fetch ElevenLabs realtime voices:', error);
    voices.value = ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id }));
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): ElevenLabsRealtimeOptions {
  if (!apiKey.value) {
    throw new Error('ElevenLabs API key is required');
  }
  return {
    model: model.value,
    voice: voice.value,
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

defineOptions({ name: 'ElevenLabsSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
  void loadVoices(apiKey.value);
});
</script>

<template>
  <v-row class="pa-4">
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="ElevenLabs API Key"
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
        v-model="voice"
        :items="voices"
        item-title="name"
        item-value="id"
        :loading="voicesLoading"
        label="Voice"
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
