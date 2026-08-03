# 邮件系统 CDN 缓存改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将邮件列表与正文接口分离，列表始终实时（no-store），正文边缘长缓存（7天 immutable），消除写后读延迟并加速正文/附件加载。

**Architecture:** 后端 `/email/list`、`/allEmail/list`、`/email/latest`、`/allEmail/latest` 从 select 中移除 content/text 两个重字段（响应体从 MB 级降到 KB 级）；新增 `GET /email/content/:emailId` 独立返回单封正文，配 7 天长缓存头。通过 noCache 中间件对所有动态 email 路由注入 `Cache-Control: no-store` + `cdn-cache-control: no-store` 双头。前端改为点开邮件时按需拉正文 + Pinia 内存缓存 + 首封预加载。

**Tech Stack:** Cloudflare Workers + Hono 4.7（后端 mail-worker）、Vue 3.5 + Vite 7 + Pinia 3（前端 mail-vue）、Drizzle ORM + D1、EdgeOne 前置 CDN。

**参考 spec：** `docs/superpowers/specs/2026-08-03-email-cdn-cache-design.md`

## Global Constraints

- **前后端同仓库、同 Worker 部署**：前端构建产物输出到 `mail-worker/dist/`，与后端一起部署。前后端必须同节奏发布（list 去掉 content 后旧前端会读到 undefined）。
- **缓存时长统一值**：正文与附件长缓存 = `604800` 秒（7 天），headers 写 `max-age=604800, immutable`。
- **双头策略**：不缓存接口同时发 `Cache-Control: no-store, no-cache, must-revalidate`（给浏览器）和 `cdn-cache-control: no-store`（给 EdgeOne）。
- **权限模型不变**：共享邮箱用 `memberService.getVisibleAccountIds(c, userId)`，单邮箱用 `memberService.assertMember(c, accountId, userId)`，登录态用 `userContext.getUserId(c)`。
- **错误码约定**：不存在/逻辑删除/物理删除 → 404；无权 → 403；均配 `Cache-Control: no-store`。BizError 构造为 `new BizError(message, code)`，code 默认 501。
- **无现成单元测试框架**：项目装了 vitest + @cloudflare/vitest-pool-workers 但未配置。本计划采用 **curl 手动验证清单** 替代单元测试（见各 Task 的 Verify 步骤），与项目现有"test 脚本 = 部署到测试环境"的实际做法一致。
- **EdgeOne 域名占位符**：规则文件用 `mail.example.com`，部署前替换为真实域名。

---

## File Structure

### 后端（mail-worker）

| 文件 | 操作 | 职责 |
|------|------|------|
| `mail-worker/src/middleware/cache-headers.js` | **新建** | noCache 头中间件 + 长缓存头辅助函数。单一职责：给响应注入缓存头。 |
| `mail-worker/src/service/email-service.js` | **修改** | `list()`、`allList()` 的 select 显式列字段（去掉 content/text）；新增 `getContent(c, emailId, userId)` 方法。 |
| `mail-worker/src/api/email-api.js` | **修改** | 新增 `GET /email/content/:emailId` 路由。 |
| `mail-worker/src/api/all-email-api.js` | **修改** | （无路由新增，allList 已在 service 改） |
| `mail-worker/src/hono/hono.js` | **修改** | 注册 noCache 中间件，覆盖 `/email/`、`/allEmail/`（content 路由例外）。 |
| `mail-worker/src/service/r2-service.js` | **修改** | `getObj` 路径补 Cache-Control（通过 r2-api.js）。 |
| `mail-worker/src/api/r2-api.js` | **修改** | `/oss/*` 响应补长缓存头。 |
| `mail-worker/src/service/kv-obj-service.js` | **修改** | `toObjResp` 兜底默认长缓存头。 |
| `mail-worker/src/service/att-service.js` | **修改** | inline 图片 cacheControl 从 259200 延长到 604800。 |

### 前端（mail-vue）

| 文件 | 操作 | 职责 |
|------|------|------|
| `mail-vue/src/request/email.js` | **修改** | 新增 `emailContent(emailId)` 请求方法。 |
| `mail-vue/src/store/email.js` | **修改** | 扩展 store：新增 `contentMap`（emailId→正文/Promise）、加载状态、存取方法。 |
| `mail-vue/src/views/content/index.vue` | **修改** | 正文从 store 按需取，改为响应式加载。 |

### 交付物

| 文件 | 操作 | 职责 |
|------|------|------|
| `docs/edgeone/rule-mail.json` | **新建** | EdgeOne 可导入规则文件。 |

---

## Task 1: 新建缓存头中间件

**Files:**
- Create: `mail-worker/src/middleware/cache-headers.js`

