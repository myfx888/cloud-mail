# 邮件回收站 — 实现计划（Backend + Frontend）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户删除邮件仅进回收站（软删，现状已如此），新增用户端「按邮箱」回收站视图与恢复；永久删除保持管理员专属；管理端「全局」回收站复用已有接口。

**Architecture:** 后端扩展 `email.list` 增加 `deleted` 模式（过滤 `isDel=1`）+ 新增 `PUT /email/restore`；前端在邮箱视图加「回收站」入口与「恢复」操作，管理端暴露已有 `type=delete` 视图与永久删除。无新表，复用 `email.isDel`。

**Tech Stack:** Cloudflare Workers + Hono + Drizzle；Vue 3 + Element Plus。无单测，验证以 `wrangler dev`/`npm run dev` + 实操为准。

**Spec:** `docs/superpowers/specs/2026-06-21-email-recycle-bin-design.md`
**依赖:** 共享邮箱后端计划（`email.list` 已改为按 `accountId` + 成员身份、`email.delete` 改为成员级）。本计划在其之后实施。

---

## Phase 1 — 后端

### Task 1: `email.list` 增加 `deleted` 模式

**Files:** Modify `mail-worker/src/service/email-service.js`（`list`，约第 29 行）

- [ ] **Step 1: 解析 `deleted` 参数**

在 `list` 方法参数解构（第 31 行）追加:
```js
		let { emailId, type, accountId, size, timeSort, allReceive, deleted } = params;
		deleted = Number(deleted);
```

- [ ] **Step 2: isDel 过滤按 deleted 切换**

在 listQuery / totalQuery / latestEmailQuery 三处 where 子句中，把:
```js
					eq(email.isDel, isDel.NORMAL),
```
替换为:
```js
					eq(email.isDel, deleted ? isDel.DELETE : isDel.NORMAL),
```

> 其余（accountId 过滤、成员校验、star join、allReceive）保持与共享邮箱改造后一致，无需再改。

- [ ] **Step 3: 验证**

`GET /email/list?accountId=<id>&deleted=1` → 仅返回该邮箱已删邮件（`isDel=1`）。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat(recycle-bin): email.list deleted mode (isDel=1)"
```

### Task 2: 新增 `PUT /email/restore` 恢复接口

**Files:** Modify `mail-worker/src/service/email-service.js`、`mail-worker/src/api/email-api.js`

- [ ] **Step 1: service 增 `restore`**

在 `email-service.js` 的 `read` 方法附近新增:
```js
	async restore(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(
			and(inArray(email.emailId, emailIdList), inArray(email.accountId, visible))
		).run();
	}
