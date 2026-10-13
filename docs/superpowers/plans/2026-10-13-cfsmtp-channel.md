# Cloudflare SMTP 备用发送通道（cfsmtp）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第四种发送方式 `cfsmtp`（Cloudflare Email Service 的认证 SMTP 端点 smtp.mx.cloudflare.net:465），按域名存 token，底层复用现有 SMTP 通道，仅作手动可选备用。

**Architecture:** 后端在 `emailService.send()` 加一个 `cfsmtp` 分支：按发件人域名查 `cfSmtpTokens` 设置，命中则构造 smtpConfig 调现有 `smtpService.send`。前端写信页加「CF SMTP」单选项（按域名显隐），设置页加独立凭据卡片。自动发送方式解析链完全不动。

**Tech Stack:** Hono + Drizzle (D1) 后端、Vue3 + Element Plus 前端、Vitest 单测（`npx vitest run --config vitest.unit.config.js`，工作目录 `mail-worker/`）。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-10-13-send-channel-enhancements-design.md`
- cfsmtp **绝不进入**自动发送方式解析链（未指定 sendMethod 时仍是 cloudflare → resend → smtp）
- 未配 token 时**报错不回退**：抛 `BizError(t('cfSmtpNotConfigured'))`
- 现有 `smtp` 通道代码、smtp_account 体系、选择框显隐逻辑零改动
- 凭据端点常量：host=`smtp.mx.cloudflare.net`，port=`465`，secure=`1`（隐式 TLS），authType=`plain`
- 测试命令：`cd mail-worker && npx vitest run --config vitest.unit.config.js`（勿用默认配置，会误走 workers pool 报 wrangler.jsonc 错误）
- 设置解析模式照抄 `resendTokens`：text 列存 JSON 字符串，`_parseSettingRow` 里 parse，`set()` 里 merge+stringify
- 提交信息用 conventional commits（feat/test/docs），与仓库现有风格一致

---

### Task 1: 设置层 cfSmtpTokens（实体 + 解析 + 保存 + 脱敏）

**Files:**
- Modify: `mail-worker/src/entity/setting.js`（resendTokens 行附近，约 27 行）
- Modify: `mail-worker/src/service/setting-service.js`（`_parseSettingRow` 约 29-32 行、默认值对象约 120 行、脱敏约 214-216 行、`set()` 约 252-268 行）
- Test: `mail-worker/test/unit/cfsmtp-setting.spec.js`（新建）

**Interfaces:**
- Consumes: 现有 `settingService.query(c)` 返回对象、`settingService.set(c, params)` 保存流程
- Produces: `settingRow.cfSmtpTokens` 为对象 `{ [domain]: { user: string, password: string } }`；设置查询投影（Task 4 消费）将附带 `cfSmtpDomains: string[]`

- [ ] **Step 1: 写失败测试**

```js
// mail-worker/test/unit/cfsmtp-setting.spec.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseMock = vi.fn();
const runMock = vi.fn().mockResolvedValue(undefined);

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual };
});

vi.mock('../../src/entity/orm', () => ({
	default: (c) => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					get: parseMock,
					all: vi.fn().mockResolvedValue([])
				}))
			}))
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({ run: runMock }))
			}))
		}))
	})
}));

import settingService from '../../src/service/setting-service';

describe('cfSmtpTokens 设置解析', () => {
	beforeEach(() => {
		parseMock.mockReset();
	});

	it('字符串形式的 cfSmtpTokens 被解析为对象', () => {
		parseMock.mockReturnValue({ resendTokens: '{}', cfSmtpTokens: '{"a.com":{"user":"api_token","password":"tok"}}' });
		const row = settingService._parseSettingRow({ resendTokens: '{}', cfSmtpTokens: '{"a.com":{"user":"api_token","password":"tok"}}' });
		expect(row.cfSmtpTokens).toEqual({ 'a.com': { user: 'api_token', password: 'tok' } });
	});

	it('解析失败时回退为空对象', () => {
		const row = settingService._parseSettingRow({ resendTokens: '{}', cfSmtpTokens: '{bad json' });
		expect(row.cfSmtpTokens).toEqual({});
	});

	it('cfSmtpDomains 投影返回已配置域名数组', () => {
		parseMock.mockReturnValue({
			resendTokens: '{}',
			cfSmtpTokens: { 'a.com': { user: 'u', password: 'p' }, 'b.com': { user: 'u', password: 'p' } }
		});
		const row = settingService._parseSettingRow({
			resendTokens: '{}',
			cfSmtpTokens: { 'a.com': { user: 'u', password: 'p' }, 'b.com': { user: 'u', password: 'p' } }
		});
		expect(row.cfSmtpDomains.sort()).toEqual(['a.com', 'b.com']);
	});
});
```

注意：`_parseSettingRow` 若非导出静态可测形式，直接调用 `settingService._parseSettingRow(...)` 即可（JS 对象方法均可测）；若该方法内部依赖 orm 之外的 c 上下文，测试以纯函数方式调用并按实际签名微调——先读该方法再写死断言。

- [ ] **Step 2: 运行确认失败**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/cfsmtp-setting.spec.js`
Expected: FAIL（`cfSmtpTokens` 未解析，值为原始字符串）

