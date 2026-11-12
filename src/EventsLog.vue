<script lang="ts">
import { nextTick, ref } from 'vue';

export const events = ref('');
export const eventsField = ref<{ $el?: HTMLElement } | null>(null);
export let startTime = 0;

export function setStartTime(value: number) {
  startTime = value;
}

function scrollToBottom() {
  const root = eventsField.value?.$el;
  const textarea = root instanceof HTMLTextAreaElement ? root : root?.querySelector?.('textarea');
  if (textarea) {
    textarea.scrollTop = textarea.scrollHeight;
  }
}

export function appendMessage(text: string) {
  const ts = startTime > 0 ? Math.round(performance.now() - startTime) / 1000 : 0;
  events.value += `${ts > 0 ? `[${ts}] ` : ''}${text}\n`;
  nextTick().then(() => requestAnimationFrame(scrollToBottom));
}
</script>

<script setup lang="ts">
defineOptions({ name: 'EventsLog' });
</script>

<template>
  <v-textarea
    ref="eventsField"
    v-model="events"
    label="Events"
    variant="outlined"
    rows="10"
    readonly
    hide-details
    class="events-log mb-4"
  />
</template>

<style scoped>
.events-log :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
}
</style>
