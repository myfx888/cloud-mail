<template>
  <el-dialog v-model="visible" :title="$t('mailboxMembers')" :width="isMobile ? '95%' : 560" @closed="onClosed">
    <el-table :data="members" size="small" v-loading="loading">
      <el-table-column prop="userEmail" :label="$t('member')" />
      <el-table-column :label="$t('role')" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.isCreator" type="warning" size="small">{{ $t('owner') }}</el-tag>
          <el-tag v-else size="small">{{ $t('member') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" :label="$t('joinTime')" width="180" />
    </el-table>
    <template #footer>
      <el-button v-if="canLeave" type="danger" plain @click="onLeave">{{ $t('leaveMailbox') }}</el-button>
      <el-button @click="visible = false">{{ $t('close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { mailboxMembers, mailboxLeave } from '@/request/account.js'
import { useUserStore } from '@/store/user.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({ accountId: { type: Number, default: 0 } })
const emit = defineEmits(['left'])
const userStore = useUserStore()
const visible = ref(false)
const loading = ref(false)
const members = ref([])
const isMobile = ref(window.innerWidth < 767)

const me = computed(() => userStore.user?.userId)
const canLeave = computed(() => members.value.some(m => m.userId === me.value && !m.isCreator))

async function open() {
  visible.value = true
  loading.value = true
  try {
    members.value = await mailboxMembers(props.accountId)
  } finally {
    loading.value = false
  }
}
function onClosed() {
  members.value = []
}
async function onLeave() {
  try {
    await mailboxLeave(props.accountId)
    ElMessage.success(t('leaveMailbox'))
    visible.value = false
    emit('left')
  } catch (e) {
    ElMessage.error(e.message || t('leaveMailbox'))
  }
}
defineExpose({ open })
</script>