- [ ] **Step 3: 最小实现**

`src/entity/setting.js` 在 `resendTokens` 行后加：

```js
	cfSmtpTokens: text('cf_smtp_tokens').default("{}").notNull(),
```

`setting-service.js` 四处（全部照 resendTokens 相邻写法）：

`_parseSettingRow` 中 resendTokens 解析块之后：

```js
		// 解析 cfSmtpTokens
		if (typeof parsed.cfSmtpTokens === 'string') {
			try { parsed.cfSmtpTokens = JSON.parse(parsed.cfSmtpTokens || '{}'); } catch (e) { parsed.cfSmtpTokens = {}; }
		}
		parsed.cfSmtpDomains = Object.keys(parsed.cfSmtpTokens || {});
```

默认值对象（约 120 行 `resendTokens: {},` 后）：

```js
					cfSmtpTokens: {},
```

脱敏块（约 216 行后；密码全掩码，不泄露）：

```js
		Object.keys(settingRow.cfSmtpTokens || {}).forEach(key => {
			settingRow.cfSmtpTokens[key] = { ...settingRow.cfSmtpTokens[key], password: '******' };
		});
```

`set()` 中 `params.resendTokens = JSON.stringify(resendTokens);`（约 268 行）之后：

```js
		if (params.cfSmtpTokens && typeof params.cfSmtpTokens === 'object') {
			const merged = { ...(settingData.cfSmtpTokens || {}), ...params.cfSmtpTokens };
			Object.keys(merged).forEach(domain => {
				if (!merged[domain] || !merged[domain].user) delete merged[domain];
				// 密码为掩码占位时保留旧值
				else if (merged[domain].password === '******' && settingData.cfSmtpTokens?.[domain]) {
					merged[domain].password = settingData.cfSmtpTokens[domain].password;
				}
			});
			params.cfSmtpTokens = JSON.stringify(merged);
		}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/cfsmtp-setting.spec.js`
Expected: PASS（3 例）

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部 PASS（49+3）

```bash
git add mail-worker/src/entity/setting.js mail-worker/src/service/setting-service.js mail-worker/test/unit/cfsmtp-setting.spec.js
git commit -m "feat(cfsmtp): 设置层新增cfSmtpTokens按域名凭据存储与解析"
```

---

### Task 2: 发送分支 cfsmtp（含 noResendToken 守卫放行）

**Files:**
- Modify: `mail-worker/src/const/entity-const.js:58-63`（sendMethod 枚举）
- Modify: `mail-worker/src/service/email-service.js`（守卫约 303 行、分支约 314-334 行区域内新增）
- Modify: `mail-worker/src/i18n/zh.js`（74 行附近）、`mail-worker/src/i18n/en.js`（同区）
- Test: `mail-worker/test/unit/cfsmtp-send.spec.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `cfSmtpTokens` 对象；现有 `smtpService.send(c, emailPayload, smtpConfig)`（签名不变）；`emailUtils.getDomain(email)`；`emailConst.sendMethod.*`
- Produces: 发送方式 `'cfsmtp'` 生效；i18n 键 `cfSmtpNotConfigured`；`emailConst.sendMethod.CLOUDFLARE_SMTP === 'cfsmtp'`

- [ ] **Step 1: 写失败测试**

```js
// mail-worker/test/unit/cfsmtp-send.spec.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const smtpSendMock = vi.fn().mockResolvedValue({ success: true, messageId: 'smtp-1@x' });

vi.mock('../../src/service/smtp-service', () => ({
	default: { send: smtpSendMock, getSmtpConfig: vi.fn() }
}));
vi.mock('../../src/service/cf-send-service', () => ({
	default: { isAvailable: vi.fn().mockReturnValue(false), send: vi.fn() }
}));
vi.mock('resend', () => ({ Resend: vi.fn() }));

import emailService from '../../src/service/email-service';

