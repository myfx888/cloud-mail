<template>
  <div class="tool-badge" :class="status">
    <span class="tool-icon">{{ toolIcon }}</span>
    <span class="tool-name">{{ displayName }}</span>
    <el-icon v-if="status === 'done'" class="status-icon"><Check /></el-icon>
    <el-icon v-else-if="status === 'error'" class="status-icon error"><CloseBold /></el-icon>
    <el-icon v-else class="status-icon loading"><Loading /></el-icon>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Check, CloseBold, Loading } from '@element-plus/icons-vue'

const props = defineProps({
  name: { type: String, required: true },
  status: { type: String, default: 'running' }
})

const TOOL_ICONS = {
  list_emails: '📧', get_email: '👁', get_thread: '🔗',
  search_emails: '🔍', draft_reply: '✏️', draft_email: '✏️',
  mark_email_read: '✅', summarize_email: '📋', translate_email: '🌐',
  move_email: '📁', discard_draft: '🗑️'
}

const TOOL_NAMES = {
  list_emails: 'List Emails', get_email: 'Read Email', get_thread: 'Get Thread',
  search_emails: 'Search', draft_reply: 'Draft Reply', draft_email: 'Draft Email',
  mark_email_read: 'Mark Read', summarize_email: 'Summarize', translate_email: 'Translate',
  move_email: 'Move Email', discard_draft: 'Discard Draft'
}

const toolIcon = computed(() => TOOL_ICONS[props.name] || '🔧')
const displayName = computed(() => TOOL_NAMES[props.name] || props.name)
</script>

<style scoped>
.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  margin: 2px 4px 2px 0;
}
.tool-badge.done { background: var(--el-color-success-light-9); }
.tool-badge.error { background: var(--el-color-danger-light-9); }
.tool-icon { font-size: 12px; }
.tool-name { font-weight: 500; }
.status-icon { font-size: 12px; margin-left: 2px; }
.status-icon.error { color: var(--el-color-danger); }
.status-icon.loading { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
