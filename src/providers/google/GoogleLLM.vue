<script lang="ts">
import { ref } from 'vue';
import { DEFAULT_MODEL, type GoogleLLMOptions } from '../../lib/providers/google/llm';
import { GOOGLE_LLM_FALLBACK_MODELS, fetchModels } from '../../lib/providers/google/utils';
import { defineReference } from '../../utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';

const PREFIX = 'GoogleLLM:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
  }, 500);
});

const models = ref<string[]>([...GOOGLE_LLM_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'llm');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch Google models:', error);
    models.value = [...GOOGLE_LLM_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getOptions(): GoogleLLMOptions {
  if (!apiKey.value) {
    throw new Error('Google API key is required');
  }
  return {
    model: model.value,
    apiKey: apiKey.value,
    context: context.value || undefined,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'GoogleLLMSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Google LLM API Key"
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
        label="Google LLM Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Google LLM Context (instructions)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
