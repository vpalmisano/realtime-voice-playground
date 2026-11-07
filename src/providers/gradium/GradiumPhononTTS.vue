<script lang="ts">
import {
  DEFAULT_QUANT,
  DEFAULT_VOICE_ID,
  PHONON_DEVICES,
  PHONON_QUANTS,
  type GradiumPhononTTSOptions,
  type PhononDevice,
  type PhononQuant,
} from '../../lib/providers/gradium/phonon-tts';
import { PHONON_VOICES } from '../../lib/providers/gradium/phonon-voices';
import { defineReference } from '../../utils';

const PREFIX = 'GradiumPhononTTS:';

const voiceIds = PHONON_VOICES.map(v => v.id);
const voiceId = defineReference<string>(`${PREFIX}VoiceId`, DEFAULT_VOICE_ID, voiceIds);
const quant = defineReference<PhononQuant>(`${PREFIX}Quant`, DEFAULT_QUANT, [...PHONON_QUANTS]);
const device = defineReference<PhononDevice>(`${PREFIX}Device`, 'auto', [...PHONON_DEVICES]);

export function getOptions(): GradiumPhononTTSOptions {
  return {
    voiceId: voiceId.value,
    quant: quant.value,
    device: device.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'GradiumPhononTTSSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Gradium Phonon runs on-device. Please wait for the model download to finish (~65&nbsp;MB q8
        / ~103&nbsp;MB f32).
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="voiceId"
        :items="[...PHONON_VOICES]"
        item-title="name"
        item-value="id"
        label="Phonon Voice"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="quant"
        :items="[...PHONON_QUANTS]"
        label="Quant"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="device"
        :items="[...PHONON_DEVICES]"
        label="Device"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