**Interfaces:**
- Produces: `noCacheHeaders(c, next)` —— Hono 中间件，对动态 email 路由注入双 no-store 头；`longCacheHeaders(c)` —— 辅助函数，给正文/附件响应注入长缓存头；`noStoreHeaders(c)` —— 辅助函数，给错误响应注入 no-store 头。

- [ ] **Step 1: 创建中间件文件**

```js
// mail-worker/src/middleware/cache-headers.js
// 缓存头治理中间件 —— 参照 portal 的 noCacheHeaders 经验
// 动态 email 路由用双头（浏览器 + EdgeOne），正文/附件走长缓存

const NO_STORE = 'no-store, no-cache, must-revalidate';
const LONG_CACHE = 'public, max-age=604800, immutable';

// 中间件：对所有匹配路由注入 no-store 双头（浏览器 + cdn）
function noCacheHeaders(c, next) {
	c.header('Cache-Control', NO_STORE);
	c.header('cdn-cache-control', 'no-store');
	return next();
}

// 辅助函数：给正文/附件的 200 响应注入长缓存头
function longCacheHeaders(c) {
	c.header('Cache-Control', LONG_CACHE);
	c.header('cdn-cache-control', `public, max-age=604800`);
}

// 辅助函数：给错误响应（404/403）注入 no-store，避免错误被边缘缓存
function noStoreHeaders(c) {
	c.header('Cache-Control', NO_STORE);
	c.header('cdn-cache-control', 'no-store');
}

export { noCacheHeaders, longCacheHeaders, noStoreHeaders };
```

- [ ] **Step 2: 验证语法（本地加载检查）**

Run: `cd mail-worker && node -e "import('./src/middleware/cache-headers.js').then(m => console.log(Object.keys(m)))"`
Expected: 输出 `[ 'longCacheHeaders', 'noCacheHeaders', 'noStoreHeaders' ]`

> 注：Workers 环境用 ESM，本地 node 直接 import 可能因依赖 hono 报错。若报错，改为只检查语法：`cd mail-worker && node --check src/middleware/cache-headers.js`（应无输出=通过）。

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/middleware/cache-headers.js
git commit -m "feat(cache): add cache-headers middleware (noCache/longCache/noStore)"
```

---

## Task 2: 注册 noCache 中间件覆盖动态路由

**Files:**
- Modify: `mail-worker/src/hono/hono.js`

**Interfaces:**
- Consumes: Task 1 的 `noCacheHeaders`
- Produces: 所有 `/email/`、`/allEmail/` GET 请求（除 `/email/content/`）自动带 no-store 双头

- [ ] **Step 1: 读取当前 hono.js 确认中间件挂载点**

当前 `hono.js:7` 已有 `app.use('*', cors())`。noCache 中间件挂在其后、路由 import（通过 webs.js）之前。但注意：`webs.js` 在 `index.js:1` import，而 security 中间件在 webs.js 内 import，hono app 实例在 `hono.js` export 时就已装配。

**关键**：noCache 中间件要挂在 `hono.js` 里 `app.use('*', cors())` 之后，确保对所有路由生效。

- [ ] **Step 2: 修改 hono.js，注册 noCache 中间件**

在 `mail-worker/src/hono/hono.js` 的 `app.use('*', cors());` 之后添加：

```js
import { noCacheHeaders } from '../middleware/cache-headers';

app.use('*', cors());

// 动态 email 路由永不缓存（浏览器 + EdgeOne 双头）
// 正文路由 /email/content/ 走长缓存，需在路由内自行设置头并豁免此处
app.use('/email/*', async (c, next) => {
	// 正文路由自己设长缓存头，这里放行让它自己处理
	if (c.req.path.startsWith('/email/content/')) {
		return next();
	}
	return noCacheHeaders(c, next);
});
app.use('/allEmail/*', noCacheHeaders);
```

- [ ] **Step 3: 本地 dev 启动验证中间件不报错**

Run: `cd mail-worker && timeout 10 npx wrangler dev --config wrangler-dev.toml 2>&1 | head -20`
Expected: 启动日志无报错（看到 "Ready"）。如果本地无 D1/KV 绑定会报错，那属正常（只要不是语法/导入错误即可）。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/hono/hono.js
git commit -m "feat(cache): register noCache middleware for dynamic email routes"
```

---

## Task 3: 后端 list 接口瘦身（移除 content/text）

**Files:**
- Modify: `mail-worker/src/service/email-service.js:74-95`（list 的 select）、`:783`（allList 的 select）、`:652`（latest 的 select）、`:827`（allEmailLatest 的 select）

