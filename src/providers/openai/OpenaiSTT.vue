<script lang="ts">
import { ref } from 'vue';
import { DEFAULT_MODEL, type OpenAISTTOptions } from '../../lib/providers/openai/stt';
import { OPENAI_STT_FALLBACK_MODELS, fetchModels } from '../../lib/providers/openai/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'OpenaiSTT:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
  }, 500);
});

const models = ref<string[]>([...OPENAI_STT_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);
const silenceDurationMs = defineReference(`${PREFIX}SilenceDurationMs`, 500);
const threshold = defineReference(`${PREFIX}Threshold`, 0.5);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'stt');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch OpenAI STT models:', error);
    models.value = [...OPENAI_STT_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getOptions(): OpenAISTTOptions {
  if (!apiKey.value) {
    throw new Error('OpenAI STT API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    silenceDurationMs: silenceDurationMs.value,
    threshold: threshold.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'OpenaiSTTSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="OpenAI STT API Key"
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
        label="OpenAI STT Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="silenceDurationMs"
        label="VAD Silence Duration (ms)"
        type="number"
        min="100"
        max="5000"
        step="50"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="threshold"
        label="VAD Threshold"
        type="number"
        min="0"
        max="1"
        step="0.05"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
