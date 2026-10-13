# Mailcow 密码重置并重发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 mailcow 开通账号"本地密码从未同步到 mailcow"的确定性 535 bug（治本），并提供发送失败时"API 重置密码并重发"的一键自愈（治标）。

**Architecture:** 治本——`account-service` 两处 exists 分支在落库前先调 mailcow `edit/mailbox` API 把新密码写到邮箱。治标——新端点 `POST /smtp/reset-mailcow-password`（权限校验→生成密码→API 设置→更新 smtp_account 行，不回传明文），前端发送失败弹窗在 mailcow 账号 + 535 错误时显示「重置密码并重发」按钮，成功后自动重发。

**Tech Stack:** Hono 后端、mailcow API（`callApi('edit/mailbox')`）、Vue3 + Element Plus、Vitest 单测。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-10-13-send-channel-enhancements-design.md` 第二部分
- mailcow `edit/mailbox` 请求体格式：`{ items: [email], attr: { password, password2 } }`（mailcow.yaml `/api/v1/edit/mailbox`）
- API 结果判定照抄 `mailcowService.createAccount` 的 `isSuccess` 模式（数组内 `type/status === 'success'` 或 `status === true`；mailcow 可能返回空 body + HTTP 200）
- 新端点权限守卫照抄 `/smtp/delete-mailcow-account`（smtp-api.js 291-308 行）：`selectByIdAny` + `memberService.canAccessAccount(c, accountId, userId, isAdmin)`；`mailcowServerId` 为空抛 `t('mailcowAccountNotFound')`
- 端点**不回传密码明文**，仅返回 `{ success: true }`
- 测试命令：`cd mail-worker && npx vitest run --config vitest.unit.config.js`
- 提交信息 conventional commits

---

### Task 1: 治本——provisioning exists 分支先同步密码再落库

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（`provisionSmtpByMailcowServer` 约 569-605 行；`provisionMailcowForAccount` 约 72-103 行）
- Modify: `mail-worker/src/service/mailcow-service.js`（新增 `resetAccountPassword` 方法，`createAccount` 约 333 行附近）
- Test: `mail-worker/test/unit/mailcow-reset-password.spec.js`（新建）

**Interfaces:**
- Consumes: `mailcowService.callApi(c, path, method, data, server)`；`mailcowService.resolvePassword(c)`；`applyMailcowSmtpConfig(c, accountId, mailcowAccount)`
- Produces: `mailcowService.resetAccountPassword(c, email, server) → { password }`（新密码已通过 API 写入 mailcow 并返回明文供落库）；`markAccountPasswordChanged` 语义由 exists 分支内联实现

- [ ] **Step 1: 写失败测试**

```js
// mail-worker/test/unit/mailcow-reset-password.spec.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callApiMock = vi.hoisted(() => vi.fn());
const resolvePasswordMock = vi.hoisted(() => vi.fn().mockReturnValue('NewPass123!'));

