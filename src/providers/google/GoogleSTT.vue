<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  TRANSCRIPTION_MODES,
  type GoogleSTTOptions,
} from '../../lib/providers/google/stt';
import { GOOGLE_STT_FALLBACK_MODELS, fetchModels } from '../../lib/providers/google/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'GoogleSTT:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
  }, 500);
});

const models = ref<string[]>([...GOOGLE_STT_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);
const mode = defineReference(`${PREFIX}Mode`, 'SMART', TRANSCRIPTION_MODES);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'stt');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch Google STT models:', error);
    models.value = [...GOOGLE_STT_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getOptions(): GoogleSTTOptions {
  if (!apiKey.value) {
    throw new Error('Google STT API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    mode: mode.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'GoogleSTTSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Google STT API Key"
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
        label="Google STT Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="mode"
        :items="[...TRANSCRIPTION_MODES]"
        label="Transcription Mode"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
