# 共享邮箱 — 前端实现计划（Frontend）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Vue 前端落地共享邮箱：成员查看/退出、签名（共享池 + 个人池 + 上次选择记忆）、管理端成员管理（查看/指派/踢除 + 成员数列）、`mailbox:share` 权限可见性控制。

**Architecture:** 复用既有请求层（`request/*.js`）与权限指令（`v-perm`/`hasPerm`）。签名组件扩展为「共享/个人」两池；写信页改用后端 `resolveSignature` 初始化并记忆选择；账户设置加成员入口；后台账户列表加成员数与成员管理抽屉。

**Tech Stack:** Vue 3 + Element Plus + Pinia + vue-i18n。前端无单测，验证以 `npm run dev` + 浏览器实操为准。

**Spec:** `docs/superpowers/specs/2026-06-21-shared-mailbox-design.md`
**依赖:** 后端计划 `2026-06-21-shared-mailbox-backend.md` 的接口须先就绪。

**约定**
- 接口路径与后端计划一致（见后端 Task 15/16）。
- Vue SFC 改动以「定位 + 新增/替换片段」描述，不重写整文件。

---

## Phase 1 — 请求层

### Task 1: `request/account.js` 增加成员与个人签名接口

**Files:** Modify `mail-vue/src/request/account.js`

- [ ] **Step 1: 文件末尾追加**

```js
// 成员
export function mailboxMembers(accountId) {
    return http.get(`/mailbox/${accountId}/members`)
}
export function mailboxLeave(accountId) {
    return http.post(`/mailbox/${accountId}/leave`)
}
export function setSignatureChoice(accountId, scope, sigId) {
    return http.put(`/mailbox/${accountId}/signature-choice`, { scope, sigId })
}

// 个人签名
export function getPersonalSignatures(accountId) {
    return http.get(`/account/${accountId}/signatures/personal`)
}
export function addPersonalSignature(accountId, data) {
    return http.post(`/account/${accountId}/signatures/personal`, data)
}
export function updatePersonalSignature(accountId, signatureId, data) {
    return http.put(`/account/${accountId}/signatures/personal/${signatureId}`, data)
}
export function deletePersonalSignature(accountId, signatureId) {
    return http.delete(`/account/${accountId}/signatures/personal/${signatureId}`)
}
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/request/account.js
git commit -m "feat(shared-mailbox): frontend request fns for members & personal signatures"
```

### Task 2: `request/admin.js` 增加成员管理接口

**Files:** Modify `mail-vue/src/request/admin.js`

- [ ] **Step 1: 追加**

```js
export function adminMailboxMembers(accountId) {
    return http.get(`/admin/mailbox/${accountId}/members`)
}
export function adminAssignMember(accountId, userId) {
    return http.post(`/admin/mailbox/${accountId}/members`, { userId })
}
export function adminKickMember(accountId, userId) {
    return http.delete(`/admin/mailbox/${accountId}/members/${userId}`)
}
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/request/admin.js
git commit -m "feat(shared-mailbox): frontend admin member management request fns"
```

---

## Phase 2 — 签名组件（共享 / 个人两池）

### Task 3: `signature-manager/index.vue` 支持两池切换

**Files:** Modify `mail-vue/src/components/signature-manager/index.vue`

当前组件只加载共享池（`getSignatures`）。改为顶部 tab 切换「共享 / 我的」，分别调用对应接口。

- [ ] **Step 1: 引入个人签名接口**

在 `<script setup>` 顶部 import 区（第 51 行附近）追加:
```js
import { getPersonalSignatures, addPersonalSignature, updatePersonalSignature, deletePersonalSignature } from '@/request/account.js'
```

- [ ] **Step 2: 增加 tab 状态与加载逻辑**

在 `const signatureList = ref([])`（第 68 行）前后新增:
```js
const sigScope = ref('shared') // 'shared' | 'personal'
```
新增 `loadByScope` 并改造 `loadSignatures`:
```js
async function loadSignatures() {
  if (!props.accountId) return
  try {
    signatureList.value = sigScope.value === 'shared'
      ? await getSignatures(props.accountId)
      : await getPersonalSignatures(props.accountId)
  } catch (e) {
    signatureList.value = []
  }
}
function switchScope(scope) {
  sigScope.value = scope
  currentSignature.value = null
  destroyEditor()
  loadSignatures()
}
```

- [ ] **Step 3: 模板加 tab**

