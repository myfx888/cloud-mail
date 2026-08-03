# 邮件系统 CDN 缓存改造设计

- 日期：2026-08-03
- 状态：已通过设计评审，待实现
- 适用项目：cloud-mail（mail-worker / mail-vue）
- 参考案例：`E:\code\portal`（CDN 缓存治理成功案例，三支柱方案）
- 子项目范围：本设计仅覆盖**缓存策略（子项目②）**。外部 CDN 依赖治理（子项目①）与 CDN 部署优化（子项目③）另行单独 spec。

## 1. 背景与目标

### 1.1 现状问题

当前邮件系统存在两个并存的问题：

1. **列表加载慢**：`/email/list` 一次查询把"列表元数据 + 完整正文（content HTML）+ 附件元数据"塞进同一个响应返回。每页最多 50 封，每封正文可达数十 KB～数 MB，导致一次列表请求的响应体常达几十 MB，D1 查询重、传输慢。
2. **CDN 缓存不刷新**：项目已接入 EdgeOne 前置 CDN，但没有源站缓存头治理。列表响应被边缘节点缓存后，出现"删除邮件/标记已读/收新邮件但页面几分钟不更新"的写后读延迟问题（与 Portal 当初完全相同）。

### 1.2 根因分析

核心矛盾：**"列表"与"正文"绑定在同一个响应里，导致缓存策略互斥。**

- 要缓存正文加速 → 整个列表响应都得缓存 → 列表不实时
- 要列表实时 → 整个响应都不缓存 → 正文无法加速

关键洞察：**邮件正文（content）是不可变的**——邮件一旦收到/发出，content 字段永远不会被修改（代码中无任何 UPDATE content 的逻辑）。会变的只有列表成员（收新邮件/删除）、`unread` 已读状态、`isStar` 星标，这些全是轻量字段。

### 1.3 设计目标

1. **列表实时刷新**：删除/已读/星标/收新邮件后，列表立即可见变化，无 CDN 延迟。
2. **正文与附件加速**：正文第二次打开极快（边缘命中），附件二次加载快。
3. **零缓存失效逻辑**：利用"正文不可变"特性，缓存的全部是不可变数据，无需 purge/失效机制，架构最干净。
4. **列出 EdgeOne 规则**：产出真实的、可导入 EdgeOne 控制台的规则文件。

### 1.4 与 Portal 方案的关系

Portal 的缓存治理（支柱 B）用"列表短缓存 + 主动 purge"（方案 B 思路）。本项目因数据特性不同——邮件正文不可变而列表字段频繁变动——采用更适合的**列表与内容分离（方案 A）**，正文永久缓存、列表永不缓存，从而彻底免除 purge 复杂度。EdgeOne 双头策略（`Cache-Control` + `cdn-cache-control`）直接复用 Portal 验证过的经验。

## 2. 关键决策（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 子项目优先级 | 先做缓存策略（②），资源治理（①）和部署优化（③）后续各自独立 spec | ② 是核心痛点、价值最高 |
| 缓存架构方向 | 方案 A：列表与正文分离 | 正文不可变，分离后缓存零失效 |
| 正文加载时机 | 点开时加载 + 前端内存缓存 + 首封预加载 | 流量最省、复杂度最低，叠加缓存掩盖首次延迟 |
| 已读实时性 | 短暂延迟可接受 | 但因列表 no-store，实际已读完全实时（优于预期） |
| 前置 CDN | 已接 EdgeOne | 缓存走"CDN 边缘缓存 + 源站头"双层 |
| 正文鉴权 | 方案①边缘缓存（public） | 接受"知道 emailId 即可访问正文"假设，邮件系统通行做法 |
| cc/bcc 字段 | 保留在 list 接口 | 体积小，避免详情页额外请求 |
| EdgeOne 域名 | 先用占位符 `mail.example.com` | 实现阶段替换为真实域名 |

## 3. 核心架构：列表与正文分离

### 3.1 接口职责重新划分