const baseParams = (over = {}) => ({
	accountId: 1, name: 'S', sendType: '', emailId: 0,
	receiveEmail: ['x@out.com'], cc: [], bcc: [],
	text: 't', content: '<p>t</p>', subject: 's', attachments: [],
	sendMethod: 'cfsmtp', smtpAccountId: null, ...over
});

function mockDeps(c) {
	// 每个用例里按需 vi.spyOn 覆盖以下方法
	return c;
}

describe('cfsmtp 发送分支', () => {
	beforeEach(() => {
		smtpSendMock.mockClear();
	});

	it('域名已配 token：以 CF 端点参数调 smtpService.send', async () => {
		const c = { env: { admin: 'admin@a.com' }, };
		vi.spyOn(emailService, 'selectById').mockResolvedValue(null); // 回复场景不会走到
		// 依赖注入较多的私有流程，用 spy 覆盖协作方法
		vi.spyOn(require_settingHelpers(), 'query').mockResolvedValue({});

		// 说明：send() 依赖 settingService/accountService/memberService/userService/roleService/attService 等多个协作者，
		// 本测试统一用 vi.spyOn(emailService 及其 import 副本) 打桩（见 Step 3 实现后的实际协作面），
		// 断言核心：smtpSendMock 收到 host=smtp.mx.cloudflare.net / port=465 / secure=1 / user+password 来自 token。
	});

	it('未配 token：抛 cfSmtpNotConfigured', () => {});
	it('守卫放行：无 resend token 时 cfsmtp 不再抛 noResendToken', () => {});
});
```

**重要**：上面是意图骨架。写正式测试前先读 `emailService.send` 开头到 `if (!allInternal)` 的协作面（settingService.query / userService.selectById / roleService.selectById / accountService.selectById / memberService.assertMember / attService.toImageUrlHtml / emailUtils.getDomain），把它们全部 `vi.spyOn` 打桩。断言三件事：
1. `cfsmtp` + token 命中 → `smtpSendMock` 被调，第 3 参匹配 `{ host: 'smtp.mx.cloudflare.net', port: 465, secure: 1, user: 'api_token', password: '<token>' }`；
2. `cfsmtp` + 未命中 → rejects.toThrow(/cfSmtpNotConfigured 对应文案/)；
3. 无 resendToken + 站外收件 + `sendMethod='cfsmtp'` → 不抛 `noResendToken`（走到 cfsmtp 分支）。

可参考现有 `test/unit/cf-send-cc.spec.js` 的 mock 风格（vi.mock 模块 + hoisted）。

- [ ] **Step 2: 运行确认失败**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/cfsmtp-send.spec.js`
Expected: FAIL（`cfsmtp` 分支不存在：走 else 落入 resend 或抛错）

- [ ] **Step 3: 最小实现**

`entity-const.js`：

```js
	sendMethod: {
		RESEND: 'resend',
		SMTP: 'smtp',
		CLOUDFLARE: 'cloudflare',
		CLOUDFLARE_SMTP: 'cfsmtp',
		IMPORTED: 'imported'
	}
```

`email-service.js` 守卫（约 303 行）追加放行：

```js
		if (!resendToken && !allInternal && actualSendMethod !== emailConst.sendMethod.SMTP && actualSendMethod !== emailConst.sendMethod.CLOUDFLARE && actualSendMethod !== emailConst.sendMethod.CLOUDFLARE_SMTP) {
			throw new BizError(t('noResendToken'));
		}
```

自动解析链（约 294-302 行）**保持不动**。`if (!allInternal)` 内、CF binding 分支之后新增：

```js
			} else if (actualSendMethod === emailConst.sendMethod.CLOUDFLARE_SMTP) {
				// Cloudflare Email Service 认证SMTP（备用通道，仅手动选择）
				const cfSmtpTokens = await settingService.query(c).then(row => row.cfSmtpTokens) // 与函数开头 query 合并取值，避免重复查询：直接复用开头解构出的变量
				const cfToken = (cfSmtpTokens || {})[domain];
				if (!cfToken || !cfToken.user || !cfToken.password) {
					throw new BizError(t('cfSmtpNotConfigured'));
				}
				const emailPayload = {
					sendEmail: accountRow.email,
					name: name,
					recipient: receiveEmail.map(email => ({ address: email, name: '' })),
					cc: ccList.map(email => ({ address: email, name: '' })),
					bcc: bccList.map(email => ({ address: email, name: '' })),
					subject: subject,
					text: text,
					content: html,
					attachments: [...imageDataList, ...attachments],
					headers: sendType === 'reply' ? {
						'In-Reply-To': emailRow.messageId,
						'References': emailRow.messageId
					} : {}
				};
				sendResult = await smtpService.send(c, emailPayload, {
					enabled: true,
					host: 'smtp.mx.cloudflare.net',
					port: 465,
					secure: 1,
					authType: 'plain',
					user: cfToken.user,
					password: cfToken.password,
					fromName: settingRow.smtpFromName
				});
```

