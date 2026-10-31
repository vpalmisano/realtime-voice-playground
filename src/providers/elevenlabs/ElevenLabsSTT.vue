<script lang="ts">
import { ref } from 'vue';
import { DEFAULT_MODEL, type ElevenLabsSTTOptions } from '../../lib/providers/elevenlabs/stt';
import { ELEVENLABS_STT_FALLBACK_MODELS, fetchModels } from '../../lib/providers/elevenlabs/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'ElevenLabsSTT:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
  }, 500);
});

const models = ref<string[]>([...ELEVENLABS_STT_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'stt');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch ElevenLabs STT models:', error);
    models.value = [...ELEVENLABS_STT_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getOptions(): ElevenLabsSTTOptions {
  if (!apiKey.value) {
    throw new Error('ElevenLabs API key is required');
  }
  return {
    apiKey: apiKey.value,
    modelId: model.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'ElevenLabsSTTSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="ElevenLabs STT API Key"
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
        label="ElevenLabs STT Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