**Interfaces:**
- Produces: `list()`、`allList()`、`latest()`、`allEmailLatest()` 返回的列表项不再含 content/text 字段

**说明**：当前这 4 个方法用 `...email`（spread 全列）或 `.select({...email})`。Drizzle 的 spread 语法 `select({...email})` 会选全部列。要排除 content/text，改为显式指定保留列。由于 email 实体有 23 列，排除 2 列，用 Drizzle 的 `exclude` 或显式列出保留列。本计划采用**显式列出一个不含 content/text 的子集对象**，最清晰且无歧义。

- [ ] **Step 1: 在 email 实体旁定义"列表用字段集"（避免在 4 处重复）**

在 `mail-worker/src/service/email-service.js` 文件顶部 import 之后，添加一个列表字段集常量。由于 Drizzle spread 的特性，我们用 Object 解构排除 content/text：

```js
// 列表接口专用字段集：排除沉重的 content 和 text（移至 /email/content/:id 单独取）
const { content: _c, text: _t, ...emailListFields } = email;
```

- [ ] **Step 2: 修改 list() 的 select（第 74-78 行附近）**

将 `list()` 方法中的：
```js
const query = orm(c)
	.select({
		...email,
		starId: star.starId
	})
```
改为：
```js
const query = orm(c)
	.select({
		...emailListFields,
		starId: star.starId
	})
```

- [ ] **Step 3: 修改 latest() 的 select（第 652 行附近）**

将 `latest()` 方法中的：
```js
let list = await orm(c).select({...email}).from(email)
```
改为：
```js
let list = await orm(c).select({...emailListFields}).from(email)
```

- [ ] **Step 4: 修改 allList() 的 select（第 783 行附近）**

将 `allList()` 方法中的：
```js
const query = orm(c).select({ ...email, userEmail: user.email })
```
改为：
```js
const query = orm(c).select({ ...emailListFields, userEmail: user.email })
```

- [ ] **Step 5: 修改 allEmailLatest() 的 select（第 827 行附近）**

将 `allEmailLatest()` 方法中的：
```js
let list = await orm(c).select({...email, userEmail: user.email}).from(email)
```
改为：
```js
let list = await orm(c).select({...emailListFields, userEmail: user.email}).from(email)
```

- [ ] **Step 6: 提交**

```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat(cache): drop content/text from list/latest/allList/allEmailLatest selects"
```

---

## Task 4: 新增 getContent service 方法

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（新增方法）

**Interfaces:**
- Consumes: `memberService.getVisibleAccountIds`、`memberService.assertMember`
- Produces: `emailService.getContent(c, emailId, userId)` → 返回 `{ content, text }` 或抛 BizError

- [ ] **Step 1: 在 email-service.js 的 emailService 对象内新增 getContent 方法**

在 `emailService` 对象内（建议放在 `latest` 方法之后）新增：

```js
	// 获取单封邮件正文（content + text），用于列表/正文分离后的按需加载
	// 正文不可变，调用方负责设长缓存头
	async getContent(c, emailId, userId) {
		const row = await orm(c).select({
			content: email.content,
			text: email.text,
			accountId: email.accountId,
			isDel: email.isDel
		}).from(email).where(eq(email.emailId, emailId)).get();

		// 不存在或逻辑删除 → 对前端等同于不存在
		if (!row || row.isDel === isDel.DELETE) {
			throw new BizError(t('emailNotFound'), 404);
		}

		// 鉴权：校验该用户有权访问此邮件所属邮箱
		// 先查用户是否为该 accountId 的成员（覆盖个人邮箱 + 共享邮箱两种场景）
		await memberService.assertMember(c, row.accountId, userId);

		return { content: row.content || '', text: row.text || '' };
	},
```

- [ ] **Step 2: 确认 i18n key emailNotFound 存在，或复用现有的**

Run: `cd mail-worker/src && grep -rn "emailNotFound\|邮件不存在\|notFound" i18n/ 2>/dev/null | head`

