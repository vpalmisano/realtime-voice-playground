<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_REGION,
  DEFAULT_VOICE_ID,
  type AssemblyAITTSOptions,
} from '../../lib/providers/assemblyai/tts';
import {
  ASSEMBLYAI_TTS_REGIONS,
  ASSEMBLYAI_TTS_VOICES,
  fetchVoices,
} from '../../lib/providers/assemblyai/utils';
import { defineReference } from '../../utils';

const PREFIX = 'AssemblyAITTS:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], () => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadVoices(apiKey.value, region.value);
  }, 500);
});
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);
const voiceId = defineReference<string>(`${PREFIX}VoiceId`, DEFAULT_VOICE_ID);
const language = defineReference<string>(`${PREFIX}Language`, '');
const region = defineReference<'us' | 'eu'>(
  `${PREFIX}Region`,
  DEFAULT_REGION,
  ['us', 'eu'],
  value => {
    void loadVoices(apiKey.value, value);
  },
);
const voices = ref<{ name: string; id: string }[]>(ASSEMBLYAI_TTS_VOICES.map(v => ({ ...v })));
const voicesLoading = ref(false);

async function loadVoices(key: string, selectedRegion: 'us' | 'eu') {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices(key, selectedRegion);
    voices.value = fetched;
    if (!fetched.some(v => v.id === voiceId.value)) {
      const fallback = fetched.find(v => v.id === DEFAULT_VOICE_ID) ?? fetched[0];
      voiceId.value = fallback?.id ?? DEFAULT_VOICE_ID;
    }
  } catch (error) {
    console.error('Failed to fetch AssemblyAI TTS voices:', error);
    voices.value = ASSEMBLYAI_TTS_VOICES.map(v => ({ ...v }));
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): AssemblyAITTSOptions {
  if (!apiKey.value) {
    throw new Error('AssemblyAI TTS API key is required');
  }

  return {
    apiKey: apiKey.value,
    model: model.value,
    voiceId: voiceId.value,
    language: language.value || undefined,
    region: region.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'AssemblyAITTSSettings' });

onMounted(() => {
  void loadVoices(apiKey.value, region.value);
});
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="AssemblyAI TTS API Key"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="region"
        :items="ASSEMBLYAI_TTS_REGIONS"
        item-title="title"
        item-value="value"
        label="AssemblyAI Region"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="model"
        label="AssemblyAI TTS Model"
        placeholder="assemblyai-tts-1"
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
        label="AssemblyAI TTS Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="language"
        label="Language (optional, e.g. english)"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
