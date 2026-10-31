<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE_ID,
  type GradiumTTSOptions,
} from '../../lib/providers/gradium/tts';
import {
  GRADIUM_TTS_FALLBACK_MODELS,
  GRADIUM_VOICES,
  fetchVoices,
} from '../../lib/providers/gradium/utils';
import { defineReference } from '../../utils';

const PREFIX = 'GradiumTTS:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadVoices(v);
  }, 500);
});

const model = defineReference(`${PREFIX}Model`, DEFAULT_MODEL, GRADIUM_TTS_FALLBACK_MODELS);

const voices = ref<{ name: string; id: string }[]>(
  GRADIUM_VOICES.map(v => ({ name: v.name, id: v.id })),
);
const voicesLoading = ref(false);
const voiceId = defineReference<string>(`${PREFIX}VoiceId`, DEFAULT_VOICE_ID);

async function loadVoices(key: string) {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices(key);
    voices.value = fetched;
    if (!fetched.some(v => v.id === voiceId.value)) {
      const fallback = fetched.find(v => v.id === DEFAULT_VOICE_ID) ?? fetched[0];
      voiceId.value = fallback?.id ?? DEFAULT_VOICE_ID;
    }
  } catch (error) {
    console.error('Failed to fetch Gradium TTS voices:', error);
    voices.value = GRADIUM_VOICES.map(v => ({ name: v.name, id: v.id }));
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): GradiumTTSOptions {
  if (!apiKey.value) {
    throw new Error('Gradium TTS API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    voiceId: voiceId.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'GradiumTTSSettings' });

onMounted(() => {
  void loadVoices(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Gradium TTS API Key"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="model"
        :items="[...GRADIUM_TTS_FALLBACK_MODELS]"
        label="Gradium TTS Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="voiceId"
        :items="voices"
        item-title="name"
        item-value="id"
        :loading="voicesLoading"
        label="Gradium TTS Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