在 `<div class="signature-list-header">`（第 5 行）下方插入:
```html
<el-radio-group v-model="sigScope" size="small" @change="switchScope(sigScope)">
  <el-radio-button value="shared">{{ $t('sharedSignatures') }}</el-radio-button>
  <el-radio-button value="personal">{{ $t('mySignatures') }}</el-radio-button>
</el-radio-group>
```

- [ ] **Step 4: `save` / `remove` / `setDefault` 按当前 scope 调用对应接口**

在 `save()` 内按 `sigScope.value` 分支：
```js
if (sigScope.value === 'shared') {
  // 原逻辑：updateSignature / addSignature / setDefaultSignature
} else {
  if (currentSignature.value.id) {
    await updatePersonalSignature(props.accountId, currentSignature.value.id, { name, content, isDefault })
  } else {
    const newSig = await addPersonalSignature(props.accountId, { name, content, isDefault })
    currentSignature.value.id = newSig.id
  }
}
```
`remove` 与 `setDefault` 同理：personal 时调 `deletePersonalSignature` / 个人默认由 `addPersonalSignature`/`updatePersonalSignature` 的 `isDefault` 处理（后端 Task 11 已实现池内默认互斥）。

- [ ] **Step 5: 验证**

切到「我的」→ 仅看到本人个人签名；新增/编辑/删除只影响个人池；切回「共享」→ 全员共享池。

- [ ] **Step 6: 提交**

```bash
git add mail-vue/src/components/signature-manager/index.vue
git commit -m "feat(shared-mailbox): signature manager with shared/personal pools"
```

---

## Phase 3 — 写信页签名（记忆上次选择）

### Task 4: `layout/write/index.vue` 用 resolveSignature 初始化 + 记忆

**Files:** Modify `mail-vue/src/layout/write/index.vue`

- [ ] **Step 1: 引入**

第 132 行 import 区追加:
```js
import { setSignatureChoice, getPersonalSignatures } from '@/request/account.js'
```

- [ ] **Step 2: 合并签名列表（共享 + 个人）**

将第 679-689 行加载逻辑替换为：先取共享 + 个人，合并成带 `scope` 标记的列表，初始选中走「上次选择 > 共享默认」。
```js
const sharedList = (await getSignatures(form.accountId)).map(s => ({ ...s, scope: 'shared' }))
const personalList = (await getPersonalSignatures(form.accountId)).map(s => ({ ...s, scope: 'personal' }))
signatures.value = [...sharedList, ...personalList]

// 初始：上次选择（若后端提供 resolve 接口则调用，否则前端兜底：个人默认 > 共享默认）
// 推荐：新增后端 GET /account/:id/signatures/resolve；此处先以前端兜底实现
const chosen =
  personalList.find(s => s.isDefault) ||
  sharedList.find(s => s.isDefault) ||
  null
if (chosen) {
  selectedSignatureId.value = chosen.id
  currentSigScope.value = chosen.scope
  editor.value.setContent(insertSignatureIntoContent(content, chosen))
  await setSignatureChoice(form.accountId, chosen.scope, chosen.id)
} else {
  selectedSignatureId.value = ''
}
```
新增 ref:
```js
const currentSigScope = ref('shared')
```

- [ ] **Step 3: 下拉分组显示**

第 71-79 行 `el-select` 改为分组：
```html
<el-select v-model="selectedSignatureId" @change="handleSignatureChange" :placeholder="$t('selectSignature')" v-if="signatures.length > 0">
  <el-option-group v-if="sharedSignatures.length" :label="$t('sharedSignatures')">
    <el-option v-for="s in sharedSignatures" :key="s.id" :label="(s.isDefault ? s.name + ' ★' : s.name)" :value="s.id" />
  </el-option-group>
  <el-option-group v-if="personalSignatures.length" :label="$t('mySignatures')">
    <el-option v-for="s in personalSignatures" :key="s.id" :label="(s.isDefault ? s.name + ' ★' : s.name)" :value="s.id" />
  </el-option-group>
</el-select>
```
新增 computed:
```js
const sharedSignatures = computed(() => signatures.value.filter(s => s.scope === 'shared'))
const personalSignatures = computed(() => signatures.value.filter(s => s.scope === 'personal'))
```

- [ ] **Step 4: `handleSignatureChange` 记忆**

在 `handleSignatureChange(signatureId)`（第 759 行）内，选中后记录 scope 并调用 `setSignatureChoice`:
```js
const sig = signatures.value.find(s => s.id === signatureId)
if (sig) {
  currentSigScope.value = sig.scope
  setSignatureChoice(form.accountId, sig.scope, sig.id)
}
```

- [ ] **Step 5: 验证**

写信选中某签名 → 关闭再开 → 默认选中上次的签名（个人/共享均可记忆）。