| 接口 | 数据 | 缓存策略 | 说明 |
|------|------|---------|------|
| **`/email/list`**（改造） | 列表元数据：emailId、sendEmail、name、subject、toEmail、toName、createTime、type、unread、isStar、attList、messageId、accountId、userId、status、sendMethod、inReplyTo、relation、resendEmailId、message、cc、bcc | **`no-store`**（永不缓存） | 始终实时。去掉 content/text 后响应体从 MB 级降到 KB 级，列表秒开 |
| **`/email/content/:emailId`**（新增） | 单封邮件的 `content`（正文 HTML）+ `text`（纯文本） | **边缘长缓存 7 天 + immutable** | 正文不可变，天然适合永久缓存。第二次打开极快 |

同样适用于：
- **`/allEmail/*`**（管理端列表）：同样 `no-store`，同样去掉 content/text。
- **`/email/latest`**、**`/allEmail/latest`**（轮询新邮件）：`no-store`。

### 3.2 关键原则

- **正文不可变**：邮件一旦收到/发出，content 永不修改。这是"永久缓存、零 purge"成立的基础。
- **可变字段（unread/isStar/列表成员）全部留在 list 接口**，保持实时。
- **缓存的全部是不可变数据**（正文、附件），不缓存的全部是可变数据（列表）。两类边界清晰，互不污染。

### 3.3 涉及的文件

| 文件 | 改动 |
|------|------|
| `mail-worker/src/service/email-service.js` `list()` | select 去掉 content/text 列；`allList()` 同理 |
| `mail-worker/src/api/email-api.js` | 新增 `GET /email/content/:emailId` 路由 |
| `mail-worker/src/service/email-service.js` | 新增 `getContent(c, emailId, userId)` 方法 |
| `mail-worker/src/security/`（中间件） | 新增 noCache 头中间件，覆盖 `/email/*`、`/allEmail/*`（content 例外） |
| `mail-vue/src/request/email.js` | 新增 `emailContent(emailId)` 方法 |
| `mail-vue/src/views/content/index.vue` | 正文从内存 store 取，缺失则请求 |
| `mail-vue/src/store/` | 新增/扩展 store 持有 `contentMap`（emailId → 正文） |
| `mail-vue/src/views/`（列表组件） | 列表加载后触发首封预加载 |

## 4. 前端正文加载策略

### 4.1 加载时机

**点开某封邮件时**拉取 `/email/content/:emailId`——用户点击/选中列表项才加载正文，符合邮件客户端三栏布局的典型交互。

### 4.2 三层缓存叠加掩盖延迟

1. **触发**：用户点击列表项
2. **前端内存缓存（Pinia store）**：拉到的正文存进 store 的 `contentMap[emailId]`；同一会话内再次点开同一封，直接用内存，零请求。正文不可变 → 内存缓存无失效问题。
3. **首封预加载**：list 加载完成后，立即预取"默认选中邮件"（通常是最新一封）的正文，覆盖"进来就看最新邮件"场景。其余邮件点开时才加载。
4. **边缘缓存兜底**：跨会话、跨用户第二次访问命中 EdgeOne 边缘节点，毫秒级返回。

### 4.3 并发与重复请求

Pinia store 的 contentMap 按 emailId 防重复——同一封邮件并发请求时，复用同一个 Promise（存 Promise 而非值），避免回源风暴。请求完成后替换为实际数据。

### 4.4 加载状态

正文加载期间前端显示骨架屏/loading；加载失败（404/403/网络错误）显示错误提示并提供重试。

## 5. 缓存策略与 Cache-Control 头

### 5.1 正文接口 `/email/content/:emailId` —— 长缓存

源站响应头（Worker 返回时注入）：
```
Cache-Control: public, max-age=604800, immutable    # 7 天，浏览器
cdn-cache-control: public, max-age=604800            # 显式告知 EdgeOne 缓存 7 天
```

