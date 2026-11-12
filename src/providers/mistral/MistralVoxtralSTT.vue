<script lang="ts">
import {
  DEFAULT_MAX_NEW_TOKENS,
  DEFAULT_TURN_FLUSH_MS,
  VOXTRAL_DEVICES,
  type MistralVoxtralSTTOptions,
  type VoxtralDevice,
} from '../../lib/providers/mistral/stt';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'MistralVoxtralSTT:';

const device = defineReference<VoxtralDevice>(`${PREFIX}Device`, 'webgpu', [...VOXTRAL_DEVICES]);
const maxNewTokens = defineReference<number>(`${PREFIX}MaxNewTokens`, DEFAULT_MAX_NEW_TOKENS);
const turnFlushMs = defineReference<number>(`${PREFIX}TurnFlushMs`, DEFAULT_TURN_FLUSH_MS);

export function getOptions(): MistralVoxtralSTTOptions {
  return {
    device: device.value,
    maxNewTokens: maxNewTokens.value,
    turnFlushMs: turnFlushMs.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
defineOptions({ name: 'MistralVoxtralSTTSettings' });
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Model runs on-device via
        <a
          href="https://huggingface.co/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX"
          target="_blank"
          rel="noopener noreferrer"
          >Transformers.js</a
        >. First load downloads ~2.6&nbsp;GB (cached afterwards). Language is auto-detected.
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="device"
        :items="[...VOXTRAL_DEVICES]"
        label="Device"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="maxNewTokens"
        label="Max New Tokens"
        type="number"
        min="256"
        max="8192"
        step="256"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model.number="turnFlushMs"
        label="Turn Flush Delay (ms)"
        type="number"
        min="0"
        max="3000"
        step="50"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