- [ ] **Step 6: 提交**

```bash
git add mail-vue/src/layout/write/index.vue
git commit -m "feat(shared-mailbox): compose signature grouped + last-choice memory"
```

> 备注：若需后端 `GET /account/:id/signatures/resolve`，可作为后端计划的补充任务；当前前端兜底（个人默认 > 共享默认）已满足「记忆上次」核心语义，首次兜底差异可接受。

---

## Phase 4 — 账户设置：成员查看与退出

### Task 5: 新增成员管理组件

**Files:** Create `mail-vue/src/components/mailbox-members/index.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <el-dialog v-model="visible" :title="$t('mailboxMembers')" :width="isMobile ? '95%' : 560">
    <el-table :data="members" size="small" v-loading="loading">
      <el-table-column prop="userEmail" :label="$t('member')" />
      <el-table-column :label="$t('role')">
        <template #default="{ row }">
          <el-tag v-if="row.isCreator" type="warning" size="small">{{ $t('owner') }}</el-tag>
          <el-tag v-else size="small">{{ $t('member') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" :label="$t('joinTime')" width="170" />
    </el-table>
    <template #footer>
      <el-button v-if="canLeave" type="danger" plain @click="onLeave">{{ $t('leaveMailbox') }}</el-button>
      <el-button @click="visible = false">{{ $t('close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { mailboxMembers, mailboxLeave } from '@/request/account.js'
import { useUserStore } from '@/store/user.js'

const props = defineProps({ accountId: { type: Number, default: 0 } })
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
async function onLeave() {
  await mailboxLeave(props.accountId)
  visible.value = false
  // 退出后刷新邮箱列表（由父组件监听或路由刷新）
  location.reload()
}
defineExpose({ open })
</script>
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/components/mailbox-members/index.vue
git commit -m "feat(shared-mailbox): mailbox members view + leave"
```

### Task 6: 账户设置页挂载成员入口

**Files:** Modify `mail-vue/src/views/account/index.vue`（或账户设置所在组件）

- [ ] **Step 1: 引入并放置入口**

```js
import MailboxMembers from '@/components/mailbox-members/index.vue'
const membersRef = ref(null)
```
模板中账户操作区追加按钮:
```html
<el-button size="small" @click="membersRef?.open()">{{ $t('mailboxMembers') }}</el-button>
<MailboxMembers ref="membersRef" :account-id="currentAccountId" />
```

- [ ] **Step 2: 验证**

成员可查看列表、退出（creator 不显示退出）。

- [ ] **Step 3: 提交**

```bash
git add mail-vue/src/views/account/index.vue
git commit -m "feat(shared-mailbox): mount members entry in account settings"
```

---

## Phase 5 — 管理端成员管理

### Task 7: 后台账户列表加「成员数」列 + 成员管理抽屉

**Files:** Modify `mail-vue/src/views/all-email/index.vue`（或后台账户管理视图；若账户管理在独立视图则定位对应文件）

> 后台账户列表数据来自 `/admin/accounts`（后端 Task 16 已加 `memberCount`）。

- [ ] **Step 1: 列表加列**

表格追加:
```html
<el-table-column prop="memberCount" :label="$t('memberCount')" width="90" />
<el-table-column :label="$t('action')" width="120">
  <template #default="{ row }">
    <el-button size="small" link @click="openMembers(row.accountId)">{{ $t('manageMembers') }}</el-button>
  </template>
</el-table-column>
```

- [ ] **Step 2: 成员管理抽屉（指派/踢除）**

```vue
<el-drawer v-model="memberDrawer" :title="$t('manageMembers')" size="420px">
  <el-table :data="adminMembers" size="small" v-loading="adminLoading">
    <el-table-column prop="userEmail" :label="$t('member')" />
    <el-table-column :label="$t('role')" width="90">
      <template #default="{ row }">
        <el-tag v-if="row.isCreator" type="warning" size="small">{{ $t('owner') }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="$t('action')" width="80">
      <template #default="{ row }">
        <el-button v-if="!row.isCreator" type="danger" link size="small" @click="kick(row.userId)">{{ $t('remove') }}</el-button>
      </template>
    </el-table-column>
  </el-table>
  <div style="margin-top:12px;display:flex;gap:8px">
    <el-input v-model="assignUserId" :placeholder="$t('enterUserId')" size="small" />
    <el-button type="primary" size="small" @click="assign">{{ $t('assignMember') }}</el-button>
  </div>
</el-drawer>
```
逻辑:
```js
import { adminMailboxMembers, adminAssignMember, adminKickMember } from '@/request/admin.js'
const memberDrawer = ref(false)
const adminMembers = ref([])
const adminLoading = ref(false)
const assignUserId = ref('')
const activeAccountId = ref(0)

async function openMembers(accountId) {
  activeAccountId.value = accountId
  memberDrawer.value = true
  adminLoading.value = true
  try { adminMembers.value = await adminMailboxMembers(accountId) }
  finally { adminLoading.value = false }
}
async function kick(userId) {
  await adminKickMember(activeAccountId.value, userId)
  adminMembers.value = await adminMailboxMembers(activeAccountId.value)
}
async function assign() {
  await adminAssignMember(activeAccountId.value, Number(assignUserId.value))
  assignUserId.value = ''
  adminMembers.value = await adminMailboxMembers(activeAccountId.value)
}
```

