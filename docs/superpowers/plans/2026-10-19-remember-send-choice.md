# 按邮箱账号记忆上次发送选项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个邮箱账号记住该用户上次发送成功时的发送方式（及 SMTP 账户），下次打开写信页自动恢复。

**Architecture:** 复刻签名功能"记住上次选择"模式：`account_member` 表加两列（`last_send_method` / `last_smtp_account_id`），后端 2 个接口（存/取），前端写信页发送成功后保存、`open()` 尾部恢复。规格见 `docs/superpowers/specs/2026-10-19-remember-send-choice-design.md`。

**Tech Stack:** Cloudflare Workers + Hono + Drizzle ORM (D1)、Vue 3 + Element Plus、Vitest（`vitest.unit.config.js`，node 环境）。

## Global Constraints

- 前端 axios 拦截器已解包 `data.data`，request 层函数直接返回业务数据，消费方**勿再取 `.data`**。
- `/mailbox/` 前缀成员自助接口不进 `requirePerms`，handler 内用 `memberService.assertMember` 做成员级校验（security.js 现状即如此，本次不改 security.js）。
- D1 迁移必须幂等：`ALTER TABLE ... ADD COLUMN` 包 try/catch，失败仅 `console.warn`（同 `v4_6DB` 款式）。
- 记忆失败（保存/读取接口异常）不得影响发送流程与写信页打开，一律静默/console.warn。
- 单测运行命令：在 `mail-worker/` 目录下 `npx vitest run --config vitest.unit.config.js <spec路径>`。
- commit 一律带 `--no-verify`（仓库惯例，Mimosa 钩子有硬编码凭据误报）。

---

### Task 1: 数据层——实体加字段 + v4_7DB 迁移

**Files:**
- Modify: `mail-worker/src/entity/account-member.js`
- Modify: `mail-worker/src/init/init.js`（挂载点约 55 行 `v4_6DB` 之后；新函数放在 447-453 行 `v4_6DB` 之后）

**Interfaces:**
- Consumes: 无
- Produces: `accountMember.lastSendMethod`（TEXT 列 `last_send_method`）、`accountMember.lastSmtpAccountId`（INTEGER 列 `last_smtp_account_id`），Task 2 的 service 方法依赖这两个字段名。

- [ ] **Step 1: 实体加字段**

`mail-worker/src/entity/account-member.js` 全文改为：

```js
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountMember = sqliteTable('account_member', {
	memberId: integer('member_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	role: integer('role').default(0).notNull(),
	lastSigScope: text('last_sig_scope').default('').notNull(),
	lastSigId: text('last_sig_id').default('').notNull(),
	lastSendMethod: text('last_send_method').default('').notNull(),
	lastSmtpAccountId: integer('last_smtp_account_id').default(0).notNull(),
	viewSort: integer('view_sort').default(0).notNull(),
	viewGroup: integer('view_group').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
export default accountMember;
```

- [ ] **Step 2: 新增 v4_7DB 迁移函数**

`mail-worker/src/init/init.js` 中，在 `async v4_6DB(c) {...}` 函数（447-453 行）之后新增：

```js
	async v4_7DB(c) {
		const sqls = [
			`ALTER TABLE account_member ADD COLUMN last_send_method TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE account_member ADD COLUMN last_smtp_account_id INTEGER NOT NULL DEFAULT 0;`
		];
		for (const sql of sqls) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}
	},
```

- [ ] **Step 3: 挂载迁移**

`mail-worker/src/init/init.js` 第 55 行 `await this.v4_6DB(c);` 之后加一行：

```js
		await this.v4_7DB(c);
```

- [ ] **Step 4: 验证单测仍全绿（实体改动无破坏）**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部通过（0 failed）。实体加字段不影响既有 stub 式测试。

- [ ] **Step 5: Commit**

```bash
cd "E:\编程\代码\cloud-mailnew" && git add mail-worker/src/entity/account-member.js mail-worker/src/init/init.js && git commit --no-verify -m "feat(send-choice): account_member表加last_send_method/last_smtp_account_id列(v4_7DB迁移)"
```

---

### Task 2: 后端 service + API 两接口