注意两点：
- 函数开头已有 `const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);`——把 `cfSmtpTokens` 加进这个解构，分支里直接用，**不要二次 query**（上面代码块中带注释的行仅为示意，实现时删掉）。
- 发送后的结果处理（约 395 行 `else if (actualSendMethod === SMTP)` 段）与 `messageId` 逻辑：`cfsmtp` 走 SMTP 同款（`smtpService.send` 已返回 `{success, messageId}`）。实现时把现有 `else if (actualSendMethod === emailConst.sendMethod.SMTP)` 结果分支条件改为 `=== SMTP || === CLOUDFLARE_SMTP`。

i18n `zh.js`（`smtpNotConfigured` 之后）：

```js
	cfSmtpNotConfigured: '当前域名未配置Cloudflare SMTP凭据，请在设置中添加',
```

`en.js`：

```js
	cfSmtpNotConfigured: 'Cloudflare SMTP credentials are not configured for this domain. Please add them in Settings.',
```

- [ ] **Step 4: 运行确认通过**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/cfsmtp-send.spec.js`
Expected: PASS（3 例）

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd mail-worker && npx vitest run --config vitest.unit.config.js`
Expected: 全部 PASS

```bash
git add mail-worker/src/const/entity-const.js mail-worker/src/service/email-service.js mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js mail-worker/test/unit/cfsmtp-send.spec.js
git commit -m "feat(cfsmtp): 发送分支按域名取token复用SMTP通道，守卫放行不依赖resend"
```

---

### Task 3: 前端写信页「CF SMTP」选项

**Files:**
- Modify: `mail-vue/src/layout/write/index.vue`（单选组 86-90 行、showSmtpSelector 221-229 行、重试链 517-521 行、默认选中 561/587/629 行三处）
- Modify: `mail-vue/src/i18n/zh.js` / `en.js`

**Interfaces:**
- Consumes: 设置 store 的 `settings.cfSmtpDomains`（Task 4 后端投影下发）；`form.sendMethod` 单选值 `'cfsmtp'`
- Produces: 用户可选 `cfsmtp`；重试弹窗可推荐 `cfsmtp`

- [ ] **Step 1: 设置 store 增加字段**

`mail-vue/src/store/setting.js` 的 `settings` 默认对象（约 7-13 行）加：

```js
            cfSmtpDomains: [],
```

- [ ] **Step 2: 写信页接线**

`index.vue` 单选组（86-90 行）改为：

```html
              <el-radio-group v-model="form.sendMethod" size="small" v-if="sendEmailAvailable || resendEnabled || cfSmtpAvailable">
                <el-radio-button value="cloudflare" v-if="sendEmailAvailable">Cloudflare</el-radio-button>
                <el-radio-button value="resend" v-if="resendEnabled">Resend</el-radio-button>
                <el-radio-button value="cfsmtp" v-if="cfSmtpAvailable">CF SMTP</el-radio-button>
                <el-radio-button value="smtp">SMTP</el-radio-button>
              </el-radio-group>
```

script 内（`sendEmailAvailable` computed 约 220 行后）加：

```js
const cfSmtpAvailable = computed(() => {
  const domains = settingStore.settings?.cfSmtpDomains || []
  const domain = (form.accountId ? accountEmailOf(form.accountId) : '')
  return domains.includes(domain.split('@')[1])
})
```

`accountEmailOf` 若无现成映射，则改用写信页已有的账号列表 store（写信页切换账号处已有账号下拉数据源），按实际数据源取当前发件账号 email；**以实现时读到的真实数据源为准，勿造新请求**。

`showSmtpSelector`（221-229 行）补一个条件：`form.sendMethod === 'cfsmtp'` 时返回 false：

```js
  return form.sendMethod === 'smtp' && smtpAccounts.value.length > 0 && form.sendMethod !== 'cfsmtp'
```

（严格写法：在函数首行加 `if (form.sendMethod === 'cfsmtp') return false`。）

重试链（519-521 行后）加：

```js
    if (cfSmtpAvailable.value && form.sendMethod !== 'cfsmtp') availableMethods.push('cfsmtp')
```

默认选中三处（561/587/629 行同款表达式）**保持不变**——cfsmtp 不作为默认。

