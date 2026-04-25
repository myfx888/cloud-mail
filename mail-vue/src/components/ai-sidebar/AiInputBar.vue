<template>
  <div class="ai-input-bar">
    <div class="input-row">
      <el-input
        ref="inputRef"
        v-model="text"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="Ask your email assistant..."
        @keydown.enter.exact.prevent="send"
        :disabled="isStreaming"
      />
      <el-button
        v-if="isStreaming"
        type="danger"
        circle
        size="small"
        @click="$emit('stop')"
        class="send-btn"
      >
        <Icon icon="ep:video-pause" />
      </el-button>
      <el-button
        v-else
        type="primary"
        circle
        size="small"
        @click="send"
        :disabled="!text.trim()"
        class="send-btn"
      >
        <Icon icon="ep:promotion" />
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'

const props = defineProps({
  isStreaming: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'stop'])
const text = ref('')
const inputRef = ref(null)

function send() {
  if (!text.value.trim() || props.isStreaming) return
  emit('send', text.value)
  text.value = ''
}

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style scoped>
.ai-input-bar {
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.input-row :deep(.el-textarea__inner) {
  resize: none;
  padding-right: 8px;
}
.send-btn { flex-shrink: 0; }
</style>