- **7 天而非 1 年**：正文不可变理论上可 1 年，但正文 HTML 里可能含内嵌图片 URL（指向 R2/KV），将来存储域名迁移时旧缓存会引用旧 URL。7 天覆盖"用户反复查看"高频期，又给未来留自然刷新窗口。
- **EdgeOne CacheKey**：纯 pathname（`/email/content/:emailId`，忽略 query），保证多用户命中同一份缓存。
- **无需 purge**：正文永不修改；邮件删除后正文缓存自然过期（残留影响分析见 §6.4）。

### 5.2 列表接口 `/email/list`、`/email/latest`、`/allEmail/*` —— 永不缓存

源站响应头（双头策略，复用 Portal 经验）：
```
Cache-Control: no-store, no-cache, must-revalidate    # 给浏览器
cdn-cache-control: no-store                           # 显式告知 EdgeOne 不缓存
```

- **双头的意义**：历史上很多 CDN 会无视源站 `no-store` 仍缓存响应。`cdn-cache-control` 是 CDN 行业约定的"专门给 CDN 看的覆盖头"，EdgeOne 遵从这个头。同时发两个头是双保险。
- **实现方式**：全局中间件（类似 Portal 的 `noCacheHeaders()`），对所有 `/email/*`、`/allEmail/*` 的 GET 请求注入双头，**例外**是 `/email/content/`（它走长缓存头）。新增同类接口自动被覆盖，不漏。

### 5.3 附件 / 内嵌图片 `/static/*`、`/attachments/*`、`/oss/*` —— 长缓存

现状与改造：

| 路径 | 现状 | 改造 |
|------|------|------|
| 内嵌图片（inline，有 contentId） | `att-service.js:27` 设 `max-age=259200`（3天） | 延长到 `max-age=604800, immutable`（7天），对齐正文 |
| 真附件（attachment） | `r2-api.js:4-13` 未设 Cache-Control | 补 `Cache-Control: public, max-age=604800, immutable` |
| `/static/*`、`/attachments/*`（KV 路径） | `kv-obj-service.js:39` 取 metadata.cacheControl，多数为空 | 兜底默认长缓存头 `max-age=604800` |

- **附件可长缓存的依据**：附件按内容哈希命名（`att-service.js:68/146`：`ATTACHMENT_PREFIX + hash + ext`），哈希相同即内容相同，等同于内容寻址，天然不可变。
- **KV 路径的 Worker 入口处理**（`index.js:25-27`）：在 `kvObjService.toObjResp` 返回时，若 metadata 无 cacheControl，兜底注入默认长缓存头。

### 5.4 写操作 —— 天然不缓存

POST/PUT/DELETE 在 HTTP 语义上默认不被缓存，EdgeOne 也不缓存。`/email/read`、`/email/send`、`/email/delete`、`/email/restore` 等无需特殊处理。

## 6. 鉴权与边界情况

### 6.1 鉴权难题：长缓存 vs 私有数据

`Cache-Control: public` 意味着边缘节点可缓存，但邮件正文是私有的。矛盾点：

- 用 `private` → EdgeOne 不缓存，加速无效
- 用 `public` → EdgeOne 缓存，但理论上 A 用户请求结果可能"漏"给 B 用户

### 6.2 采用方案①：边缘缓存 + 回源鉴权

关键洞察：**EdgeOne 缓存键是 URL 路径 `/email/content/:emailId`，不含用户身份。正文内容只跟 emailId 有关（同一封邮件任何人看到的正文都一样——只要有权看）。**

1. **边缘层**：只认 URL，按 emailId 缓存正文。内容对所有有权访问者相同，缓存共享安全。
2. **回源层**（缓存未命中时）：Worker 仍完整校验权限（`userContext.getUserId` + `memberService.assertMember` / 共享邮箱可见性）。
3. **风险点**：边缘命中时不经过 Worker → 鉴权被跳过。

### 6.3 风险评估