i18n：若按钮文案走 i18n，则 zh `sendMethodCfsmtp: 'CF SMTP'`、en 同为 `'CF SMTP'`；模板中直接硬编码「CF SMTP」亦可（现有 Cloudflare/Resend 按钮即硬编码，保持一致选硬编码）。

- [ ] **Step 3: 构建验证**

Run: `cd mail-vue && npm run build`
Expected: 构建成功无类型/模板错误

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/layout/write/index.vue mail-vue/src/store/setting.js
git commit -m "feat(cfsmtp): 写信页新增CF SMTP手动备用选项，按域名显隐"
```

---

### Task 4: 设置页凭据卡片

**Files:**
- Modify: `mail-vue/src` 中 SMTP 设置所在组件（实现时以 `grep -rn "smtpServers\|resendTokens" mail-vue/src/views` 定位设置页文件；典型为 views/setting 相关 .vue）
- Consumes: 现有设置保存接口（`settingService.set` 已在 Task 1 支持 `cfSmtpTokens`）；现有 `POST /smtp/verify` 端点

- [ ] **Step 1: 定位设置页文件**

Run: `grep -rn "resendTokens" mail-vue/src --include=*.vue -l`
在命中文件中找到 Resend token 编辑区，复制其交互模式（行编辑、保存按钮、成功提示）。

- [ ] **Step 2: 新增「Cloudflare SMTP（备用）」卡片**

数据结构：`cfSmtpRows: [{ domain, user, password }]`（编辑态数组），打开设置时由 `settings.cfSmtpTokens` 对象展开；保存时归并为对象 `params.cfSmtpTokens` 提交（空 domain 行丢弃；password 为 `******` 时后端已按 Task 1 保留旧值）。

卡片模板（Element Plus，风格随现有设置页）：

```html
<el-card header="Cloudflare SMTP（备用）">
  <div v-for="(row, i) in cfSmtpRows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
    <el-input v-model="row.domain" placeholder="域名，如 example.com" style="width:220px"/>
    <el-input v-model="row.user" placeholder="用户名（api_token）" style="width:220px"/>
    <el-input v-model="row.password" placeholder="API Token" show-password style="width:260px"/>
    <el-button @click="testCfSmtpRow(row)">测试</el-button>
    <el-button type="danger" @click="cfSmtpRows.splice(i,1)">删除</el-button>
  </div>
  <el-button @click="cfSmtpRows.push({domain:'',user:'api_token',password:''})">添加域名</el-button>
  <el-button type="primary" @click="saveCfSmtp">保存</el-button>
</el-card>
```

`testCfSmtpRow` 调现有 verify 端点（`POST /smtp/verify`，参数：host `smtp.mx.cloudflare.net`、port 465、secure 1、user、password、authType 'plain'），toast `message` 字段展示成功/失败。

`saveCfSmtp`：

```js
const cfSmtpTokens = {}
for (const r of cfSmtpRows.value) {
  if (r.domain && r.user) cfSmtpTokens[r.domain.trim().toLowerCase()] = { user: r.user, password: r.password }
}
await saveSettingApi({ cfSmtpTokens })
```

（`saveSettingApi` 名以该页现有保存函数为准。）

- [ ] **Step 3: 构建验证**

Run: `cd mail-vue && npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/<设置页文件>
git commit -m "feat(cfsmtp): 设置页新增按域名token凭据卡片与测试连接"
```

---

### Task 5: 部署与手工验证

**Files:** 无代码改动。

- [ ] **Step 1: 后端部署**

按 [[部署流程]] 惯例：在 `mail-worker/` 用本地 wrangler（勿 npx 拉版本）：`npx wrangler deploy`。注意 D1 会按实体定义自动容错新列 `cf_smtp_tokens`（default '{}'）；若启动报列缺失，按仓库既有迁移方式补 `ALTER TABLE settings ADD COLUMN cf_smtp_tokens TEXT DEFAULT '{}'`。

- [ ] **Step 2: 前端构建部署**

Run: `cd mail-vue && npm run build`，产物随 worker 部署（或按现有前端发布方式）。

- [ ] **Step 3: 手工验证清单**

1. 设置页添加 hornmaritime.org 的 token（CF 后台生成，用户名固定 `api_token`）→「测试」→ 成功提示。
2. 写信选 hornmaritime 账号：出现「CF SMTP」按钮；选它发送 → 收件方收到，QQ 邮箱显示"由 bounces@cf-bounce 代发"（预期内）。
3. 未配域名账号：CF SMTP 按钮不显示。
4. 拔掉 token 再发：报"当前域名未配置Cloudflare SMTP凭据"，不静默换道。
5. 默认发送方式仍为 Cloudflare（binding）。
