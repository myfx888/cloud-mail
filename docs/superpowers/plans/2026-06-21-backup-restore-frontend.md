# 邮件备份恢复 — 前端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mail-vue 后台新增「备份恢复」页（管理员可见），支持系统整体备份（创建/历史/下载/删除/进度）与外部 EML/MBOX 多文件导入恢复（拖拽多文件上传/进度/报告）。

**Architecture:** 单页 `views/backup/index.vue` + `el-tabs` 分「备份」「恢复/导入」。API 封装于 `request/backup.js`；通过 `perm.js` 的 `routers`（permKey `backup:query`）动态注册路由与菜单，admin（permKeys 含 `*`）自动可见。批量靠前端轮询 `/process` 推进 + `/progress` 读取。下载 tar 走 blob（需 axios 拦截器兼容 Blob）。

**Tech Stack:** Vue3 (setup), Element Plus, Pinia, vue-i18n, axios。

**依赖:** 后端计划 `docs/superpowers/plans/2026-06-21-backup-restore-backend.md` 的 API 已实现。

**测试策略:** 前端无自动化测试设施，全部在 `pnpm --prefix mail-vue run dev` + `wrangler dev` 手动验证（见末尾清单）。

---

## File Map

**Create:**
- `mail-vue/src/request/backup.js` — API 封装
- `mail-vue/src/views/backup/index.vue` — 备份恢复页

**Modify:**
- `mail-vue/src/axios/index.js` — 响应拦截器兼容 Blob（下载）
- `mail-vue/src/perm/perm.js` — `routers` 加 `backup:query` 映射
- `mail-vue/src/i18n/zh.js` — 中文文案
- `mail-vue/src/i18n/en.js` — 英文文案

---

## Task 1: API 封装 request/backup.js

**Files:**
- Create: `mail-vue/src/request/backup.js`

- [ ] **Step 1: 实现**

`mail-vue/src/request/backup.js`:
```js
import http from '@/axios/index.js'

// ---- 备份 ----
export function backupCreate(params) {
	return http.post('/admin/backup/create', params)
}
export function backupProcess(taskId) {
	return http.post(`/admin/backup/${taskId}/process`)
}
export function backupProgress(taskId) {
	return http.get(`/admin/backup/${taskId}/progress`)
}
export function fetchBackupList() {
	return http.get('/admin/backup/list')
}
export function backupDownload(taskId) {
	return http.get(`/admin/backup/${taskId}/download`, { responseType: 'blob' })
}
export function backupDelete(taskId) {
	return http.delete(`/admin/backup/${taskId}`)
}

// ---- 恢复/导入 ----
export function restoreUpload(formData) {
	return http.post('/admin/restore/upload', formData)
}
export function restoreCreate(sourceKeys, mode, dedup) {
	return http.post('/admin/restore/create', { sourceKeys, mode, dedup })
}
export function restoreProcess(taskId) {
	return http.post(`/admin/restore/${taskId}/process`)
}
export function restoreProgress(taskId) {
	return http.get(`/admin/restore/${taskId}/progress`)
}
export function restoreTaskList(type) {
	return http.get('/admin/restore/task/list', { params: { type } })
}

// ---- 通用 ----
export function cancelTask(taskId) {
	return http.post(`/admin/backup-task/${taskId}/cancel`)
}
```

- [ ] **Step 2: Commit**
```bash
git add mail-vue/src/request/backup.js
git commit -m "feat(backup): add frontend api wrappers"
```

---

## Task 2: axios 拦截器兼容 Blob（下载 tar）

现有拦截器 `resolve(data.data)`，对 Blob 响应 `data.data` 为 undefined。在响应拦截最前加 Blob 直通。

**Files:**
- Modify: `mail-vue/src/axios/index.js`

- [ ] **Step 1: 改造**

`http.interceptors.response.use((res) => {` 内，将：
```js
        const noMsg = res.config.noMsg;
        const data = res.data
```
改为：
```js
        const data = res.data
        if (data instanceof Blob) {
            resolve(data)
            return
        }
        const noMsg = res.config.noMsg;
```

