<script lang="ts">
import {
  DEFAULT_ENABLE_THINKING,
  DEFAULT_MAX_NEW_TOKENS,
  NEMOTRON_LLM_DEVICES,
  type NemotronLlmDevice,
  type NvidiaNemotronLLMOptions,
} from '../../lib/providers/nvidia/llm';
import { defineReference } from '../../utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';
import { LLM_TEXT_AGGREGATION_DEFAULT, LLM_TEXT_AGGREGATIONS } from '../../lib/text';

const PREFIX = 'NvidiaNemotronLLM:';

const device = defineReference<NemotronLlmDevice>(`${PREFIX}Device`, 'webgpu', [
  ...NEMOTRON_LLM_DEVICES,
]);
const maxNewTokens = defineReference<number>(`${PREFIX}MaxNewTokens`, DEFAULT_MAX_NEW_TOKENS);
const enableThinking = defineReference<boolean>(`${PREFIX}EnableThinking`, DEFAULT_ENABLE_THINKING);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const textAggregation = defineReference(
  `${PREFIX}TextAggregation`,
  LLM_TEXT_AGGREGATION_DEFAULT,
  LLM_TEXT_AGGREGATIONS,
);

export function getOptions(): NvidiaNemotronLLMOptions {
  return {
    device: device.value,
    maxNewTokens: maxNewTokens.value,
    enableThinking: enableThinking.value,
    context: context.value || undefined,
    textAggregation: textAggregation.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'NvidiaNemotronLLMSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Model runs on-device via
        <a
          href="https://huggingface.co/onnx-community/NVIDIA-Nemotron-3-Nano-4B-BF16-ONNX"
          target="_blank"
          rel="noopener noreferrer"
          >Transformers.js / WebGPU</a
        >. First load downloads ~2.5&nbsp;GB (cached afterwards).
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="device"
        :items="[...NEMOTRON_LLM_DEVICES]"
        label="Device"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="maxNewTokens"
        label="Max New Tokens"
        type="number"
        min="64"
        max="4096"
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
    <v-col cols="12" md="6" lg="4" class="d-flex align-center">
      <v-checkbox
        v-model="enableThinking"
        label="Enable thinking"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Nemotron LLM Context (instructions)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
