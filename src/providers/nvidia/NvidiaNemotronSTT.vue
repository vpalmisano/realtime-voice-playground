<script lang="ts">
import {
  DEFAULT_BEAM_WIDTH,
  DEFAULT_LANGUAGE,
  DEFAULT_PROFILE,
  NEMOTRON_LANGUAGES,
  NEMOTRON_PROFILES,
  type NemotronProfile,
  type NvidiaNemotronSTTOptions,
} from '../../lib/providers/nvidia/stt';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'NvidiaNemotronSTT:';

const language = defineReference(`${PREFIX}Language`, DEFAULT_LANGUAGE, [...NEMOTRON_LANGUAGES]);
const profile = defineReference<NemotronProfile>(`${PREFIX}Profile`, DEFAULT_PROFILE, [
  ...NEMOTRON_PROFILES,
]);
const beamWidth = defineReference<number>(`${PREFIX}BeamWidth`, DEFAULT_BEAM_WIDTH);

export function getOptions(): NvidiaNemotronSTTOptions {
  return {
    language: language.value,
    profile: profile.value,
    beamWidth: beamWidth.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'NvidiaNemotronSTTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Model runs on-device via
        <a
          href="https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b"
          target="_blank"
          rel="noopener noreferrer"
          >WebGPU / ONNX</a
        >. First load downloads ~750–860&nbsp;MB (cached afterwards). WebGPU is required.
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="language"
        :items="[...NEMOTRON_LANGUAGES]"
        label="Language"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="profile"
        :items="[...NEMOTRON_PROFILES]"
        label="Latency Profile"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="beamWidth"
        label="Beam Width"
        type="number"
        min="1"
        max="5"
        step="1"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
