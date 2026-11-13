<script lang="ts">
import { ref } from 'vue';
import {
  buildTurnDetection,
  DEFAULT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICE,
  EAGERNESS_OPTIONS,
  TRANSPORTS,
  TURN_DETECTION_TYPES,
  type InworldRealtimeOptions,
} from '../../lib/providers/inworld/realtime';
import {
  INWORLD_FALLBACK_VOICES,
  INWORLD_LLM_FALLBACK_MODELS,
  INWORLD_STT_MODELS,
  INWORLD_TTS_MODELS,
  fetchVoices,
} from '../../lib/providers/inworld/utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'InworldRealtime:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadVoices(v);
  }, 500);
});

const transport = defineReference(`${PREFIX}Transport`, 'webrtc', TRANSPORTS);

const models = ref<string[]>([...INWORLD_LLM_FALLBACK_MODELS]);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL);

const ttsModels = ref<string[]>([...INWORLD_TTS_MODELS]);
const ttsModel = defineReference<string>(`${PREFIX}TtsModel`, DEFAULT_TTS_MODEL, [
  ...INWORLD_TTS_MODELS,
]);

const transcriptionModels = ref<string[]>([...INWORLD_STT_MODELS]);
const transcriptionModel = defineReference<string>(
  `${PREFIX}TranscriptionModel`,
  DEFAULT_TRANSCRIPTION_MODEL,
  [...INWORLD_STT_MODELS],
);

const voices = ref<{ name: string; id: string }[]>(
  INWORLD_FALLBACK_VOICES.map(id => ({ name: id, id })),
);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const turnDetectionType = defineReference(
  `${PREFIX}TurnDetectionType`,
  'semantic_vad',
  TURN_DETECTION_TYPES,
);
const eagerness = defineReference(`${PREFIX}Eagerness`, 'high', EAGERNESS_OPTIONS);
const threshold = defineReference(`${PREFIX}Threshold`, 0.5);
const prefixPaddingMs = defineReference(`${PREFIX}PrefixPaddingMs`, 200);
const silenceDurationMs = defineReference(`${PREFIX}SilenceDurationMs`, 1000);

async function loadVoices(key: string) {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices(key);
    voices.value = fetched;
    if (!fetched.some(v => v.id === voice.value)) {
      const fallback =
        fetched.find(v => v.id === DEFAULT_VOICE) ??
        fetched.find(v => v.name === DEFAULT_VOICE) ??
        fetched[0];
      voice.value = fallback?.id ?? DEFAULT_VOICE;
    }
  } catch (error) {
    console.error('Failed to fetch Inworld voices:', error);
    voices.value = INWORLD_FALLBACK_VOICES.map(id => ({ name: id, id }));
  } finally {
    voicesLoading.value = false;
  }
}

export function getOptions(): InworldRealtimeOptions {
  if (!apiKey.value) {
    throw new Error('Inworld API key is required');
  }
  return {
    transportType: transport.value,
    model: model.value,
    voice: voice.value,
    ttsModel: ttsModel.value,
    transcriptionModel: transcriptionModel.value,
    apiKey: apiKey.value,
    context: context.value || undefined,
    turnDetection: buildTurnDetection({
      type: turnDetectionType.value,
      eagerness: eagerness.value,
      threshold: threshold.value,
      prefixPaddingMs: prefixPaddingMs.value,
      silenceDurationMs: silenceDurationMs.value,
    }),
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted } from 'vue';

defineOptions({ name: 'InworldSettings' });

onMounted(() => {
  void loadVoices(apiKey.value);
});
</script>

<template>
  <v-row class="pa-4">
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Inworld API Key (Basic Base64)"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="transport"
        :items="[...TRANSPORTS]"
        label="Transport"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-combobox
        v-model="model"
        :items="models"
        label="LLM model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="ttsModel"
        :items="ttsModels"
        label="TTS model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="voice"
        :items="voices"
        item-title="name"
        item-value="id"
        :loading="voicesLoading"
        label="Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="transcriptionModel"
        :items="transcriptionModels"
        label="Transcription model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Context (instructions)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>

    <v-col cols="12">
      <v-row density="compact">
        <v-col cols="12" md="6" lg="3">
          <v-select
            v-model="turnDetectionType"
            :items="[...TURN_DETECTION_TYPES]"
            label="Turn detection"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </v-col>
        <v-col v-if="turnDetectionType === 'semantic_vad'" cols="12" md="6" lg="3">
          <v-select
            v-model="eagerness"
            :items="[...EAGERNESS_OPTIONS]"
            label="Eagerness"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </v-col>
        <template v-else-if="turnDetectionType === 'server_vad'">
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="threshold"
              label="Threshold"
              type="number"
              step="0.01"
              min="0"
              max="1"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="prefixPaddingMs"
              label="Prefix padding (ms)"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="3">
            <v-text-field
              v-model.number="silenceDurationMs"
              label="Silence duration (ms)"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
        </template>
      </v-row>
    </v-col>
  </v-row>
</template>

<style scoped></style>
