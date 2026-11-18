<script lang="ts">
import { ref } from 'vue';
import {
  DEFAULT_MODEL,
  DEFAULT_PROJECT,
  DEFAULT_TURN_TAKING,
  DEFAULT_VOICE,
  type PhonicRealtimeOptions,
} from '../../lib/providers/phonic/realtime';
import {
  fetchAgents,
  fetchVoices,
  PHONIC_FALLBACK_VOICES,
  PHONIC_MODELS,
  PHONIC_TURN_TAKING,
} from '../../lib/providers/phonic/utils';
import { DEFAULT_CONTEXT } from '../../lib/providers/base';
import { chunkMs } from '../../PerfSettings.vue';
import { defineReference } from '../../utils';

const PREFIX = 'PhonicRealtime:';

let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const apiKey = defineReference<string>(`${PREFIX}ApiKey`, '', [], v => {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    void loadVoices(v);
    void loadAgents(v);
  }, 500);
});

const models = ref<string[]>([...PHONIC_MODELS]);
const model = defineReference<string>(`${PREFIX}Model`, DEFAULT_MODEL, [...PHONIC_MODELS]);

const voices = ref<{ id: string; name: string }[]>(
  PHONIC_FALLBACK_VOICES.map(id => ({ id, name: id })),
);
const voicesLoading = ref(false);
const voice = defineReference<string>(`${PREFIX}Voice`, DEFAULT_VOICE);

const agents = ref<string[]>(['']);
const agentsLoading = ref(false);
const agent = defineReference<string>(`${PREFIX}Agent`, '');
const project = defineReference<string>(`${PREFIX}Project`, DEFAULT_PROJECT);
const context = defineReference(`${PREFIX}Context`, DEFAULT_CONTEXT);
const turnTaking = defineReference(`${PREFIX}TurnTaking`, DEFAULT_TURN_TAKING, [
  ...PHONIC_TURN_TAKING,
]);

async function loadVoices(key: string) {
  voicesLoading.value = true;
  try {
    const fetched = await fetchVoices(key);
    voices.value = fetched;
    if (!fetched.some(v => v.id === voice.value)) {
      const fallback = fetched.find(v => v.id === DEFAULT_VOICE) ?? fetched[0];
      voice.value = fallback?.id ?? DEFAULT_VOICE;
    }
  } catch (error) {
    console.error('Failed to fetch Phonic voices:', error);
    voices.value = PHONIC_FALLBACK_VOICES.map(id => ({ id, name: id }));
  } finally {
    voicesLoading.value = false;
  }
}

async function loadAgents(key: string) {
  agentsLoading.value = true;
  try {
    agents.value = ['', ...(await fetchAgents(key, project.value || DEFAULT_PROJECT))];
  } catch (error) {
    console.error('Failed to fetch Phonic agents:', error);
    agents.value = [''];
  } finally {
    agentsLoading.value = false;
  }
}

export function getOptions(): PhonicRealtimeOptions {
  if (!apiKey.value) {
    throw new Error('Phonic API key is required');
  }
  return {
    apiKey: apiKey.value,
    model: model.value,
    voice: voice.value,
    agent: agent.value || undefined,
    project: project.value || DEFAULT_PROJECT,
    context: context.value || undefined,
    turnTaking: turnTaking.value,
    chunkMs: chunkMs.value,
  };
}
</script>

<script setup lang="ts">
import { onMounted, watch } from 'vue';

defineOptions({ name: 'PhonicSettings' });

onMounted(() => {
  void loadVoices(apiKey.value);
  void loadAgents(apiKey.value);
});

watch(project, () => {
  void loadAgents(apiKey.value);
});
</script>

<template>
  <v-row class="pa-4">
    <v-col cols="12">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-0">
        Phonic Realtime requires a browser CORS extension. Install and enable
        <a
          href="https://mybrowseraddon.com/access-control-allow-origin.html"
          target="_blank"
          rel="noopener noreferrer"
          >Access-Control-Allow-Origin</a
        >
        to use this provider.
      </v-alert>
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="apiKey"
        label="Phonic API Key"
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
        label="Model"
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
      <v-combobox
        v-model="agent"
        :items="agents"
        :loading="agentsLoading"
        label="Agent (optional, leave empty for agentless)"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-text-field
        v-model="project"
        label="Project"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-select
        v-model="turnTaking"
        :items="[...PHONIC_TURN_TAKING]"
        label="Turn taking"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col cols="12" md="6" lg="4">
      <v-textarea
        v-model="context"
        label="Context (system prompt)"
        variant="outlined"
        rows="1"
        hide-details
      />
    </v-col>
  </v-row>
</template>

<style scoped></style>
