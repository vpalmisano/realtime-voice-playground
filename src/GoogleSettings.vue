<script lang="ts">
import { defineReference } from './lib/utils';
import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  MODELS,
  VOICES,
  type GoogleSessionOptions,
} from './lib/google';
import { DEFAULT_CONTEXT } from './lib/provider';

const apiKey = defineReference('googleApiKey', '');
const model = defineReference('googleModel', DEFAULT_MODEL, MODELS);
const voice = defineReference('googleVoice', DEFAULT_VOICE, VOICES);
const context = defineReference('googleContext', DEFAULT_CONTEXT);

export function getSessionOptions(): GoogleSessionOptions {
  if (!apiKey.value) {
    throw new Error('Google API key is required');
  }
  return {
    model: model.value,
    voice: voice.value,
    apiKey: apiKey.value,
    context: context.value || undefined,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'GoogleSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Google API Key"
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
  </v-row>
</template>

<style scoped></style>