若不存在，在 `mail-worker/src/i18n/` 的中英文 json 里补充 `"emailNotFound": "邮件不存在 Email not found"`（具体文件名按 grep 结果定）。

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/email-service.js mail-worker/src/i18n/
git commit -m "feat(email): add getContent service method for on-demand body loading"
```

---

## Task 5: 新增 /email/content/:emailId 路由

**Files:**
- Modify: `mail-worker/src/api/email-api.js`

**Interfaces:**
- Consumes: Task 1 的 `longCacheHeaders`、`noStoreHeaders`；Task 4 的 `emailService.getContent`；`userContext.getUserId`
- Produces: `GET /email/content/:emailId` → 200 `{content, text}` 长缓存 / 404 / 403

- [ ] **Step 1: 在 email-api.js 顶部添加 import，并新增路由**

在 `mail-worker/src/api/email-api.js` 顶部 import 区添加：

```js
import { longCacheHeaders, noStoreHeaders } from '../middleware/cache-headers';
```

在文件末尾（现有路由之后）新增：

```js
app.get('/email/content/:emailId', async (c) => {
	const emailId = Number(c.req.param('emailId'));
	const userId = userContext.getUserId(c);
	try {
		const data = await emailService.getContent(c, emailId, userId);
		longCacheHeaders(c);
		return c.json(result.ok(data));
	} catch (e) {
		// 404/403 错误不缓存（避免错误响应被边缘缓存）
		noStoreHeaders(c);
		throw e;
	}
});
```

**注意**：noCache 中间件（Task 2）已对 `/email/content/` 放行（return next() 不设头），所以这里设的长缓存头不会被覆盖。

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/api/email-api.js
git commit -m "feat(email): add GET /email/content/:emailId route with 7d edge cache"
```

---

## Task 6: 附件与 KV 路径补长缓存头