- **emailId 是自增整数**，不可猜测（数据量大时猜中特定 emailId 概率低），但不是秘密。
- **攻击前提**：攻击者得知道目标 emailId，且该邮件已被缓存到其所在边缘节点。
- **共享邮箱场景**：同一邮箱成员本就都能看，缓存共享无问题。
- **不同租户场景**：邮件域名隔离（rttx.net/08386.com 等），跨租户猜 emailId 难度高。
- **结论**：接受"知道 emailId ≈ 有权访问正文"的假设。emailId 在前端列表里本来就会暴露给有权用户，这是 Gmail 等邮件系统的通行做法。

### 6.4 数据流

```
请求 GET /email/content/:emailId
  │
  ├─ EdgeOne 检查缓存（按 pathname）
  │    └─ 命中 → 直接返回正文（不回源）✅ 鉴权已在上次回源时校验过
  │
  └─ 未命中 → 回源 Worker
       │
       ├─ 1. 鉴权：userContext.getUserId(c) 校验登录态
       ├─ 2. 权限：查 email.userId；若共享邮箱(allReceive)，校验 memberService 可见性
       ├─ 3. 查询：SELECT content, text FROM email WHERE emailId = ?
       │
       ├─ 邮件不存在或物理删除 → 404（Cache-Control: no-store，不缓存 404）
       ├─ 邮件逻辑删除(isDel=1) → 404（避免泄露"存在过"，且列表已不返回）
       ├─ 无权访问 → 403（Cache-Control: no-store，避免错误响应被缓存）
       └─ 正常 → 200 + 正文 + 长缓存头
```

### 6.5 边界情况清单

| 情况 | 处理 | 缓存头 |
|------|------|--------|
| emailId 不存在 | 404 | `no-store` |
| 邮件逻辑删除（isDel=1） | 404（对前端等同于不存在） | `no-store` |
| 邮件物理删除（row 删除） | 404 | `no-store` |
| 无权访问 | 403 | `no-store` |
| 未登录 | 401（现有 userContext 拦截） | 现有逻辑 |
| content 为空（纯文本邮件） | 200，content 为空字符串，正常缓存 | 长缓存 |
| text 和 content 都为空 | 200 空正文 | 长缓存 |

### 6.6 删除邮件后的缓存残留

- 邮件删除时，列表立刻不显示（list 是 no-store）。
- 但边缘节点的正文缓存可能还活着（最长 7 天）。
- **逻辑删除**：可接受残留（数据还在 DB，只是 isDel=1）。
- **物理删除**（`physicsDelete`）：默认接受 7 天自然过期（物理删除是低频运维操作）。**可选增强**：删除时主动调 EdgeOne purge API 清单个 URL（EdgeOne 支持按 URL purge）。本次不实现，留作后续增强。

### 6.7 不在本次范围

- `/email/export`（导出 eml）：低频操作，需实时组装内容，保持现状。
- `/email/import`（导入 eml）：写操作，天然不缓存。

## 7. EdgeOne 规则（运维侧，交付物）

本节产出真实的、可导入 EdgeOne 控制台的规则文件，存于 `docs/edgeone/rule-mail.json`（实现阶段生成）。规则格式严格参照 Portal 已验证的 `E:\code\portal\docs\edgeone\rule-compass.json`。

### 7.1 规则设计

| 匹配条件 | CacheTime（秒） | 说明 |
|----------|----------------|------|
| `^/email/content/` | 604800（7天） | 正文边缘缓存 |
| `^/static/` `^/attachments/` | 604800（7天） | KV 附件边缘缓存 |
| `^/oss/` | 604800（7天） | R2 代理路径边缘缓存 |
| `^/email/` `^/allEmail/`（除 content） | 0（不缓存） | 动态数据每次回源 |

### 7.2 CacheKey 设计

- `QueryString: Switch=off`（忽略 query string 做缓存键）
- `FullURLCache: on`
- `IgnoreCase: on`

### 7.3 占位符说明