**Files:**
- Modify: `mail-worker/src/service/member-service.js`（`setLastSignature` 之后，约 127-130 行）
- Modify: `mail-worker/src/api/account-api.js`（`signature-choice` 端点之后，约 115-120 行）
- Test: `mail-worker/test/unit/send-choice.spec.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `accountMember.lastSendMethod` / `accountMember.lastSmtpAccountId`；既有 `memberService.assertMember(c, accountId, userId)`。
- Produces:
  - `memberService.setLastSendChoice(c, accountId, userId, sendMethod, smtpAccountId)` → Promise（update 两列）
  - `memberService.resolveSendChoice(c, accountId, userId)` → Promise<{ sendMethod: string, smtpAccountId: number }>
  - HTTP: `PUT /mailbox/:accountId/send-choice`（body `{sendMethod, smtpAccountId}`）、`GET /account/:accountId/send-choice/resolve`（返回 `{sendMethod, smtpAccountId}`）

- [ ] **Step 1: 写失败测试**

新建 `mail-worker/test/unit/send-choice.spec.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仓库惯例：切断 i18n -> hono/hono 导入副作用链
vi.mock('../../src/i18n/i18n', () => ({ t: () => '', default: {} }));
// 切断 perm-service / email-service 的导入副作用链
vi.mock('../../src/service/perm-service', () => ({ default: {} }));
vi.mock('../../src/service/email-service', () => ({ default: {} }));
// orm 用可观察链式 stub
vi.mock('../../src/entity/orm', () => ({ default: vi.fn() }));

import orm from '../../src/entity/orm';
import memberService from '../../src/service/member-service';
import BizError from '../../src/error/biz-error';

// 链式 stub（同 account-view.spec.js 款式），update 链可观察 set() 入参
function dbStub() {
	const updateChain = {
		set: vi.fn(() => updateChain),
		where: vi.fn(() => updateChain),
		run: vi.fn(async () => ({})),
	};
	const selectChain = {
		from: vi.fn(() => selectChain),
		where: vi.fn(() => selectChain),
		get: vi.fn(async () => undefined),
		all: vi.fn(async () => []),
	};
	return {
		select: vi.fn(() => selectChain),
		update: vi.fn(() => updateChain),
		_chains: { selectChain, updateChain },
	};
}

describe('memberService.setLastSendChoice', () => {
	beforeEach(() => vi.clearAllMocks());

	it('按 accountId+userId 更新两列，smtpAccountId 归一为数字', async () => {
		const stub = dbStub();
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		await memberService.setLastSendChoice({}, 20, 3, 'smtp', '7');

		expect(stub._chains.updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ lastSendMethod: 'smtp', lastSmtpAccountId: 7 })
		);
	});

	it('非 smtp 方式时 smtpAccountId 存 0', async () => {
		const stub = dbStub();
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		await memberService.setLastSendChoice({}, 20, 3, 'cloudflare', 7);

		expect(stub._chains.updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ lastSendMethod: 'cloudflare', lastSmtpAccountId: 0 })
		);
	});

	it('非成员抛 BizError（assertMember 拦截）', async () => {
		vi.spyOn(memberService, 'isMember').mockResolvedValue(undefined);
		await expect(memberService.setLastSendChoice({}, 20, 999, 'smtp', 1)).rejects.toBeInstanceOf(BizError);
	});
});

