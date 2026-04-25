<template>
  <div class="message-bubble" :class="msg.role">
    <div v-if="msg.role === 'user'" class="bubble user-bubble">
      {{ msg.content }}
    </div>
    <div v-else class="bubble assistant-bubble">
      <div v-if="msg.toolCalls && msg.toolCalls.length" class="tool-calls">
        <AiToolCallBadge v-for="(tc, i) in msg.toolCalls" :key="i" :name="tc.name" :status="tc.status" />
      </div>
      <div v-if="msg.isError" class="error-text">{{ msg.content }}</div>
      <div v-else-if="msg.content" class="content" v-html="renderedContent"></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AiToolCallBadge from './AiToolCallBadge.vue'

const props = defineProps({
  msg: { type: Object, required: true }
})

function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>')
  return html
}

const renderedContent = computed(() => renderMarkdown(props.msg.content))
</script>

<style scoped>
.message-bubble { display: flex; margin: 8px 0; }
.message-bubble.user { justify-content: flex-end; }
.message-bubble.assistant { justify-content: flex-start; }

.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.user-bubble {
  background: var(--el-color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.assistant-bubble {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border-bottom-left-radius: 4px;
}

.tool-calls { margin-bottom: 6px; display: flex; flex-wrap: wrap; }

.content :deep(pre) {
  background: var(--el-fill-color-darker);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 4px 0;
}
.content :deep(code) {
  background: var(--el-fill-color-dark);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.content :deep(pre code) { background: none; padding: 0; }
.error-text { color: var(--el-color-danger); font-style: italic; }
</style>
