<template>
  <div class="tool-badge" :class="status">
    <span class="tool-icon">{{ toolIcon }}</span>
    <span class="tool-name">{{ displayName }}</span>
    <Icon v-if="status === 'done'" icon="ep:check" class="status-icon" />
    <Icon v-else-if="status === 'error'" icon="ep:close-bold" class="status-icon error" />
    <Icon v-else icon="ep:loading" class="status-icon loading" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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

const TOOL_I18N_KEYS = {
  list_emails: 'aiToolListEmails', get_email: 'aiToolGetEmail', get_thread: 'aiToolGetThread',
  search_emails: 'aiToolSearch', draft_reply: 'aiToolDraftReply', draft_email: 'aiToolDraftEmail',
  mark_email_read: 'aiToolMarkRead', summarize_email: 'aiToolSummarize', translate_email: 'aiToolTranslate',
  move_email: 'aiToolMoveEmail', discard_draft: 'aiToolDiscardDraft'
}

const toolIcon = computed(() => TOOL_ICONS[props.name] || '🔧')
const displayName = computed(() => {
  const key = TOOL_I18N_KEYS[props.name]
  return key ? t(key) : props.name
})
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
