<script lang="ts">
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  MODELS,
  VOICES,
  type ElevenLabsSessionOptions,
} from './lib/elevenlabs';
import { buildTurnDetection, EAGERNESS_OPTIONS, TURN_DETECTION_TYPES } from './lib/openai';
import { DEFAULT_CONTEXT } from './lib/provider';
import { defineReference } from './lib/utils';

const apiKey = defineReference('elevenLabsApiKey', '');
const model = defineReference('elevenLabsModel', DEFAULT_MODEL, MODELS);
const voice = defineReference('elevenLabsVoice', DEFAULT_VOICE, VOICES);
const context = defineReference('elevenLabsContext', DEFAULT_CONTEXT);
const turnDetectionType = defineReference(
  'elevenLabsTurnDetectionType',
  'semantic_vad',
  TURN_DETECTION_TYPES,
);
const eagerness = defineReference('elevenLabsEagerness', 'medium', EAGERNESS_OPTIONS);
const threshold = defineReference('elevenLabsThreshold', 0.5);
const prefixPaddingMs = defineReference('elevenLabsPrefixPaddingMs', 300);
const silenceDurationMs = defineReference('elevenLabsSilenceDurationMs', 500);

export function getSessionOptions(): ElevenLabsSessionOptions {
  if (!apiKey.value) {
    throw new Error('ElevenLabs API key is required');
  }
  return {
    model: model.value,
    voice: voice.value,
    apiKey: apiKey.value,
    context: context.value || undefined,
    turnDetection: buildTurnDetection({
      type: turnDetectionType.value,
      eagerness: eagerness.value,
      threshold: threshold.value,
      prefixPaddingMs: prefixPaddingMs.value,
      silenceDurationMs: silenceDurationMs.value,
    }),
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'ElevenLabsSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="ElevenLabs API Key"
        type="password"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="model"
        :items="[...MODELS]"
        label="Model"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="voice"
        :items="[...VOICES]"
        label="Voice"
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
