<template>
  <div class="ai-chat-panel">
    <!-- Empty state -->
    <div v-if="!aiStore.messages.length && !aiStore.isStreaming" class="empty-state">
      <div class="robot-icon">🤖</div>
      <p class="intro">I'm your email assistant. I can read, search, draft, and manage your emails.</p>
      <div class="suggestions">
        <el-button v-for="s in suggestions" :key="s" size="small" @click="sendSuggestion(s)" round>
          {{ s }}
        </el-button>
      </div>
    </div>

    <!-- Messages -->
    <el-scrollbar ref="scrollRef" class="messages-area" v-show="aiStore.messages.length || aiStore.isStreaming">
      <div class="messages-inner" ref="messagesRef">
        <AiMessageBubble v-for="(msg, i) in aiStore.messages" :key="i" :msg="msg" />
        <!-- Streaming message -->
        <div v-if="aiStore.isStreaming" class="message-bubble assistant">
          <div class="bubble assistant-bubble">
            <div v-if="aiStore.streamingToolCalls.length" class="tool-calls">
              <AiToolCallBadge
                v-for="(tc, i) in aiStore.streamingToolCalls" :key="i"
                :name="tc.name" :status="tc.status"
              />
            </div>
            <div v-if="aiStore.streamingContent" class="content" v-html="renderMarkdown(aiStore.streamingContent)"></div>
            <span v-else class="typing-indicator">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </span>
          </div>
        </div>
      </div>
    </el-scrollbar>

    <AiInputBar
      :is-streaming="aiStore.isStreaming"
      @send="onSend"
      @stop="aiStore.stopStreaming()"
    />
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { useAiStore } from '@/store/ai.js'
import AiMessageBubble from './AiMessageBubble.vue'
import AiToolCallBadge from './AiToolCallBadge.vue'
import AiInputBar from './AiInputBar.vue'

const aiStore = useAiStore()
const scrollRef = ref(null)
const messagesRef = ref(null)

const suggestions = [
  'Show my latest emails',
  'Find unread emails',
  'Draft a new email'
]

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

function onSend(text) {
  aiStore.sendMessage(text)
  scrollToBottom()
}

function sendSuggestion(s) {
  aiStore.sendMessage(s)
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.setScrollTop(999999)
    }
  })
}

watch(() => aiStore.streamingContent, scrollToBottom)
watch(() => aiStore.messages.length, scrollToBottom)
</script>

<style scoped>
.ai-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}
.robot-icon { font-size: 48px; margin-bottom: 12px; }
.intro { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 16px; max-width: 260px; }
.suggestions { display: flex; flex-direction: column; gap: 6px; }

.messages-area { flex: 1; min-height: 0; }
.messages-inner { padding: 12px; }

.typing-indicator { display: inline-flex; gap: 3px; padding: 4px 0; }
.dot {
  width: 6px; height: 6px;
  background: var(--el-text-color-secondary);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}
.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.message-bubble { display: flex; margin: 8px 0; }
.message-bubble.assistant { justify-content: flex-start; }
.bubble { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-break: break-word; }
.assistant-bubble { background: var(--el-fill-color); color: var(--el-text-color-primary); border-bottom-left-radius: 4px; }
.tool-calls { margin-bottom: 6px; display: flex; flex-wrap: wrap; }
.content :deep(pre) { background: var(--el-fill-color-darker); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 4px 0; }
.content :deep(code) { background: var(--el-fill-color-dark); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.content :deep(pre code) { background: none; padding: 0; }
</style>