（即：先取 `res.data`，若是 Blob 直接 resolve 返回。）

- [ ] **Step 2: 冒烟验证**

`pnpm --prefix mail-vue run dev` 下，调用任意 blob 下载（Task 5 完成后联调）；确认不报错。

- [ ] **Step 3: Commit**
```bash
git add mail-vue/src/axios/index.js
git commit -m "fix(axios): passthrough Blob responses for binary downloads"
```

---

## Task 3: 路由映射 + i18n 文案

**Files:**
- Modify: `mail-vue/src/perm/perm.js`
- Modify: `mail-vue/src/i18n/zh.js`
- Modify: `mail-vue/src/i18n/en.js`

- [ ] **Step 1: perm.js 加 routers 映射**

在 `perm.js` 的 `routers` 对象内（与 `analysis:query` 等同级）新增：
```js
    'backup:query': [{
        path: '/backup',
        name: 'backup',
        component: () => import('@/views/backup/index.vue'),
        meta: {
            title: 'backupRestore',
            name: 'backup',
            menu: true
        }
    }],
```

> 说明：admin 的 `permKeys` 含 `*`，`permsToRouter` 会自动纳入该路由与菜单。非 admin 默认不可见，且后端 `isAdmin` 兜底拦截。如需对特定角色开放，再于后端 perm 表播种 `backup:query`（本期不做）。

- [ ] **Step 2: i18n 中文文案**

`zh.js` 末尾（`}` 之前）追加：
```js
    backupRestore: '备份恢复',
    backupTab: '系统备份',
    restoreTab: '邮件导入恢复',
    createBackup: '创建备份',
    includeConfig: '包含系统配置',
    includeSecrets: '包含凭据（密码/Token）',
    backupHistory: '历史备份',
    download: '下载',
    backupProgress: '备份进度',
    imported: '已导入',
    skipped: '已跳过',
    failedCount: '失败',
    processingStatus: '处理中',
    completedStatus: '已完成',
    pendingStatus: '等待中',
    cancelledStatus: '已取消',
    failedStatus: '失败',
    restoreImport: '导入恢复',
    uploadFiles: '上传邮件文件',
    uploadHint: '支持 .eml / .mbox，可多选或多批上传',
    restoreMode: '模式',
    modeImport: '纯邮件导入',
    modeRestore: '备份包恢复',
    startRestore: '开始恢复',
    selectFiles: '选择文件',
    report: '报告',
    cancelTask: '取消任务',
    confirmDeleteBackup: '确定删除该备份？',
    backupFileCount: '文件数',
    createdAt: '生成时间',
```

- [ ] **Step 3: i18n 英文文案**

`en.js` 末尾追加对应英文：
```js
    backupRestore: 'Backup & Restore',
    backupTab: 'System Backup',
    restoreTab: 'Email Import/Restore',
    createBackup: 'Create Backup',
    includeConfig: 'Include system config',
    includeSecrets: 'Include secrets (passwords/tokens)',
    backupHistory: 'Backup History',
    download: 'Download',
    backupProgress: 'Progress',
    imported: 'Imported',
    skipped: 'Skipped',
    failedCount: 'Failed',
    processingStatus: 'Processing',
    completedStatus: 'Completed',
    pendingStatus: 'Pending',
    cancelledStatus: 'Cancelled',
    failedStatus: 'Failed',
    restoreImport: 'Import / Restore',
    uploadFiles: 'Upload mail files',
    uploadHint: 'Supports .eml / .mbox; multi-select or multi-batch',
    restoreMode: 'Mode',
    modeImport: 'Import mail only',
    modeRestore: 'Restore backup package',
    startRestore: 'Start',
    selectFiles: 'Select files',
    report: 'Report',
    cancelTask: 'Cancel',
    confirmDeleteBackup: 'Delete this backup?',
    backupFileCount: 'Files',
    createdAt: 'Created',
```

- [ ] **Step 4: Commit**
```bash
git add mail-vue/src/perm/perm.js mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(backup): add route mapping and i18n"
```

---

## Task 4: 备份恢复页（完整实现）

