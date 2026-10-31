<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  type GoogleTTSOptions,
} from '../../lib/providers/google/tts';
import {
  GOOGLE_TTS_FALLBACK_MODELS,
  GOOGLE_VOICES,
  fetchModels,
  fetchVoices,
} from '../../lib/providers/google/utils';
import { defineReference } from '../../utils';

const PREFIX = 'GoogleTTS:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
    void loadVoices();
  }, 500);
});

const models = ref<string[]>([...GOOGLE_TTS_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const voices = ref<string[]>([...GOOGLE_VOICES]);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'tts');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch Google TTS models:', error);
    models.value = [...GOOGLE_TTS_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
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
    console.error('Failed to fetch Google TTS voices:', error);
    voices.value = [...GOOGLE_VOICES];
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): GoogleTTSOptions {
  if (!apiKey.value) {
    throw new Error('Google TTS API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    voice: voice.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'GoogleTTSSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
  void loadVoices();
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Google TTS API Key"
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
        label="Google TTS Model"
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
        label="Google TTS Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
