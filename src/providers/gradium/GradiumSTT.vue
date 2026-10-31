<script lang="ts">
import {
  DEFAULT_DELAY_IN_FRAMES,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  DEFAULT_VAD_CONSECUTIVE_STEPS,
  DEFAULT_VAD_THRESHOLD,
  DELAY_IN_FRAMES_OPTIONS,
  type GradiumSTTOptions,
} from '../../lib/providers/gradium/stt';
import { GRADIUM_LANGUAGES, GRADIUM_STT_FALLBACK_MODELS } from '../../lib/providers/gradium/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'GradiumSTT:';

const apiKey = defineReference(`${PREFIX}ApiKey`, '');
const model = defineReference(`${PREFIX}Model`, DEFAULT_MODEL, GRADIUM_STT_FALLBACK_MODELS);
const language = defineReference(`${PREFIX}Language`, DEFAULT_LANGUAGE, GRADIUM_LANGUAGES);
const delayInFrames = defineReference(`${PREFIX}DelayInFrames`, DEFAULT_DELAY_IN_FRAMES);
const vadThreshold = defineReference(`${PREFIX}VadThreshold`, DEFAULT_VAD_THRESHOLD);
const vadConsecutiveSteps = defineReference(
  `${PREFIX}VadConsecutiveSteps`,
  DEFAULT_VAD_CONSECUTIVE_STEPS,
);

export function getOptions(): GradiumSTTOptions {
  if (!apiKey.value) {
    throw new Error('Gradium STT API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    language: language.value,
    delayInFrames: delayInFrames.value,
    vadThreshold: vadThreshold.value,
    vadConsecutiveSteps: vadConsecutiveSteps.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'GradiumSTTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Gradium STT API Key"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="model"
        :items="[...GRADIUM_STT_FALLBACK_MODELS]"
        label="Gradium STT Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="language"
        :items="[...GRADIUM_LANGUAGES]"
        label="Language"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model.number="delayInFrames"
        :items="[...DELAY_IN_FRAMES_OPTIONS]"
        label="Delay in Frames (80ms each)"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="vadThreshold"
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
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="vadConsecutiveSteps"
        label="VAD Consecutive Steps"
        type="number"
        min="1"
        max="20"
        step="1"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