单页两 tab：备份（创建表单 + 历史表格 + 进度轮询 + 下载/删除/取消）、恢复（多文件上传 + 模式 + 进度轮询 + 报告）。

**Files:**
- Create: `mail-vue/src/views/backup/index.vue`

- [ ] **Step 1: 实现**

`mail-vue/src/views/backup/index.vue`:
```vue
<template>
  <div class="backup-page">
    <el-tabs v-model="activeTab" class="backup-tabs">
      <!-- 备份 -->
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
            <el-progress
              :percentage="backupPercent"
              :status="progressStatus(backupTask.status)" />
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

      <!-- 恢复/导入 -->
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

// ---- 备份 ----
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

// ---- 恢复/导入 ----
const sourceKeys = ref([])
const restoreMode = ref('import')
const restoreTask = ref(null)
const restoreRunning = computed(() => restoreTask.value?.status === 'processing')
const restorePercent = computed(() => {
  const tk = restoreTask.value
  if (!tk) return 0
  const done = tk.processed + tk.skipped + tk.failed
  // 总量未知时用已处理估算（导入无 total，用平滑增长上限 99）
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
    onSuccess && onSuccess(res)
  } catch (e) { onError && onError(e) }
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

// ---- 通用 ----
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
```

> 注：模板中 `$t('ops')`（操作列）、`$t('clear')`、`$t('delete')` 已在现有 i18n 存在（`ops`、`clear`、`delete` 等通用词）；若缺失则在 Task 3 i18n 一并补上。

- [ ] **Step 2: 补充可能缺失的通用 key**

Run: `grep -rn "ops:\|clear:" mail-vue/src/i18n/zh.js`
若 `ops`/`clear` 不存在，在 zh.js/en.js 补：
```js
    ops: '操作',      // zh
    clear: '清空',    // zh
```
```js
    ops: 'Actions',   // en
    clear: 'Clear',   // en
```

- [ ] **Step 3: Commit**
```bash
git add mail-vue/src/views/backup/index.vue mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(backup): add backup & restore admin page"
```

---

## Task 5: 端到端手动验证

前置：后端计划已实现并 `wrangler dev` 运行；`pnpm --prefix mail-vue run dev` 启动前端。

- [ ] **登录 admin**：侧栏出现「备份恢复」菜单项。
- [ ] **创建备份**：切换「系统备份」→ 勾选含配置（不含凭据）→ 创建 → 进度条推进至 100%，提示完成。
- [ ] **历史列表**：出现该备份行，状态 completed。
- [ ] **下载**：点击下载得到 `backup-<id>.tar`，解压含 manifest.json + emails.mbox + config.json。
- [ ] **删除**：删除后历史列表消失。
- [ ] **多文件上传**：切「邮件导入恢复」→ 拖入 3 个 .eml/.mbox → 文件数显示 3。
- [ ] **纯邮件导入**：选「纯邮件导入」→ 开始 → 进度推进，完成提示 imported/skipped/failed 计数。
- [ ] **NOONE 路由**：导入收件地址不存在的邮件后，后台「全部邮件」(noone) 可见。
- [ ] **去重**：重复导入相同文件 → skipped 递增。
- [ ] **备份包恢复**：下载 tar 后，切「备份包恢复」上传 → 完成后用户/账户/邮件恢复。
- [ ] **取消**：处理中点取消 → 状态变 cancelled，轮询停止。
- [ ] **非 admin**：普通用户侧栏无「备份恢复」；直接访问 `/backup` 后端返回 403。

---

## Self-Review（计划自查）

- **Spec/后端覆盖**：备份创建/历史/下载/删除/进度、多文件上传、模式（import/restore）、进度轮询、取消、NOONE/去重（通过后端验证）— 均有任务。
- **占位符**：无 TBD；`customUpload` 用 `http-request` 自定义上传直传 FormData（Element Plus 标准用法）。
- **一致性**：API 路径与后端 `backup-api.js` 完全对齐；组件内 `backupList` ref 与列表请求函数已拆分命名（函数为 `fetchBackupList`），避免遮蔽。