describe('memberService.resolveSendChoice', () => {
	beforeEach(() => vi.clearAllMocks());

	it('成员行有记录时返回两字段', async () => {
		const stub = dbStub();
		stub._chains.selectChain.get.mockResolvedValue({ lastSendMethod: 'smtp', lastSmtpAccountId: 7 });
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		const r = await memberService.resolveSendChoice({}, 20, 3);

		expect(r).toEqual({ sendMethod: 'smtp', smtpAccountId: 7 });
	});

	it('从未发送过（空串）返回空串与 0', async () => {
		const stub = dbStub();
		stub._chains.selectChain.get.mockResolvedValue({ lastSendMethod: '', lastSmtpAccountId: 0 });
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		const r = await memberService.resolveSendChoice({}, 20, 3);

		expect(r).toEqual({ sendMethod: '', smtpAccountId: 0 });
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/send-choice.spec.js`
Expected: FAIL，`setLastSendChoice is not a function` / `resolveSendChoice is not a function`。

- [ ] **Step 3: 实现 service 两方法**

`mail-worker/src/service/member-service.js` 中，在 `setLastSignature`（约 127-130 行）之后新增：

```js
	async setLastSendChoice(c, accountId, userId, sendMethod, smtpAccountId) {
		await this.assertMember(c, accountId, userId);
		await orm(c).update(accountMember).set({
			lastSendMethod: sendMethod || '',
			lastSmtpAccountId: sendMethod === 'smtp' ? Number(smtpAccountId) || 0 : 0
		}).where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).run();
	},

	async resolveSendChoice(c, accountId, userId) {
		await this.assertMember(c, accountId, userId);
		const row = await orm(c).select({
			sendMethod: accountMember.lastSendMethod,
			smtpAccountId: accountMember.lastSmtpAccountId
		}).from(accountMember)
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).get();
		return { sendMethod: row?.sendMethod || '', smtpAccountId: row?.smtpAccountId || 0 };
	},
```

注：测试里 spy `isMember` 时实现走 `assertMember`（内部调 `isMember`），契约一致。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/send-choice.spec.js`
Expected: PASS（5 tests）。

- [ ] **Step 5: 加 API 路由**

`mail-worker/src/api/account-api.js`，在 `app.put('/mailbox/:accountId/signature-choice', ...)` 块之后新增：

```js
app.put('/mailbox/:accountId/send-choice', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const { sendMethod, smtpAccountId } = await c.req.json();
	await memberService.setLastSendChoice(c, accountId, userContext.getUserId(c), sendMethod, smtpAccountId);
	return c.json(result.ok());
});

app.get('/account/:accountId/send-choice/resolve', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const data = await memberService.resolveSendChoice(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(data));
});
```

- [ ] **Step 6: 全量单测回归**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
cd "E:\编程\代码\cloud-mailnew" && git add mail-worker/src/service/member-service.js mail-worker/src/api/account-api.js mail-worker/test/unit/send-choice.spec.js && git commit --no-verify -m "feat(send-choice): 后端send-choice存取接口与service方法(仿签名记忆模式)"
```

---

### Task 3: 前端 request 层 + 写信页保存/恢复

**Files:**
- Modify: `mail-vue/src/request/account.js`（`resolveSignature` 之后，约 53-55 行）
- Modify: `mail-vue/src/layout/write/index.vue`（多处，见步骤）

**Interfaces:**
- Consumes: Task 2 的 `PUT /mailbox/:accountId/send-choice`、`GET /account/:accountId/send-choice/resolve`（axios 已解包，直接拿 `{sendMethod, smtpAccountId}`）；写信页现成 computed `sendEmailAvailable` / `resendEnabled` / `cfSmtpAvailable`。
- Produces: 前端函数 `setSendChoice(accountId, sendMethod, smtpAccountId)`、`resolveSendChoice(accountId)`。

- [ ] **Step 1: request 层加两个函数**

`mail-vue/src/request/account.js`，在 `resolveSignature` 之后新增：

```js
export function setSendChoice(accountId, sendMethod, smtpAccountId) {
    return http.put(`/mailbox/${accountId}/send-choice`, { sendMethod, smtpAccountId })
}
export function resolveSendChoice(accountId) {
    return http.get(`/account/${accountId}/send-choice/resolve`)
}
```

并在文件顶部 import 行补入写信页会用到的名字——写信页 import 处改为：

```js
import {getPersonalSignatures, setSignatureChoice, resolveSignature, setSendChoice, resolveSendChoice} from "@/request/account.js";
```

（`request/account.js` 自身的 import 无需改动。）

- [ ] **Step 2: 写信页发送成功后保存**

`mail-vue/src/layout/write/index.vue` 的 `sendEmail()` 成功回调 `.then(emailList => {...})` 内、`resetForm();` 调用（520 行附近）之前插入：

```js
    // 记住本次成功发送使用的选项，供下次打开写信页恢复
    setSendChoice(form.accountId, form.sendMethod, form.smtpAccountId).catch(() => {})
```

（smtpAccountId 归一为非 smtp 存 0 由后端 Task 2 负责，前端原样传。）

- [ ] **Step 3: 写信页打开时恢复**

`mail-vue/src/layout/write/index.vue` 的 `async function open(fromAccount)` 内，在 SMTP 账户加载 try/catch 块（790-803 行）之后、`editor.value.focus()`（806 行）之前插入：

```js
  // 恢复该邮箱上次成功发送使用的选项；不可用或失败时维持默认链
  try {
    const saved = await resolveSendChoice(form.accountId);
    const methodAvailable = {
      cloudflare: sendEmailAvailable.value,
      resend: resendEnabled.value,
      cfsmtp: cfSmtpAvailable.value,
      smtp: true
    };
    if (saved?.sendMethod && methodAvailable[saved.sendMethod]) {
      form.sendMethod = saved.sendMethod;
      if (saved.sendMethod === 'smtp' && saved.smtpAccountId
          && smtpAccounts.value.some(acc => acc.smtpAccountId === saved.smtpAccountId)) {
        form.smtpAccountId = saved.smtpAccountId;
        selectedSmtpAccountId.value = saved.smtpAccountId;
      }
    }
  } catch (e) {
    console.warn('恢复发送选项失败:', e);
  }
```

说明：
- `open()` 由新写 / `openReply` / `openForward` 三条路径统一经过（后两者内部 `await open(...)`），恢复逻辑只写这一处。
- 回复/转发路径先被 `resetForm()` 置为默认链，`open()` 尾部覆盖为记忆值，时序成立。
- 方式不可用（如 resend 被管理员关闭、域名不再命中 cfSmtpDomains）时 `methodAvailable` 拦下，维持默认链不报错。
- 记忆的 SMTP 账户已删除时 `some(...)` 不命中，回落现有默认（default 优先，否则首项）。
- `form.accountId === -1`（无账号上下文）时请求会 404/校验失败，被 catch 吞掉走默认链，行为安全。

- [ ] **Step 4: 前端构建验证**

Run: `cd mail-vue && npm run build`
Expected: 构建成功无报错（如本地环境缺依赖，改为 `npx vite build`；再不行记录阻塞，交由用户环境验证）。

- [ ] **Step 5: Commit**

```bash
cd "E:\编程\代码\cloud-mailnew" && git add mail-vue/src/request/account.js mail-vue/src/layout/write/index.vue && git commit --no-verify -m "feat(send-choice): 写信页按邮箱账号恢复上次成功发送的选项，发送成功后保存"
```

---

### Task 4: 收尾——规格文档状态更新 + 手动验证清单移交

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-remember-send-choice-design.md`（状态行）

**Interfaces:**
- Consumes: Task 1-3 全部完成
- Produces: 无代码产出，仅文档状态与验证清单

- [ ] **Step 1: 更新规格状态行**

`docs/superpowers/specs/2026-10-19-remember-send-choice-design.md` 第 4 行改为：

```markdown
- 状态：已实现（2026-10-19）
```

- [ ] **Step 2: Commit**

```bash
cd "E:\编程\代码\cloud-mailnew" && git add docs/superpowers/specs/2026-10-19-remember-send-choice-design.md && git commit --no-verify -m "docs(spec): send-choice规格标记已实现"
```

- [ ] **Step 3: 输出手动验证清单（不提交，作为完成报告一部分）**

实现完成后向用户移交以下验证清单（生产部署用 `npx wrangler deploy`，流程见既有部署惯例）：

1. 邮箱 A 用 SMTP 发一封 → 关闭写信页 → 再打开：方式应为 SMTP 且账户为上次所选。
2. 邮箱 A 用 Cloudflare 发一封 → 再打开：应为 Cloudflare。
3. 邮箱 B（不同域名，命中 cfSmtpDomains）用 CF SMTP 发 → 再打开：应为 CF SMTP。
4. 回复一封邮件 → 再新开写信页：恢复记忆方式而非默认链。
5. 让管理员关闭 resend（或选一个不命中 cfSmtpDomains 的邮箱）后：记忆值为 resend/cfsmtp 时回退默认链，无报错。
6. 删除记忆的 SMTP 账户后：回落 SMTP 账户默认（default 优先，否则首项）。
7. 换浏览器登录同一账号：记忆仍生效（后端存储）。

---

## Self-Review 记录

- **规格覆盖**：数据层两列+迁移（Task 1）、两接口+service（Task 2）、前端保存/恢复+回退（Task 3）、文档收尾与验证（Task 4）——规格全部章节均有对应任务。security.js 明确不改（Global Constraints 记录理由）。
- **占位符扫描**：无 TBD/TODO/“适当处理”；所有代码步骤均给全文。
- **类型一致性**：`lastSendMethod`/`lastSmtpAccountId`（实体）↔ service set/select 字段名 ↔ HTTP body `{sendMethod, smtpAccountId}` ↔ 前端 `setSendChoice/resolveSendChoice` 参数名，前后一致；`smtpAccountId` 统一 number（后端归一）。