```

- [ ] **Step 2: api 增路由**

`email-api.js` 追加:
```js
app.put('/email/restore', async (c) => {
	await emailService.restore(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})
```

- [ ] **Step 3: 验证**

删除一封 → `PUT /email/restore {emailIds:"<id>"}` → 邮件回到正常列表（`isDel=0`）；非成员恢复他人邮箱邮件 → 403。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/service/email-service.js mail-worker/src/api/email-api.js
git commit -m "feat(recycle-bin): email restore endpoint (membership-scoped)"
```

### Task 3: 鉴权映射（restore 挂 email:delete）

**Files:** Modify `mail-worker/src/security/security.js`

- [ ] **Step 1: `premKey['email:delete']` 追加路径**

```js
	'email:delete': ['/email/delete', '/email/restore'],
```
（`/email/restore` 已在共享邮箱计划 Task 5 加入 `requirePerms`；若未加，在此一并补进 `requirePerms` 数组。）

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/security/security.js
git commit -m "feat(recycle-bin): gate /email/restore under email:delete"
```

---

## Phase 2 — 前端

### Task 4: `request/email.js` 增加 `deleted` 与 `restore`

**Files:** Modify `mail-vue/src/request/email.js`

- [ ] **Step 1: 改 `emailList` 签名 + 增 `emailRestore`**

```js
export function emailList(accountId, allReceive, emailId, timeSort, size, type, signal, deleted) {
    return http.get('/email/list', {params: {accountId, allReceive, emailId, timeSort, size, type, deleted}, signal})
}

export function emailRestore(emailIds) {
    return http.put('/email/restore', { emailIds })
}
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/request/email.js
git commit -m "feat(recycle-bin): frontend emailList deleted param + restore fn"
```

### Task 5: 邮箱视图加「回收站」入口与恢复

**Files:** Modify `mail-vue/src/views/email/index.vue`（主收件视图，`emailList` 调用处）

- [ ] **Step 1: 增加回收站切换状态**

```js
const trashMode = ref(false)
```
加载列表时按 `trashMode` 传 `deleted` 与切换 `isDel` 期望：
```js
const list = await emailList(accountId, allReceive, emailId, timeSort, size, type, signal, trashMode.value ? 1 : 0)
```

- [ ] **Step 2: UI 入口（顶部工具栏或侧栏分类）**

```html
<el-button :type="trashMode ? 'danger' : ''" @click="toggleTrash">
  {{ $t('recycleBin') }}
</el-button>
```
```js
function toggleTrash() {
  trashMode.value = !trashMode.value
  reloadList()
}
```

- [ ] **Step 3: 列表项操作**

回收站模式下，每项显示「恢复」、隐藏「删除」:
```html
<el-button v-if="trashMode" size="small" type="primary" link @click="restore(row.emailId)">{{ $t('restore') }}</el-button>
```
```js
import { emailRestore } from '@/request/email.js'
async function restore(emailId) {
  await emailRestore(String(emailId))
  await reloadList()
}
```

- [ ] **Step 4: 验证**

进入回收站 → 见已删邮件；点「恢复」→ 邮件回到收件箱。

- [ ] **Step 5: 提交**

```bash
git add mail-vue/src/views/email/index.vue
git commit -m "feat(recycle-bin): per-mailbox trash view + restore action"
```

### Task 6: 管理端全局回收站入口

**Files:** Modify `mail-vue/src/views/all-email/index.vue`

> 管理端 `allList` 已支持 `type=delete`；`/allEmail/delete`、`/allEmail/batchDelete` 已限管理员。仅补 UI。

- [ ] **Step 1: 增加回收站筛选/入口**

在筛选区加「回收站」选项，请求时带 `type=delete`；列表项提供「永久删除」（调 `/allEmail/delete`）。

```html
<el-button type="danger" @click="loadDeleted">{{ $t('recycleBin') }}</el-button>
```
```js
async function loadDeleted() {
  // 复用既有 allList 请求，type 设为 'delete'
  params.type = 'delete'
  await fetchList()
}
```
列表项「永久删除」:
```html
<el-button type="danger" link size="small" @click="permanentDelete(row.emailId)">{{ $t('permanentDelete') }}</el-button>
```
```js
import { allEmailDelete } from '@/request/all-email.js' // 既有
async function permanentDelete(emailId) {
  await allEmailDelete(String(emailId))
  await fetchList()
}
```

- [ ] **Step 2: 验证**

管理员进入全局回收站 → 见所有已删邮件；永久删除 → 行真正消失。

- [ ] **Step 3: 提交**

```bash
git add mail-vue/src/views/all-email/index.vue
git commit -m "feat(recycle-bin): admin global trash view + permanent delete"
```

### Task 7: i18n 文案

**Files:** Modify `mail-vue/src/i18n/zh.js`、`mail-vue/src/i18n/en.js`

- [ ] **Step 1: zh.js 追加**

```js
recycleBin: '回收站',
restore: '恢复',
permanentDelete: '永久删除',
```

- [ ] **Step 2: en.js 对应**

```js
recycleBin: 'Trash',
restore: 'Restore',
permanentDelete: 'Delete Permanently',
```

- [ ] **Step 3: 提交**

```bash
git add mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(recycle-bin): frontend i18n"
```

---

## Phase 3 — 验收

### Task 8: 端到端验收

- [ ] **Step 1:** 用户删除邮件 → 进入「回收站」可见；恢复 → 回到收件箱。
- [ ] **Step 2:** 用户无任何「永久删除」入口（仅软删）。
- [ ] **Step 3:** 共享邮箱回收站按邮箱共享：A 删除/恢复 → B 同步可见。
- [ ] **Step 4:** 管理员全局回收站可见全部已删；永久删除真正移除。
- [ ] **Step 5:** 回归：个人邮箱删除/恢复正常。

---

## Self-Review

**Spec 覆盖（§4/5/6/7）**
- `email.list` deleted 模式：Task 1 ✓
- `PUT /email/restore`：Task 2 ✓
- 权限（restore 挂 email:delete）：Task 3 ✓
- 管理端已有（type=delete + 永久删除）：Task 6 仅补 UI ✓
- 用户按邮箱、管理员全局：Task 5/6 ✓
- 不自动清理、退出保留：后端无自动清理逻辑 ✓
- 边界（草稿同路径、邮箱已删不可恢复）：恢复 where 含 `inArray(accountId, visible)`，已删邮箱不在 visible 中 → 自然不可恢复 ✓

**依赖**
- `memberService.getVisibleAccountIds`、`email.list` 按 accountId 改造来自共享邮箱后端计划，须先完成。

**备注**
- `allEmailDelete` 请求函数名以 `request/all-email.js` 实际导出为准（执行时核对）。
