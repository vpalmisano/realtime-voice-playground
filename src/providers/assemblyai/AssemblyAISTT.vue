<script lang="ts">
import { ref } from 'vue';
import { DEFAULT_MODEL, type AssemblyAISTTOptions } from '../../lib/providers/assemblyai/stt';
import { ASSEMBLYAI_STT_FALLBACK_MODELS } from '../../lib/providers/assemblyai/utils';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'AssemblyAISTT:';

const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '');
const models = ref<string[]>([...ASSEMBLYAI_STT_FALLBACK_MODELS]);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

export function getOptions(): AssemblyAISTTOptions {
  if (!apiKey.value) {
    throw new Error('AssemblyAI STT temporary token is required');
  }

  return {
    apiKey: apiKey.value,
    model: model.value as AssemblyAISTTOptions['model'],
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'AssemblyAISTTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Generate a temporary token using the command:
        <pre class="mt-2 mb-0 text-caption">
curl "https://streaming.assemblyai.com/v3/token?expires_in_seconds=600" -H "Authorization: ASSEMBLYAI_API_KEY"</pre>
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="AssemblyAI STT Temporary Token"
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
        label="AssemblyAI STT Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