**Files:**
- Modify: `mail-worker/src/api/r2-api.js`（/oss/* 补头）
- Modify: `mail-worker/src/service/kv-obj-service.js:28-43`（toObjResp 兜底）
- Modify: `mail-worker/src/service/att-service.js:27, 179`（inline 图片 259200→604800）

**Interfaces:**
- Consumes: Task 1 的 `longCacheHeaders`

- [ ] **Step 1: r2-api.js 的 /oss/* 补长缓存头**

当前 `r2-api.js:4-13` 的响应没设 Cache-Control。改为：

```js
import { longCacheHeaders } from '../middleware/cache-headers';

app.get('/oss/*', async (c) => {
	const key = c.req.path.split('/oss/')[1];
	const obj = await r2Service.getObj(c, key);
	longCacheHeaders(c);
	return new Response(obj.body, {
		headers: {
			'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
			'Content-Disposition': obj.httpMetadata?.contentDisposition || null
		}
	});
});
```

注意：`longCacheHeaders(c)` 用 `c.header()` 设头，Hono 会合并到最终响应头。`new Response` 的 headers 不含 Cache-Control，由 Hono 的 c.header 注入。验证 Hono 版本支持此用法——若不生效，改为直接在 Response headers 里写 `'Cache-Control': 'public, max-age=604800, immutable'`。

- [ ] **Step 2: kv-obj-service.js 的 toObjResp 兜底长缓存头**

当前 `kv-obj-service.js:39` 取 `obj.metadata?.cacheControl || null`，多数情况为 null。改为兜底 604800：

```js
	'Cache-Control': obj.metadata?.cacheControl || 'public, max-age=604800, immutable'
```

- [ ] **Step 3: att-service.js inline 图片延长缓存**

将 `att-service.js:27` 的：
```js
metadate.cacheControl = `max-age=259200`
```
改为：
```js
metadate.cacheControl = `public, max-age=604800, immutable`
```

将 `att-service.js:179` 的：
```js
cacheControl: `max-age=259200`,
```
改为：
```js
cacheControl: `public, max-age=604800, immutable`,
```

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/api/r2-api.js mail-worker/src/service/kv-obj-service.js mail-worker/src/service/att-service.js
git commit -m "feat(cache): long-cache headers for attachments, inline images, KV/R2 objects"
```

---

## Task 7: 后端 curl 验证清单

本任务无代码改动，是后端 Task 1-6 的验收验证。需 `wrangler dev` 本地起服务后执行。

- [ ] **Step 1: 启动本地 dev 服务**

Run: `cd mail-worker && npx wrangler dev --config wrangler-dev.toml`
（保持运行，另开终端执行下面 curl）

- [ ] **Step 2: 验证 /email/list 响应头含 no-store 且体不含 content/text**

先用有效 JWT 登录拿到 token（参考现有登录流程），或临时在 security.js 的 exclude 里加 `/email/list` 以便测试。然后：

```bash
curl -i http://localhost:8787/api/email/list?accountId=1&size=5&type=0 -H "token: <JWT>"
```

断言：
- 响应头含 `Cache-Control: no-store, no-cache, must-revalidate`
- 响应头含 `cdn-cache-control: no-store`
- 响应体 JSON 的 `data.list[0]` **不含** `content` 和 `text` 字段
- 响应体 `data.list[0]` **仍含** `emailId`、`subject`、`unread`、`isStar`

- [ ] **Step 3: 验证 /email/content/:emailId 长缓存头**

```bash
curl -i http://localhost:8787/api/email/content/1 -H "token: <JWT>"
```

断言：
- 200 响应头含 `Cache-Control: public, max-age=604800, immutable`
- 响应头含 `cdn-cache-control: public, max-age=604800`
- 响应体含 `content` 和 `text`

- [ ] **Step 4: 验证不存在/无权 emailId 的 404/403 不缓存**

```bash
curl -i http://localhost:8787/api/email/content/999999999 -H "token: <JWT>"
```

断言：
- 404 响应头含 `Cache-Control: no-store`
- 404 响应头含 `cdn-cache-control: no-store`

- [ ] **Step 5: 记录验证结果**

在计划文件对应 checkbox 打勾，或在本会话记录"后端验证通过"。无需提交代码。

---

## Task 8: 前端新增 emailContent 请求方法

**Files:**
- Modify: `mail-vue/src/request/email.js`

**Interfaces:**
- Produces: `emailContent(emailId)` → Promise 返回 `{content, text}`

- [ ] **Step 1: 在 email.js 新增 emailContent 方法**

在 `mail-vue/src/request/email.js` 末尾新增：

```js
export function emailContent(emailId) {
    return http.get(`/email/content/${emailId}`)
}
```

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/request/email.js
git commit -m "feat(email): add emailContent request method"
```

---

## Task 9: 前端 store 扩展正文内存缓存

**Files:**
- Modify: `mail-vue/src/store/email.js`

**Interfaces:**
- Consumes: Task 8 的 `emailContent`
- Produces: store 新增 `contentMap` state + `loadContent(emailId)` action

- [ ] **Step 1: 重写 store/email.js，加入 contentMap 和 loadContent**

当前 store 是 Options API 风格。扩展为：

```js
import { defineStore } from 'pinia'
import { emailContent } from '@/request/email.js'

export const useEmailStore = defineStore('email', {
    state: () => ({
        deleteIds: 0,
        starScroll: null,
        emailScroll: null,
        cancelStarEmailId: 0,
        addStarEmailId: 0,
        contentData: {
            email: null,
            delType: null,
            showStar: true,
            showReply: true,
            showUnread: false
        },
        sendScroll: null,
        // 正文内存缓存：emailId → { content, text } 或 Promise（加载中）
        contentMap: {},
    }),
    persist: {
        pick: ['contentData'],
    },
    actions: {
        // 按需加载正文，带去重（同 emailId 并发请求复用同一 Promise）
        async loadContent(emailId) {
            const id = Number(emailId);
            // 已缓存（含加载中的 Promise）直接返回
            if (this.contentMap[id]) {
                return this.contentMap[id];
            }
            // 发起请求并存 Promise，完成后替换为实际数据
            const promise = emailContent(id).then(res => {
                const data = res?.data || { content: '', text: '' };
                this.contentMap[id] = data;
                return data;
            }).catch(e => {
                // 失败时清除，允许重试
                delete this.contentMap[id];
                throw e;
            });
            this.contentMap[id] = promise;
            return promise;
        },
    },
})
```

注意：`contentMap` 不放 persist.pick（正文不持久化到 localStorage，每次会话重新从边缘缓存取，避免本地存储膨胀）。

- [ ] **Step 2: 提交**

```bash
git add mail-vue/src/store/email.js
git commit -m "feat(email): add contentMap + loadContent action to email store"
```

---

## Task 10: content 组件改为按需加载正文

**Files:**
- Modify: `mail-vue/src/views/content/index.vue`

**Interfaces:**
- Consumes: Task 9 的 `store.loadContent`；当前 email 对象（来自 contentData.email，含 emailId 但不再含 content/text）
- Produces: 正文区域按 emailId 从 store 加载，含 loading/error 状态

- [ ] **Step 1: 改造 content/index.vue 的 script，加入正文加载逻辑**

当前 `content/index.vue:123` 是 `const email = emailStore.contentData.email`，模板第 56 行直接用 `email.content`。改为：

在 `<script setup>` 中（`const email = ...` 之后）添加：

```js
import { emailContent } from "@/request/email.js";  // 已有 emailDelete 等 import，补充

// 正文按需加载：email 对象现在不含 content/text，从 store 按需取
const emailBody = ref({ content: '', text: '' });
const bodyLoading = ref(false);
const bodyError = ref(false);

async function loadEmailBody() {
    if (!email?.emailId) return;
    bodyLoading.value = true;
    bodyError.value = false;
    try {
        emailBody.value = await emailStore.loadContent(email.emailId);
    } catch (e) {
        console.error('load email body failed:', e);
        bodyError.value = true;
    } finally {
        bodyLoading.value = false;
    }
}

// email 变化时重新加载（从不同邮件跳转过来时）
watch(() => emailStore.contentData.email?.emailId, () => {
    loadEmailBody();
}, { immediate: true });
```

- [ ] **Step 2: 改造模板，用 emailBody 替代 email.content/email.text**

将模板第 55-59 行的正文区域：
```html
<el-scrollbar class="htm-scrollbar" :class="attList.length === 0 ? 'bottom-distance' : ''">
    <ShadowHtml class="shadow-html" :html="formatImage(email.content)" v-if="hasDisplayableHtml(email.content)" />
    <pre v-else-if="email.text" class="email-text" >{{email.text}}</pre>
    <div v-else class="no-content">{{ $t('noContent') }}</div>
</el-scrollbar>
```
改为：
```html
<el-scrollbar class="htm-scrollbar" :class="attList.length === 0 ? 'bottom-distance' : ''">
    <div v-if="bodyLoading" class="no-content">{{ $t('loading') }}</div>
    <div v-else-if="bodyError" class="no-content" @click="loadEmailBody" style="cursor:pointer">
        {{ $t('loadFailed') }} ({{ $t('retry') }})
    </div>
    <template v-else>
        <ShadowHtml class="shadow-html" :html="formatImage(emailBody.content)" v-if="hasDisplayableHtml(emailBody.content)" />
        <pre v-else-if="emailBody.text" class="email-text" >{{emailBody.text}}</pre>
        <div v-else class="no-content">{{ $t('noContent') }}</div>
    </template>
</el-scrollbar>
```

- [ ] **Step 3: 确认 i18n key loading/loadFailed/retry 存在**

Run: `cd mail-vue/src && grep -rn '"loading"\|"loadFailed"\|"retry"' locales/ i18n/ 2>/dev/null | head`

若缺失，在对应语言文件补充。若已有同类 key（如 `noContent`），复用。

- [ ] **Step 4: 检查 content 组件中其他使用 email.content 的地方**

Run: `cd mail-vue/src && grep -n "email\.content\|email\.text" views/content/index.vue`

除模板第 56-57 行（已改）外，检查 `quickSummary`/`quickTranslate`/`quickAiReply` 等 AI 功能是否用到 email.content。从当前代码看（第 148-173 行），AI 功能用的是 `email.emailId`（后端按 emailId 自己取正文），不依赖前端 email.content，**无需改动**。但执行时需再确认 ai-api 后端是否读 content。

- [ ] **Step 5: 本地构建验证无编译错误**

Run: `cd mail-vue && npx vite build --mode release 2>&1 | tail -10`
Expected: 构建成功，无 "email.content is undefined" 类编译错误（Vue 模板编译期不会报运行时 undefined）。

- [ ] **Step 6: 提交**

```bash
git add mail-vue/src/views/content/index.vue mail-vue/src/locales/
git commit -m "feat(email): content view loads body on-demand from store with loading/error states"
```

---

## Task 11: 首封预加载

**Files:**
- Modify: `mail-vue/src/views/email/index.vue`、`mail-vue/src/views/all-email/index.vue`

**说明**：列表加载完成后预取默认选中邮件的正文。需找到列表加载完成、确定"首封"的时机。

- [ ] **Step 1: 定位列表加载完成、首封确定的时机**

查看 email-scroll 组件（列表渲染组件），确认它 emit 什么事件或暴露什么 ref 表示"首封 emailId"。当前 email/index.vue 用 `emailScroll` ref，`scroll.value.latestEmail?.emailId` 表示最新邮件。

**决策**：预加载在 `jumpContent` 触发前意义不大（因为 jumpContent 时才确定用户看哪封）。更合理的预加载点是"列表首次加载完成后，预取列表第一封的正文"（用户最可能点开最新一封）。但 email-scroll 是通用组件，4 个列表共用。

**简化方案（YAGNI）**：不在列表组件加预加载，而是在 content 组件 `onMounted` 时立即加载（Task 10 的 `immediate: true` watch 已实现）。用户从列表点击进入 content 页时，content 组件 mounted 立即触发加载——这已经是最快时机。**真正的"预加载"需要列表组件在用户点击前就 fetch，但点击前不知道用户看哪封，预加载全部浪费流量。**

**结论**：Task 10 的 `immediate: true` 已覆盖"进入 content 页立即加载"。本 Task 降级为"验证 immediate 加载生效"，不额外加预加载代码（避免过度设计）。

- [ ] **Step 2: 验证 content 组件 immediate 加载**

确认 Task 10 的 watch 用了 `{ immediate: true }`（已写）。本地 dev 跑前端，点开一封邮件，观察 Network 面板：应立即看到 `/email/content/:id` 请求。

- [ ] **Step 3: 提交（如无代码改动则跳过）**

本 Task 无新增代码（预加载由 Task 10 的 immediate watch 覆盖），无需提交。在计划里记录"首封预加载经评估降级，由 content 组件 immediate watch 覆盖，避免过度设计"。

---

## Task 12: 检查其他使用 email.content 的前端位置

**Files:**
- 可能修改: `mail-vue/src/views/send/index.vue`、`mail-vue/src/components/email-scroll/index.vue` 等引用列表项 content 的地方

- [ ] **Step 1: 全局搜索前端对列表项 .content / .text 的引用**

Run: `cd mail-vue/src && grep -rn "\.content\b\|\.text\b" views/ components/ --include="*.vue" | grep -iv "contentData\|textContent\|innerText\|textContent\|innerHTML\|iconContent\|menuContent\|editorContent\|aiContent\|message.content" | head -30`

人工甄别：哪些是访问邮件列表项的 `.content`（需改）、哪些是其他用途（如 AI 消息内容、DOM textContent）。

- [ ] **Step 2: 重点检查 email-scroll 组件的预览/摘要功能**

```bash
cd mail-vue/src/components/email-scroll && grep -n "content\|text" index.vue | head -20
```

若 email-scroll 用 `email.content` 做摘要预览（列表项显示正文前 N 字），改造后列表不含 content，摘要需调整：要么后端 list 接口额外返回一个 `preview` 短字段（本次不做），要么前端摘要改为只显示 subject。**决策**：若列表项当前不显示正文摘要（仅显示 subject/sender），则无需改动。

- [ ] **Step 3: 修复发现的所有引用**

按 grep 结果逐一处理。若发现 send/index.vue（已发送列表详情）也读 content，同样改为从 store 按需加载（复用 Task 9 的 loadContent）。

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/
git commit -m "fix(email): update all frontend references to list-item content/text"
```

---

## Task 13: 生成 EdgeOne 规则文件

**Files:**
- Create: `docs/edgeone/rule-mail.json`

**Interfaces:**
- 格式参照 Portal 的 `E:\code\portal\docs\edgeone\rule-compass.json`（FormatVersion 1.0 结构）

- [ ] **Step 1: 创建 EdgeOne 规则文件**

```json
{
  "FormatVersion": "1.0",
  "Rules": [
    {
      "RuleName": "邮件系统缓存-mail",
      "Branches": [
        {
          "Condition": "${http.request.host} in ['mail.example.com']",
          "Actions": [
            {
              "Name": "Cache",
              "CacheParameters": {
                "FollowOrigin": {
                  "Switch": "on",
                  "DefaultCache": "off",
                  "DefaultCacheStrategy": "off",
                  "DefaultCacheTime": 0
                }
              }
            },
            {
              "Name": "CacheKey",
              "CacheKeyParameters": {
                "QueryString": {
                  "Switch": "off",
                  "Values": []
                },
                "FullURLCache": "on",
                "IgnoreCase": "on"
              }
            }
          ],
          "SubRules": [
            {
              "Branches": [
                {
                  "Condition": "${http.request.uri.path} matches '^/email/content/'",
                  "Actions": [
                    {
                      "Name": "Cache",
                      "CacheParameters": {
                        "CustomTime": {
                          "Switch": "on",
                          "IgnoreCacheControl": "off",
                          "CacheTime": 604800
                        }
                      }
                    }
                  ]
                },
                {
                  "Condition": "${http.request.uri.path} matches '^/(static|attachments|oss)/'",
                  "Actions": [
                    {
                      "Name": "Cache",
                      "CacheParameters": {
                        "CustomTime": {
                          "Switch": "on",
                          "IgnoreCacheControl": "off",
                          "CacheTime": 604800
                        }
                      }
                    }
                  ]
                },
                {
                  "Condition": "${http.request.uri.path} matches '^/(email|allEmail)/'",
                  "Actions": [
                    {
                      "Name": "Cache",
                      "CacheParameters": {
                        "CustomTime": {
                          "Switch": "on",
                          "IgnoreCacheControl": "off",
                          "CacheTime": 0
                        }
                      }
                    }
                  ]
                }
              ],
              "Description": [
                "正文 /email/content/ 缓存7天; 附件 static/attachments/oss 缓存7天; 动态 email/allEmail 接口不缓存(每次回源)"
              ]
            }
          ]
        }
      ],
      "Description": [
        "邮件系统缓存规则(参照 portal rule-compass.json 格式,2026-08-03)",
        "部署前必须: 将 mail.example.com 替换为线上真实访问域名",
        "原理: 正文/附件是不可变内容(内容寻址),边缘长缓存7天; 列表/最新邮件是动态数据,每次回源保实时",
        "源站配合: Worker 已对动态路由发 Cache-Control:no-store + cdn-cache-control:no-store 双头,本规则是CDN层双保险",
        "CacheKey: 忽略 QueryString(正文/附件按路径缓存),全URL缓存,忽略大小写"
      ]
    }
  ]
}
```

- [ ] **Step 2: 提交**

```bash
git add docs/edgeone/rule-mail.json
git commit -m "docs(edgeone): add EdgeOne cache rule for mail system (7d body/attachment, no-store dynamic)"
```

---

## Task 14: 部署验证清单（文档）

**Files:**
- Create: `docs/edgeone/deploy-checklist.md`

- [ ] **Step 1: 创建部署验证清单**

```markdown
# 邮件 CDN 缓存改造 — 部署验证清单

## 部署前
- [ ] `docs/edgeone/rule-mail.json` 中 `mail.example.com` 已替换为真实域名

## 部署（前后端一起发）
- [ ] `cd mail-worker && wrangler deploy`（会自动触发前端 build 并一起部署）
- [ ] 部署成功，无报错

## EdgeOne 规则导入
- [ ] 登录 EdgeOne 控制台
- [ ] 站点 → 规则引擎 → 导入 `docs/edgeone/rule-mail.json`
- [ ] 规则生效

## 功能验证
- [ ] 打开邮件列表，列表正常加载（subject/发件人/时间/未读/星标显示正常）
- [ ] 列表加载速度明显变快（响应体应从 MB 级降到 KB 级）
- [ ] 点开一封邮件，正文正常显示（首次有轻微加载，第二次秒开）
- [ ] 标记已读后刷新列表，未读状态实时变化
- [ ] 删除一封邮件，列表立即移除（无 CDN 延迟）
- [ ] 收到新邮件，列表轮询能拉到新邮件
- [ ] 附件下载/预览正常

## CDN 缓存验证（curl）
- [ ] `curl -I https://<域名>/api/email/list -H "token: <JWT>"` → 响应头含 `Cache-Control: no-store`
- [ ] `curl -I https://<域名>/api/email/content/1 -H "token: <JWT>"` → 响应头含 `max-age=604800`
- [ ] 二次访问 content → `EO-Cache-Status: HIT`
- [ ] 列表二次访问 → `EO-Cache-Status: MISS`（每次回源）
```

- [ ] **Step 2: 提交**

```bash
git add docs/edgeone/deploy-checklist.md
git commit -m "docs(edgeone): add deploy verification checklist"
```

---

## Self-Review

**1. Spec coverage（spec 各节 vs Task）：**

| Spec 节 | 覆盖 Task |
|---------|-----------|
| §3 列表与正文分离 | Task 3（list 瘦身）+ Task 4/5（content 接口） |
| §4 前端正文加载策略 | Task 8/9/10（请求+store+组件）+ Task 11（预加载评估） |
| §5.1 正文长缓存头 | Task 1（longCacheHeaders）+ Task 5（路由用） |
| §5.2 列表 no-store 双头 | Task 1（noCacheHeaders）+ Task 2（中间件注册） |
| §5.3 附件/KV 长缓存 | Task 6 |
| §5.4 写操作不缓存 | 天然（POST/PUT/DELETE），无需 Task |
| §6 鉴权与边界 | Task 4（getContent 鉴权+404/403）+ Task 5（noStoreHeaders 错误） |
| §7 EdgeOne 规则 | Task 13 |
| §8 字段瘦身清单 | Task 3 |
| §9 测试策略 | Task 7（curl 验证）+ Task 12（前端引用检查） |
| §10 部署 | Task 14（部署清单） |

**无遗漏。**

**2. Placeholder scan：** Task 11 是有意降级（YAGNI 决策，已说明理由），非占位符。Task 12 的"按 grep 结果逐一处理"是因结果依赖运行环境，无法预写——但给出了明确的判断标准和处理方式。其余无 TBD/TODO。

**3. Type consistency：** `emailListFields` 在 Task 3 定义，Task 3 的 4 个 step 一致使用。`loadContent(emailId)` 在 Task 9 定义，Task 10 消费，签名一致。`longCacheHeaders`/`noStoreHeaders` 在 Task 1 定义，Task 5/6 消费，一致。

**4. 风险点标注：**
- Task 6 Step 1 的 Hono `c.header()` 与 `new Response` 合并行为需验证（已在 step 内注明 fallback）
- Task 12 的 grep 结果依赖代码现状，执行时需人工甄别
- 项目无单元测试框架，采用 curl 验证（已说明理由）

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-03-email-cdn-cache.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
