<script lang="ts">
import { nextTick, ref } from 'vue';

export const messages = ref('');
export const messagesField = ref<{ $el?: HTMLElement } | null>(null);
export let startTime = 0;

export function setStartTime(value: number) {
  startTime = value;
}

function scrollToBottom() {
  const root = messagesField.value?.$el;
  const textarea = root instanceof HTMLTextAreaElement ? root : root?.querySelector?.('textarea');
  if (textarea) {
    textarea.scrollTop = textarea.scrollHeight;
  }
}

export function appendMessage(text: string, type: 'user' | 'assistant') {
  messages.value += `${type === 'user' ? '[User] ' : '[Assistant] '}${text.trim()}\n`;
  nextTick().then(() => requestAnimationFrame(scrollToBottom));
}
</script>

<script setup lang="ts">
defineOptions({ name: 'TextLog' });
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
    class="messages-log mb-4"
  />
</template>

<style scoped>
.messages-log :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
}
</style>
