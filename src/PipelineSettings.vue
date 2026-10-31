<script lang="ts">
import { defineReference } from './utils';

const STT_PROVIDERS = ['ElevenLabs', 'Google', 'OpenAI'] as const;
const LLM_PROVIDERS = ['Google', 'OpenAI'] as const;
const TTS_PROVIDERS = ['Cartesia', 'ElevenLabs', 'Google', 'OpenAI', 'Speechify'] as const;

const sttProvider = defineReference('Pipeline:SttProvider', 'ElevenLabs', STT_PROVIDERS);
const llmProvider = defineReference('Pipeline:LlmProvider', 'OpenAI', LLM_PROVIDERS);
const ttsProvider = defineReference('Pipeline:TtsProvider', 'ElevenLabs', TTS_PROVIDERS);

export function getSttProvider(): (typeof STT_PROVIDERS)[number] {
  return sttProvider.value;
}

export function getLlmProvider(): (typeof LLM_PROVIDERS)[number] {
  return llmProvider.value;
}

export function getTtsProvider(): (typeof TTS_PROVIDERS)[number] {
  return ttsProvider.value;
}
</script>

<script setup lang="ts">
import { ref } from 'vue';
import ElevenLabsSTTSettings from './providers/elevenlabs/ElevenLabsSTT.vue';
import GoogleSTTSettings from './providers/google/GoogleSTT.vue';
import OpenaiSTTSettings from './providers/openai/OpenaiSTT.vue';
import GradiumSTTSettings from './providers/gradium/GradiumSTT.vue';
import OpenaiLLMSettings from './providers/openai/OpenaiLLM.vue';
import GoogleLLMSettings from './providers/google/GoogleLLM.vue';
import ElevenLabsTTSSettings from './providers/elevenlabs/ElevenLabsTTS.vue';
import GoogleTTSSettings from './providers/google/GoogleTTS.vue';
import OpenaiTTSSettings from './providers/openai/OpenaiTTS.vue';
import SpeechifyTTSSettings from './providers/speechify/SpeechifyTTS.vue';
import CartesiaTTSSettings from './providers/cartesia/CartesiaTTS.vue';
import GradiumTTSSettings from './providers/gradium/GradiumTTS.vue';

const step = ref('1');
</script>

<template>
  <v-stepper v-model="step" editable hide-actions flat>
    <v-stepper-header>
      <v-stepper-item :title="`${sttProvider} STT`" value="1" />
      <v-divider />
      <v-stepper-item :title="`${llmProvider} LLM`" value="2" />
      <v-divider />
      <v-stepper-item :title="`${ttsProvider} TTS`" value="3" />
    </v-stepper-header>

    <v-stepper-window>
      <v-stepper-window-item value="1">
        <v-row class="pt-2">
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="sttProvider"
              :items="[...STT_PROVIDERS]"
              label="STT Provider"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
        </v-row>
        <ElevenLabsSTTSettings v-if="sttProvider === 'ElevenLabs'" />
        <GoogleSTTSettings v-else-if="sttProvider === 'Google'" />
        <OpenaiSTTSettings v-else-if="sttProvider === 'OpenAI'" />
        <GradiumSTTSettings v-else />
      </v-stepper-window-item>

      <v-stepper-window-item value="2">
        <v-row class="pt-2">
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="llmProvider"
              :items="[...LLM_PROVIDERS]"
              label="LLM Provider"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
        </v-row>
        <OpenaiLLMSettings v-if="llmProvider === 'OpenAI'" />
        <GoogleLLMSettings v-else />
      </v-stepper-window-item>

      <v-stepper-window-item value="3">
        <v-row class="pt-2">
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="ttsProvider"
              :items="[...TTS_PROVIDERS]"
              label="TTS Provider"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
        </v-row>
        <ElevenLabsTTSSettings v-if="ttsProvider === 'ElevenLabs'" />
        <GoogleTTSSettings v-else-if="ttsProvider === 'Google'" />
        <OpenaiTTSSettings v-else-if="ttsProvider === 'OpenAI'" />
        <SpeechifyTTSSettings v-else-if="ttsProvider === 'Speechify'" />
        <CartesiaTTSSettings v-else-if="ttsProvider === 'Cartesia'" />
        <GradiumTTSSettings v-else />
      </v-stepper-window-item>
    </v-stepper-window>
  </v-stepper>
</template>
