<script lang="ts">
import type { Reson8STTOptions } from '../../lib/providers/reson8/stt';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const language = defineReference<string>('Reson8STT:Language', '');

export function getOptions(): Reson8STTOptions {
  return { language: language.value, chunkMs: chunkMs.value };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'Reson8STTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        This runs locally in your browser with WebGPU using the
        <a
          href="https://huggingface.co/kaptionai/rumble-2-flash-web"
          target="_blank"
          rel="noopener noreferrer"
          >community ONNX conversion</a
        >
        of
        <a
          href="https://huggingface.co/Reson8/Rumble-2-Flash"
          target="_blank"
          rel="noopener noreferrer"
          >Reson8 Rumble-2-Flash</a
        >. First use downloads about 494 MB. Your GPU must support WebGPU shader-f16.
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="language"
        label="Language (optional, e.g. English)"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
