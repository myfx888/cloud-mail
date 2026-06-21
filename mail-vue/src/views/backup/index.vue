<template>
  <div class="backup-page">
    <el-tabs v-model="activeTab" class="backup-tabs">
      <el-tab-pane :label="$t('backupTab')" name="backup">
        <el-card shadow="never">
          <el-form inline>
            <el-form-item :label="$t('includeConfig')">
              <el-switch v-model="form.includeConfig" />
            </el-form-item>
            <el-form-item :label="$t('includeSecrets')" v-if="form.includeConfig">
              <el-switch v-model="form.includeSecrets" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="backupRunning" @click="onCreateBackup">
                {{ $t('createBackup') }}
              </el-button>
            </el-form-item>
          </el-form>

          <div v-if="backupTask">
            <el-progress :percentage="backupPercent" :status="progressStatus(backupTask.status)" />
            <span class="progress-text">
              {{ $t('backupProgress') }}：{{ backupTask.processed }} / {{ backupTask.total }}
              <el-button v-if="backupTask.status === 'processing'" link type="danger" @click="onCancel(backupTask.taskId)">
                {{ $t('cancelTask') }}
              </el-button>
            </span>
          </div>
        </el-card>

        <el-card shadow="never" class="mt">
          <template #header>{{ $t('backupHistory') }}</template>
          <el-table :data="backupList" v-loading="loadingBackups" border>
            <el-table-column prop="taskId" label="ID" width="70" />
            <el-table-column :label="$t('createdAt')" width="200">
              <template #default="{ row }">{{ row.createTime }}</template>
            </el-table-column>
            <el-table-column :label="$t('backupProgress')">
              <template #default="{ row }">
                {{ row.processed }} / {{ row.total }} ({{ row.status }})
              </template>
            </el-table-column>
            <el-table-column :label="$t('ops')" width="220">
              <template #default="{ row }">
                <el-button size="small" :disabled="row.status !== 'completed'" @click="onDownload(row.taskId)">
                  {{ $t('download') }}
                </el-button>
                <el-popconfirm :title="$t('confirmDeleteBackup')" @confirm="onDelete(row.taskId)">
                  <template #reference>
                    <el-button size="small" type="danger">{{ $t('delete') }}</el-button>
                  </template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="$t('restoreTab')" name="restore">
        <el-card shadow="never">
          <el-upload
            drag
            multiple
            :auto-upload="true"
            :http-request="customUpload"
            :show-file-list="false"
            accept=".eml,.mbox">
            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
            <div class="el-upload__text">{{ $t('uploadFiles') }}</div>
            <template #tip>
              <div class="el-upload__tip">{{ $t('uploadHint') }}</div>
            </template>
          </el-upload>

          <div v-if="sourceKeys.length" class="mt">
            {{ $t('backupFileCount') }}：{{ sourceKeys.length }}
            <el-button link @click="sourceKeys = []">{{ $t('clear') }}</el-button>
          </div>

          <el-form inline class="mt">
            <el-form-item :label="$t('restoreMode')">
              <el-radio-group v-model="restoreMode">
                <el-radio value="import">{{ $t('modeImport') }}</el-radio>
                <el-radio value="restore">{{ $t('modeRestore') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :disabled="!sourceKeys.length || restoreRunning" @click="onStartRestore">
                {{ $t('startRestore') }}
              </el-button>
            </el-form-item>
          </el-form>

          <div v-if="restoreTask">
            <el-progress :percentage="restorePercent" :status="progressStatus(restoreTask.status)" />
            <span class="progress-text">
              {{ $t('imported') }}：{{ restoreTask.processed }}
              · {{ $t('skipped') }}：{{ restoreTask.skipped }}
              · {{ $t('failedCount') }}：{{ restoreTask.failed }}
              <el-button v-if="restoreTask.status === 'processing'" link type="danger" @click="onCancel(restoreTask.taskId)">
                {{ $t('cancelTask') }}
              </el-button>
            </span>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import {
  backupCreate, backupProcess, fetchBackupList, backupDownload, backupDelete,
  restoreUpload, restoreCreate, restoreProcess, cancelTask
} from '@/request/backup.js'

const { t } = useI18n()
const activeTab = ref('backup')

const form = ref({ includeConfig: true, includeSecrets: false })
const backupTask = ref(null)
const backupList = ref([])
const loadingBackups = ref(false)
const backupRunning = computed(() => backupTask.value?.status === 'processing')
const backupPercent = computed(() => {
  const tk = backupTask.value
  if (!tk || !tk.total) return 0
  return Math.min(100, Math.round((tk.processed / tk.total) * 100))
})
let backupTimer = null

async function loadBackups() {
  loadingBackups.value = true
  try { backupList.value = await fetchBackupList() } finally { loadingBackups.value = false }
}

async function onCreateBackup() {
  const task = await backupCreate({
    scope: 'all',
    includeConfig: form.value.includeConfig,
    includeSecrets: form.value.includeSecrets,
    schedule: 'once'
  })
  backupTask.value = task
  startBackupPolling()
}

function startBackupPolling() {
  stopBackupPolling()
  backupTimer = setInterval(async () => {
    try {
      const tk = await backupProcess(backupTask.value.taskId)
      backupTask.value = tk
      await loadBackups()
      if (tk.status === 'completed' || tk.status === 'failed' || tk.status === 'cancelled') {
        stopBackupPolling()
        if (tk.status === 'completed') ElMessage.success(t('completedStatus'))
      }
    } catch (e) { stopBackupPolling() }
  }, 1500)
}
function stopBackupPolling() { if (backupTimer) { clearInterval(backupTimer); backupTimer = null } }

async function onDownload(taskId) {
  const blob = await backupDownload(taskId)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `backup-${taskId}.tar`; a.click()
  URL.revokeObjectURL(url)
}
async function onDelete(taskId) {
  await backupDelete(taskId)
  ElMessage.success(t('delete'))
  await loadBackups()
}

const sourceKeys = ref([])
const restoreMode = ref('import')
const restoreTask = ref(null)
const restoreRunning = computed(() => restoreTask.value?.status === 'processing')
const restorePercent = computed(() => {
  const tk = restoreTask.value
  if (!tk) return 0
  const done = tk.processed + tk.skipped + tk.failed
  if (!tk.total) return Math.min(99, done * 5)
  return Math.min(100, Math.round((done / tk.total) * 100))
})
let restoreTimer = null

async function customUpload({ file, onSuccess, onError }) {
  try {
    const fd = new FormData()
    fd.append('files', file, file.name)
    const res = await restoreUpload(fd)
    sourceKeys.value.push(...(res.sourceKeys || []))
    if (onSuccess) onSuccess(res)
  } catch (e) { if (onError) onError(e) }
}

async function onStartRestore() {
  const task = await restoreCreate(sourceKeys.value, restoreMode.value, 'skip')
  restoreTask.value = task
  startRestorePolling()
}
function startRestorePolling() {
  stopRestorePolling()
  restoreTimer = setInterval(async () => {
    try {
      const tk = await restoreProcess(restoreTask.value.taskId)
      restoreTask.value = tk
      if (tk.status === 'completed' || tk.status === 'failed' || tk.status === 'cancelled') {
        stopRestorePolling()
        if (tk.status === 'completed') ElMessage.success(`${t('imported')} ${tk.processed} · ${t('skipped')} ${tk.skipped} · ${t('failedCount')} ${tk.failed}`)
      }
    } catch (e) { stopRestorePolling() }
  }, 1500)
}
function stopRestorePolling() { if (restoreTimer) { clearInterval(restoreTimer); restoreTimer = null } }

async function onCancel(taskId) {
  await cancelTask(taskId)
  ElMessage.success(t('cancelledStatus'))
}
function progressStatus(status) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'exception'
  return ''
}

onMounted(() => { loadBackups() })
onUnmounted(() => { stopBackupPolling(); stopRestorePolling() })
</script>

<style scoped>
.backup-page { padding: 16px; }
.backup-tabs { max-width: 1000px; }
.mt { margin-top: 16px; }
.progress-text { margin-left: 12px; font-size: 13px; color: var(--el-text-color-secondary); }
</style>