vi.mock('../../src/service/setting-service', () => ({ default: { query: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../src/error/biz-error', () => ({ default: class BizError extends Error {} }));

import mailcowService from '../../src/service/mailcow-service';

describe('mailcowService.resetAccountPassword', () => {
	beforeEach(() => {
		callApiMock.mockReset();
		// resetAccountPassword 内部以 this.callApi 调用，直接替换
		mailcowService.callApi = callApiMock;
		mailcowService.resolvePassword = resolvePasswordMock;
	});

	it('调用 edit/mailbox 且 body 为 items+attr，成功返回新密码', async () => {
		callApiMock.mockResolvedValue([{ type: 'success' }]);
		const r = await mailcowService.resetAccountPassword({ env: {} }, 'a@hornmaritime.org', { id: 1 });
		expect(callApiMock).toHaveBeenCalledWith(
			{ env: {} }, 'edit/mailbox', 'POST',
			expect.objectContaining({ items: ['a@hornmaritime.org'], attr: expect.objectContaining({ password: 'NewPass123!', password2: 'NewPass123!' }) }),
			{ id: 1 }
		);
		expect(r.password).toBe('NewPass123!');
	});

	it('API 返回失败时抛错且不带密码细节', async () => {
		callApiMock.mockResolvedValue([{ type: 'danger', msg: 'quota exceeded' }]);
		await expect(mailcowService.resetAccountPassword({ env: {} }, 'a@x.com', { id: 1 }))
			.rejects.toThrow(/quota exceeded/);
	});

	it('空 body 响应按 mailbox 存在性兜底：存在即成功', async () => {
		callApiMock.mockImplementation((c, path) => {
			if (path === 'edit/mailbox') return Promise.resolve('');
			if (path.startsWith('get/mailbox/')) return Promise.resolve([{ username: 'a@x.com' }]);
			return Promise.resolve('');
		});
		mailcowService.accountExists = vi.fn().mockResolvedValue(true);
		const r = await mailcowService.resetAccountPassword({ env: {} }, 'a@x.com', { id: 1 });
		expect(r.password).toBe('NewPass123!');
	});
});
```

（accountExists 的 mock 方式以实际实现里 `resetAccountPassword` 的内部调用形式为准——若走 `this.accountExists(c, email, server)` 则上面的替换方式有效。）

- [ ] **Step 2: 运行确认失败**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/mailcow-reset-password.spec.js`
Expected: FAIL（`resetAccountPassword is not a function`）

- [ ] **Step 3: 实现 resetAccountPassword**

`mailcow-service.js` 中 `createAccount` 方法之前新增：

```js
	/**
	 * 重置邮箱密码：生成新密码→edit/mailbox 写入 mailcow→返回明文供本地落库
	 * @returns {{ password: string }}
	 */
	async resetAccountPassword(c, email, serverConfig = null) {
		let server = serverConfig;
		if (!server || !server.apiUrl || !server.apiKey) {
			server = await this.getServerById(c, server?.id);
		}
		const password = await this.resolvePassword(c);
		const data = { items: [email], attr: { password, password2: password } };
		const result = await this.callApi(c, 'edit/mailbox', 'POST', data, server);

		const isSuccess = Array.isArray(result)
			? result.some(r => r.type === 'success' || r.status === 'success' || r.status === true)
			: (result?.type === 'success' || result?.status === 'success' || result?.status === true);

		if (!isSuccess && !this.isEmptyApiResponse(result)) {
			let errorDetail = '';
			if (Array.isArray(result)) {
				errorDetail = result
					.filter(r => r.type === 'danger' || r.type === 'error' || r.status === 'error')
					.map(r => r.msg || r.message || JSON.stringify(r))
					.join(', ');
				if (!errorDetail && result.length > 0) errorDetail = JSON.stringify(result);
			} else {
				errorDetail = result?.msg || result?.message || JSON.stringify(result);
			}
			throw new BizError(`${t('mailcowPasswordResetFailed')}${errorDetail ? ': ' + errorDetail : ''}`);
		}

		// 空 body：mailcow 常见行为，用邮箱存在性兜底确认
		if (this.isEmptyApiResponse(result)) {
			const stillExists = await this.accountExists(c, email, server);
			if (!stillExists) {
				throw new BizError(`${t('mailcowPasswordResetFailed')}: mailbox not found after edit`);
			}
		}

		return { password };
	},
```

i18n `zh.js`：`mailcowPasswordResetFailed: 'mailcow密码重置失败',`；`en.js`：`mailcowPasswordResetFailed: 'Mailcow password reset failed',`

- [ ] **Step 4: 运行确认通过**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/mailcow-reset-password.spec.js`
Expected: PASS（3 例）

- [ ] **Step 5: 接线两处 exists 分支**

`account-service.js` `provisionSmtpByMailcowServer`（约 580-593 行）exists 分支改为：

```js
		if (exists) {
			const smtpConfig = await mailcowService.getSmtpConfig(c, targetServer);
			// 治本：先通过API把新密码写进mailcow，再落库，保证两者一致
			const reset = await mailcowService.resetAccountPassword(c, accountRow.email, targetServer);
			mailcowAccount = {
				email: accountRow.email,
				password: reset.password,
				smtpHost: smtpConfig.smtpHost,
				smtpPort: smtpConfig.smtpPort,
				smtpSecure: smtpConfig.smtpSecure,
				smtpAuthType: smtpConfig.smtpAuthType,
				smtpUser: accountRow.email,
				mailcowServerId: targetServer?.id || '',
				serverName: targetServer?.name || ''
			};
		} else {
```

`provisionMailcowForAccount`（约 76-90 行）exists 分支同款改法（`resolvedPassword = await mailcowService.resolvePassword(c)` 一行替换为 `const reset = await mailcowService.resetAccountPassword(c, accountRow.email, targetServer);`，`password: reset.password`）。

- [ ] **Step 6: 全量回归 + 提交**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部 PASS

```bash
git add mail-worker/src/service/mailcow-service.js mail-worker/src/service/account-service.js mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js mail-worker/test/unit/mailcow-reset-password.spec.js
git commit -m "fix(mailcow): 开通已存在邮箱时先经API同步密码再落库，根治535"
```

---

### Task 2: 自愈端点 POST /smtp/reset-mailcow-password

**Files:**
- Modify: `mail-worker/src/api/smtp-api.js`（`/smtp/delete-mailcow-account` 约 291-309 行之后新增）
- Test: `mail-worker/test/unit/smtp-reset-endpoint.spec.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `resetAccountPassword(c, email, server)`；`smtpAccountService.findByMailcowServer(c, accountId, mailcowServerId)`；`smtpAccountService.update(c, smtpAccountId, accountId, data)`
- Produces: `POST /smtp/reset-mailcow-password`，body `{ accountId }`，响应 `result.ok({ success: true })`；错误 BizError

- [ ] **Step 1: 写失败测试**

```js
// mail-worker/test/unit/smtp-reset-endpoint.spec.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resetMock = vi.hoisted(() => vi.fn());
const findByServerMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const canAccessMock = vi.hoisted(() => vi.fn());
const getServerMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/service/mailcow-service', () => ({
	default: {
		getServerById: getServerMock,
		resetAccountPassword: resetMock,
		getSmtpConfig: vi.fn().mockResolvedValue({})
	}
}));
vi.mock('../../src/service/smtp-account-service', () => ({
	default: { findByMailcowServer: findByServerMock, update: updateMock }
}));
vi.mock('../../src/service/member-service', () => ({
	default: { canAccessAccount: canAccessMock }
}));

import accountService from '../../src/service/account-service';

describe('重置密码流程（服务层接线）', () => {
	beforeEach(() => {
		resetMock.mockReset().mockResolvedValue({ password: 'NewPass1!' });
		findByServerMock.mockReset().mockResolvedValue({ smtpAccountId: 7 });
		updateMock.mockClear();
		canAccessMock.mockReset().mockResolvedValue(true);
		getServerMock.mockReset().mockResolvedValue({ id: 'srv1', apiUrl: 'https://mc', apiKey: 'k' });
	});

	it('成功路径：重置后更新对应 smtp_account 行的 password', async () => {
		// 直接驱动 account-service 中抽出的可测函数（见 Step 3：逻辑抽为 resetMailcowPasswordForAccount）
		const r = await accountService.resetMailcowPasswordForAccount(
			{ env: {} },
			{ accountId: 3, email: 'a@hornmaritime.org', mailcowServerId: 'srv1' }
		);
		expect(resetMock).toHaveBeenCalledWith({ env: {} }, 'a@hornmaritime.org', { id: 'srv1', apiUrl: 'https://mc', apiKey: 'k' });
		expect(updateMock).toHaveBeenCalledWith(expect.anything(), 7, 3, expect.objectContaining({ password: 'NewPass1!' }));
		expect(r).toEqual({ success: true });
	});

	it('mailcowServerId 为空：抛错且不调 API', async () => {
		await expect(accountService.resetMailcowPasswordForAccount(
			{ env: {} }, { accountId: 3, email: 'a@x.com', mailcowServerId: '' }
		)).rejects.toThrow();
		expect(resetMock).not.toHaveBeenCalled();
	});

	it('无对应 smtp_account 行：跳过本地更新仍成功', async () => {
		findByServerMock.mockResolvedValue(null);
		const r = await accountService.resetMailcowPasswordForAccount(
			{ env: {} }, { accountId: 3, email: 'a@hornmaritime.org', mailcowServerId: 'srv1' }
		);
		expect(updateMock).not.toHaveBeenCalled();
		expect(r).toEqual({ success: true });
	});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/smtp-reset-endpoint.spec.js`
Expected: FAIL（`resetMailcowPasswordForAccount is not a function`）

- [ ] **Step 3: 实现服务层函数 + API 端点**

`account-service.js` 在 `provisionSmtpByMailcowServer` 之后新增导出方法：

```js
	/**
	 * 重置mailcow邮箱密码并同步本地smtp_account（不回传明文）
	 */
	async resetMailcowPasswordForAccount(c, accountRow) {
		if (!accountRow?.mailcowServerId) {
			throw new BizError(t('mailcowAccountNotFound'));
		}
		const server = await mailcowService.getServerById(c, accountRow.mailcowServerId);
		const { password } = await mailcowService.resetAccountPassword(c, accountRow.email, server);

		const smtpRow = await smtpAccountService.findByMailcowServer(c, accountRow.accountId, accountRow.mailcowServerId);
		if (smtpRow) {
			await smtpAccountService.update(c, smtpRow.smtpAccountId, accountRow.accountId, { password });
		}
		return { success: true };
	},
```

`smtp-api.js` 在 `/smtp/delete-mailcow-account` 之后新增（守卫照抄该路由）：

```js
// 重置mailcow邮箱密码并同步本地SMTP账户（发送535自愈）
app.post('/smtp/reset-mailcow-password', async (c) => {
	const { accountId } = await c.req.json();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	const accountRow = await accountService.selectByIdAny(c, parseInt(accountId, 10));
	if (!accountRow || !(await memberService.canAccessAccount(c, parseInt(accountId, 10), userId, isAdmin))) {
		throw new BizError(t('accountNotExist'));
	}

	const resetResult = await accountService.resetMailcowPasswordForAccount(c, accountRow);
	return c.json(result.ok(resetResult));
});
```

（import 区若缺 `memberService`/`result`/`t` 等，比照文件头部 delete-mailcow-account 已用的导入补齐——该路由与 delete 同款依赖。）

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add mail-worker/src/api/smtp-api.js mail-worker/src/service/account-service.js mail-worker/test/unit/smtp-reset-endpoint.spec.js
git commit -m "feat(mailcow): 新增reset-mailcow-password端点，535自愈重置并同步本地"
```

---

### Task 3: 前端失败弹窗「重置密码并重发」

**Files:**
- Modify: `mail-vue/src/layout/write/index.vue`（发送 catch 块约 510-540 行区域）
- Modify: `mail-vue/src/request/smtp.js`（新增 `resetMailcowPassword` 请求函数）
- Modify: `mail-vue/src/i18n/zh.js` / `en.js`

**Interfaces:**
- Consumes: Task 2 端点；弹窗现有"换其他方式重试"实现（517-533 行）；发件账号对象（写信页已有账号数据源，含 `mailcowServerId`）
- Produces: 一键自愈按钮

- [ ] **Step 1: 请求函数**

`mail-vue/src/request/smtp.js` 比照文件内现有函数风格新增：

```js
export function resetMailcowPassword(accountId) {
	return http.post('/smtp/reset-mailcow-password', { accountId });
}
```

（`http` 导入名以该文件现状为准。）

- [ ] **Step 2: 弹窗接线**

`index.vue` 发送 catch（516 行附近"发送失败询问用户是否切换方式重试"处）改为 `ElMessageBox.confirm`，增加第三个动作。Element Plus 的 confirm 仅两按钮，故改用判断分支：

- 若发件账号 `mailcowServerId` 非空 **且** 错误文案匹配 `/535|authentication failed/i`：弹 confirm「SMTP认证失败，可一键重置mailcow密码后自动重发。是否重置并重发？」→ 确认则 `await resetMailcowPassword(form.accountId)` → 成功 toast「密码已重置」→ **递归调用发送函数重发原邮件**（与"其他方式重试"同款调用路径）→ 失败 toast 错误。
- 否则走现有"其他方式重试"逻辑不变。

```js
// catch 内新增（在现有重试逻辑之前）
const canResetMailcow = accountMailcowServerId.value
  && /535|authentication failed/i.test(String(err?.message || err))
if (canResetMailcow) {
  try {
    await ElMessageBox.confirm(t('writer.mailcowResetAsk'), t('writer.sendFailed'), { type: 'warning' })
    await resetMailcowPassword(form.accountId)
    ElMessage.success(t('writer.mailcowResetOk'))
    await doSend() // 原发送函数名以现场为准
    return
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(String(e?.message || e))
    return
  }
}
```

`accountMailcowServerId` computed：从写信页现有账号数据源取当前 `form.accountId` 对应账号的 `mailcowServerId`（该字段已随账号列表下发；若未下发，在账号列表接口返回中补该字段——账号实体已有此列）。

i18n（writer 命名空间按 zh.js 现有结构放置）：
zh：`mailcowResetAsk: 'SMTP认证失败(535)，可一键重置mailcow密码并自动重发。是否继续？'`、`mailcowResetOk: '密码已重置并同步，正在重发…'`
en：`mailcowResetAsk: 'SMTP authentication failed (535). Reset the mailcow password via API and resend automatically?'`、`mailcowResetOk: 'Password reset and synced. Resending…'`

- [ ] **Step 3: 构建验证**

Run: `cd mail-vue && npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/layout/write/index.vue mail-vue/src/request/smtp.js mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(mailcow): 发送535失败弹窗一键重置密码并自动重发"
```

---

### Task 4: 部署与手工验证

- [ ] **Step 1: 后端部署**

`cd mail-worker && npx wrangler deploy`（本地 wrangler，勿 npx 拉版本——按 [[部署流程]]）。

- [ ] **Step 2: 手工验证清单**

1. 用 hornmaritime 那个 535 账号写信走 SMTP 发送 → 弹「重置并重发」→ 确认 → 邮件发出（治标路径闭环）。
2. mailcow 后台核对该邮箱密码已被改（用新密码可登录 Roundcube 或再发一封确认）。
3. 对一个"已存在于 mailcow"的账号重新走一遍「接入 mailcow SMTP」流程 → 无需重置，直接 SMTP 发送成功（治本路径闭环）。
4. 非 mailcow 账号发送失败时：不出现重置弹窗，仍走原有重试链。
