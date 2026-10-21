<script lang="ts">
import { nextTick, ref } from 'vue';

export const messages = ref('');
export const messagesField = ref<{ $el?: HTMLElement } | null>(null);
export let startTime = 0;

export function setStartTime(value: number) {
  startTime = value;
}

export async function appendMessage(text: string) {
  const ts = startTime > 0 ? Math.round(performance.now() - startTime) / 1000 : 0;
  messages.value += `${ts > 0 ? `[${ts}] ` : ''}${text}`;
  await nextTick();
  const textarea = messagesField.value?.$el?.querySelector('textarea');
  if (textarea) {
    textarea.scrollTop = textarea.scrollHeight;
  }
}
</script>

<script setup lang="ts">
defineOptions({ name: 'MessagesLog' });
</script>

<template>
  <v-textarea
    ref="messagesField"
    v-model="messages"
    label="Messages"
    variant="outlined"
    rows="10"
    readonly
    hide-details
    class="messages-log"
  />
</template>

<style scoped>
.messages-log :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
}
</style>
