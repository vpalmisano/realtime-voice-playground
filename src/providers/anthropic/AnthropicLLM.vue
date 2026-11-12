<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  type AnthropicLLMOptions,
} from '../../lib/providers/anthropic/llm';
import { ANTHROPIC_LLM_FALLBACK_MODELS, fetchModels } from '../../lib/providers/anthropic/utils';
import { defineReference } from '../../utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';
import { LLM_TEXT_AGGREGATION_DEFAULT, LLM_TEXT_AGGREGATIONS } from '../../lib/text';

const PREFIX = 'AnthropicLLM:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
  }, 500);
});

const models = ref<string[]>([...ANTHROPIC_LLM_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);
const maxTokens = defineReference<number>(`${PREFIX}MaxTokens`, DEFAULT_MAX_TOKENS);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const textAggregation = defineReference(
  `${PREFIX}TextAggregation`,
  LLM_TEXT_AGGREGATION_DEFAULT,
  LLM_TEXT_AGGREGATIONS,
);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key);
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch Anthropic models:', error);
    models.value = [...ANTHROPIC_LLM_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

export function getOptions(): AnthropicLLMOptions {
  if (!apiKey.value) {
    throw new Error('Anthropic API key is required');
  }
  return {
    model: model.value,
    apiKey: apiKey.value,
    maxTokens: maxTokens.value,
    context: context.value || undefined,
    textAggregation: textAggregation.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'AnthropicLLMSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Anthropic LLM API Key"
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
        label="Anthropic LLM Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="maxTokens"
        label="Max Tokens"
        type="number"
        min="64"
        max="8192"
        step="64"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="textAggregation"
        :items="[...LLM_TEXT_AGGREGATIONS]"
        label="Text Aggregation"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Anthropic LLM Context (instructions)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
