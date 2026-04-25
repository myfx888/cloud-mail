<template>
  <div class="ai-sidebar" v-if="uiStore.aiSidebarOpen">
    <div class="sidebar-header">
      <div class="tabs">
        <button :class="{ active: tab === 'chat' }" @click="tab = 'chat'">🤖 AI</button>
      </div>
      <div class="header-actions">
        <el-button link size="small" @click="aiStore.clearMessages()" :disabled="aiStore.isStreaming">
          <Icon icon="ep:delete" width="16" height="16" />
        </el-button>
        <el-button link size="small" @click="uiStore.aiSidebarOpen = false">
          <Icon icon="ep:close" width="16" height="16" />
        </el-button>
      </div>
    </div>
    <div class="sidebar-body">
      <AiChatPanel v-if="tab === 'chat'" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useUiStore } from '@/store/ui.js'
import { useAiStore } from '@/store/ai.js'
import AiChatPanel from './AiChatPanel.vue'
import { Icon } from '@iconify/vue'

const uiStore = useUiStore()
const aiStore = useAiStore()
const tab = ref('chat')
</script>

<style scoped>
.ai-sidebar {
  width: 360px;
  min-width: 360px;
  height: 100%;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .ai-sidebar {
    position: fixed;
    right: 0;
    top: 0;
    z-index: 200;
    width: 100%;
    max-width: 400px;
    box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  }
}

@media (max-width: 767px) {
  .ai-sidebar {
    max-width: 100%;
    width: 100%;
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.tabs { display: flex; gap: 4px; }
.tabs button {
  padding: 4px 12px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}
.tabs button.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.header-actions { display: flex; gap: 2px; }

.sidebar-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
