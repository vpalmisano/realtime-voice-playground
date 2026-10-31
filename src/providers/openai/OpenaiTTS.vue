<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  type OpenAITTSOptions,
} from '../../lib/providers/openai/tts';
import {
  OPENAI_TTS_FALLBACK_MODELS,
  OPENAI_VOICES,
  fetchModels,
  fetchVoices,
} from '../../lib/providers/openai/utils';
import { defineReference } from '../../utils';

const PREFIX = 'OpenaiTTS:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
    void loadVoices();
  }, 500);
});

const models = ref<string[]>([...OPENAI_TTS_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const voices = ref<string[]>([...OPENAI_VOICES]);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);
const instructions = defineReference(`${PREFIX}Instructions`, '');

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'tts');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI TTS models:', error);
    models.value = [...OPENAI_TTS_FALLBACK_MODELS];
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
    console.error('Failed to fetch OpenAI TTS voices:', error);
    voices.value = [...OPENAI_VOICES];
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): OpenAITTSOptions {
  if (!apiKey.value) {
    throw new Error('OpenAI TTS API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    voice: voice.value,
    instructions: instructions.value || undefined,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'OpenaiTTSSettings' });

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
        label="OpenAI TTS API Key"
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
        label="OpenAI TTS Model"
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
        label="OpenAI TTS Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="instructions"
        label="Speech Instructions (optional)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
