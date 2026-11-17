<script lang="ts">
import {
  COHERE_DEVICES,
  COHERE_LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_MAX_NEW_TOKENS,
  type CohereDevice,
  type CohereLanguage,
  type CohereSTTOptions,
} from '../../lib/providers/cohere/stt';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'CohereSTT:';

const device = defineReference<CohereDevice>(`${PREFIX}Device`, 'webgpu', [...COHERE_DEVICES]);
const language = defineReference<CohereLanguage>(`${PREFIX}Language`, DEFAULT_LANGUAGE, [
  ...COHERE_LANGUAGES,
]);
const maxNewTokens = defineReference<number>(`${PREFIX}MaxNewTokens`, DEFAULT_MAX_NEW_TOKENS);

export function getOptions(): CohereSTTOptions {
  return {
    device: device.value,
    language: language.value,
    maxNewTokens: maxNewTokens.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'CohereSTTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Model runs on-device via
        <a
          href="https://huggingface.co/onnx-community/cohere-transcribe-03-2026-ONNX"
          target="_blank"
          rel="noopener noreferrer"
          >Transformers.js / WebGPU</a
        >. First load downloads the weights (cached afterwards). Language must be set — there is no
        auto-detect.
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="device"
        :items="[...COHERE_DEVICES]"
        label="Device"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="language"
        :items="[...COHERE_LANGUAGES]"
        label="Language"
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
        min="256"
        max="4096"
        step="256"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