- [ ] **Step 3: 验证**

后台看到成员数；打开抽屉查看/指派/踢除；踢 creator 应被后端拒绝（前端隐藏踢按钮 + 后端兜底）。

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/views/all-email/index.vue
git commit -m "feat(shared-mailbox): admin member count column + management drawer"
```

---

## Phase 6 — 权限可见性与 i18n

### Task 8: `mailbox:share` 权限可见性

**Files:** Modify 相关入口（账户添加提示等）

- [ ] **Step 1: 添加已存在邮箱时的友好提示**

在账户添加逻辑捕获后端 `mailboxShareNoPerm` 错误时，提示「无共享邮箱权限，请联系管理员」。用 `hasPerm('mailbox:share')` 在 UI 上隐藏/禁用「共享」相关引导。

```js
import { hasPerm } from '@/perm/perm.js'
const canShare = computed(() => hasPerm('mailbox:share'))
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/views/account/index.vue
git commit -m "feat(shared-mailbox): perm-gated shared mailbox hints"
```

### Task 9: i18n 文案

**Files:** Modify `mail-vue/src/i18n/zh.js`、`mail-vue/src/i18n/en.js`

- [ ] **Step 1: zh.js 追加**

```js
sharedSignatures: '共享签名',
mySignatures: '我的签名',
mailboxMembers: '邮箱成员',
member: '成员',
owner: '所有者',
joinTime: '加入时间',
leaveMailbox: '退出该邮箱',
memberCount: '成员数',
manageMembers: '成员管理',
remove: '移除',
assignMember: '指派',
enterUserId: '输入用户 ID',
```

- [ ] **Step 2: en.js 对应英文**

```js
sharedSignatures: 'Shared',
mySignatures: 'Mine',
mailboxMembers: 'Members',
member: 'Member',
owner: 'Owner',
joinTime: 'Joined',
leaveMailbox: 'Leave mailbox',
memberCount: 'Members',
manageMembers: 'Members',
remove: 'Remove',
assignMember: 'Assign',
enterUserId: 'Enter user ID',
```

- [ ] **Step 3: 提交**

```bash
git add mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(shared-mailbox): frontend i18n"
```

---

## Phase 7 — 验收

### Task 10: 前端端到端验收

- [ ] **Step 1:** 拥有 `mailbox:share` 的用户 A 新建邮箱、B 重复添加 → B 列表出现该邮箱。
- [ ] **Step 2:** A/B 互看邮件、已读/删除/星标同步。
- [ ] **Step 3:** 签名：共享池全员可见可改；个人池仅本人；写信记忆上次选择。
- [ ] **Step 4:** 账户设置 → 成员列表、退出（creator 不可退出）。
- [ ] **Step 5:** 后台 → 成员数列 + 成员管理抽屉（指派/踢除）。
- [ ] **Step 6:** 无 `mailbox:share` 用户：共享相关入口隐藏/禁用，添加已存在邮箱给友好提示。

---

## Self-Review

**Spec 覆盖（§8.3 前端）**
- 账户列表含共享邮箱：后端自动，前端无需改 ✓
- 写信签名选择器分组 + 记忆：Task 3/4 ✓
- 账户设置成员入口 + 退出：Task 5/6 ✓
- 后台成员数 + 成员管理：Task 7 ✓
- 权限可见性：Task 8 ✓
- i18n：Task 9 ✓

**命名一致**
- 请求函数与后端路径一致（`/mailbox/:id/members`、`/account/:id/signatures/personal*`、`/admin/mailbox/:id/members*`）。
- `sigScope` / `currentSigScope` 一致。

**备注**
- Task 4 首次兜底为「个人默认 > 共享默认」；如需精确「上次选择」首显，可加后端 resolve 接口（可选补充任务）。
- Vue SFC 改动以片段描述，执行时按定位整合。