规则文件中域名条件使用占位符 `mail.example.com`，**部署前必须替换为线上真实访问域名**。文件顶部 Description 会明确标注此点。

### 7.4 与源站头的协作

EdgeOne 规则与源站 Cache-Control 头是双保险关系：
- EdgeOne 的 `^/email/` `CacheTime:0` 确保 CDN 层不缓存动态数据（即使源站头被某些环节忽略）。
- 源站的 `cdn-cache-control: no-store` 确保即使规则未覆盖新接口，CDN 也不缓存。
- 二者一致，治理最彻底。

## 8. 字段瘦身清单

### 8.1 list 接口 select 调整

`email-service.js` 的 `list()` 与 `allList()` 当前 select `...email`（全列）。改为显式列出保留字段，**排除 content 与 text**。

保留字段（22 个）：
```
emailId, sendEmail, name, accountId, userId, subject, cc, bcc,
recipient, toEmail, toName, inReplyTo, relation, messageId,
type, status, resendEmailId, message, unread, createTime, isDel, sendMethod
```

移除字段（2 个）：
```
content, text
```

（starId 由 leftJoin star 表得来，不在 email 实体内，不受影响。）

### 8.2 content 接口 select

`getContent()` 只取必要列：
```
SELECT content, text FROM email WHERE emailId = ?
```

## 9. 测试策略与防回归

### 9.1 源站行为测试（Worker 层）

| 测试用例 | 断言 |
|----------|------|
| `/email/list` 响应头 | 含 `Cache-Control: no-store` 且含 `cdn-cache-control: no-store` |
| `/email/list` 响应体 | 列表项**不含** content 和 text 字段 |
| `/email/list` 响应体 | 列表项**仍含** unread/isStar/subject/attList 等可变字段 |
| `/allEmail/list` 响应头/体 | 同上（no-store + 无 content/text） |
| `/email/content/:id` 正常 | 200，体含 content+text，头含 `max-age=604800` 和 `immutable` |
| `/email/content/:id` 不存在 | 404，头 `no-store` |
| `/email/content/:id` 无权 | 403，头 `no-store` |
| `/email/content/:id` 逻辑删除 | 404，头 `no-store` |

### 9.2 前端静态断言（防回退）

参照 Portal 的 vendor-localization.test.ts 思路：
- `request/email.js` 导出了 `emailContent` 方法
- list 请求的 params 不含对 content 的期待

### 9.3 不自动化（归为部署验证清单）

- EdgeOne 规则的端到端验证（依赖真实 CDN 环境）
- 用 `curl` 验证 `EO-Cache-Status` 头（MISS/HIT），参照 Portal 实测方法

## 10. 兼容性与部署

### 10.1 前后端同步部署

list 接口去掉 content/text 后，**旧版前端如果直接读 `email.content` 会拿到 undefined**。应对：
- 前后端在同一 Worker，本就同节奏部署，**一起改、一起发**
- 不做接口版本化（YAGNI——没有第三方调用者）
- 部署顺序：后端 + 前端一起发，避免拆开发导致的窗口期

### 10.2 EdgeOne 规则导入时机

代码部署后、规则导入前：正文接口走 `FollowOrigin`，按源站长缓存头缓存（功能正常，只是 CacheKey 可能含 query 影响命中率）。
规则导入后：CacheKey 规范化（忽略 query），命中率最优化。
**建议**：代码部署后立即导入规则，二者间隔尽量短。

## 11. 不做（YAGNI）

- ❌ 接口版本化（`/v2/email/list`）：无第三方调用者
- ❌ 列表短缓存 + purge：方案 A 已免除失效复杂度，不引入 purge
- ❌ 正文签名 token 鉴权：方案①已接受 emailId 假设
- ❌ EdgeOne purge API 集成：物理删除残留可接受，留作后续增强
- ❌ 滚动懒加载：点开加载已够用，不增加滚动观察复杂度
- ❌ cc/bcc 移到 content：体积小，保留在 list 避免详情页额外请求
