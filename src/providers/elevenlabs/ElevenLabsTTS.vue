<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE_ID,
  type ElevenLabsTTSOptions,
} from '../../lib/providers/elevenlabs/tts';
import {
  ELEVENLABS_TTS_FALLBACK_MODELS,
  ELEVENLABS_VOICES,
  fetchModels,
  fetchVoices,
} from '../../lib/providers/elevenlabs/utils';
import { defineReference } from '../../utils';

const PREFIX = 'ElevenLabsTTS:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadModels(v);
    void loadVoices(v);
  }, 500);
});

const models = ref<string[]>([...ELEVENLABS_TTS_FALLBACK_MODELS]);
const modelsLoading = ref(false);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const voices = ref<{ name: string; id: string }[]>(
  ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id })),
);
const voicesLoading = ref(false);
const voiceId = defineReference<string>(`${PREFIX}VoiceId`, DEFAULT_VOICE_ID);

async function loadModels(key: string) {
  modelsLoading.value = true;
  try {
    const fetched = await fetchModels(key, 'tts');
    models.value = fetched;
    if (!fetched.includes(model.value)) {
      model.value = fetched.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (fetched[0] ?? DEFAULT_MODEL);
    }
  } catch (error) {
    console.error('Failed to fetch ElevenLabs TTS models:', error);
    models.value = [...ELEVENLABS_TTS_FALLBACK_MODELS];
  } finally {
    modelsLoading.value = false;
  }
}

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
    console.error('Failed to fetch ElevenLabs TTS voices:', error);
    voices.value = ELEVENLABS_VOICES.map(v => ({ name: v.name, id: v.id }));
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): ElevenLabsTTSOptions {
  if (!apiKey.value) {
    throw new Error('ElevenLabs API key is required');
  }
  return {
    apiKey: apiKey.value,
    modelId: model.value,
    voiceId: voiceId.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'ElevenLabsTTSSettings' });

onMounted(() => {
  void loadModels(apiKey.value);
  void loadVoices(apiKey.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="ElevenLabs TTS API Key"
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
        label="ElevenLabs TTS Model"
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
        label="ElevenLabs TTS Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
