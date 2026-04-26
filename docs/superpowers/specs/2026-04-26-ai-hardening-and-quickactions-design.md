# AI 安全加固、快捷操作与 MCP 增强 — 设计规范

**日期**：2026-04-26
**范围**：7 项改进，涵盖安全加固、UX 快捷操作、对话历史记录、MCP 传输层与工具补全

---

## 1. 安全加固

### 1.1 isPromptInjection 改为 fail-closed

**文件**：`mail-worker/src/service/ai-provider.js` — `isPromptInjection` 方法

**当前行为**：扫描失败时 `return false`（放行）。

**目标行为**：扫描失败时 `return true`（阻止自动草稿）。邮件仍正常接收入库，仅跳过自动草稿生成。参照 agentic-inbox `workers/lib/ai.ts:53-58` 的 fail-closed 策略。

**改动**：catch 块中 `return false` → `return true`，日志文本改为 `Prompt injection check failed, blocking by default`。

### 1.2 verifyDraft 增加 50% 安全检查

**文件**：`mail-worker/src/service/ai-provider.js` — `verifyDraft` 方法

在 AI 返回清理结果后，对比清理前后长度：
- 如果清理后文本长度 < 原文长度 × 0.5，认为 AI 过于激进，回退使用原文
- 添加 `console.warn` 日志记录此情况
- 参照 agentic-inbox `workers/lib/ai.ts:168`

### 1.3 verifyDraft 增加 blockquote 分离

**文件**：`mail-worker/src/service/ai-provider.js` — `verifyDraft` 方法

验证前分离 HTML 中的引用块：

1. 新增 `_splitQuotedBlock(html)` 方法：用正则匹配末尾的 `<blockquote>...</blockquote>` 及其前导换行
2. `verifyDraft` 流程改为：
   - 检测输入是否包含 HTML 标签
   - 如果是 HTML，调用 `_splitQuotedBlock` 分离 reply 和 quoted 部分
   - 提取 reply 部分的纯文本送给 AI 审核
   - 如果 reply 纯文本 < 20 字符，跳过验证返回原文
   - AI 审核后检查 50% 安全阈值
   - 如果内容有变更，将清理后文本转回 HTML 并拼接 quoted 块
3. 纯文本输入不做 blockquote 分离，直接审核

参照 agentic-inbox `workers/lib/ai.ts` 的 `splitQuotedBlock` 函数。

---

## 2. Auto-draft 对话历史记录

### 2.1 handleNewEmail 写入 ai_conversations

**文件**：`mail-worker/src/service/ai-service.js` — `handleNewEmail` 方法

在自动草稿流程结束后，将交互记录追加到 `ai_conversations` 表：

**Conversation ID 策略**：使用固定 ID `auto-draft-{userId}`，所有自动草稿记录追加到同一对话，避免每封邮件创建新对话记录。

**记录内容**（根据结果分三种）：

| 结果 | user 消息 | assistant 消息 |
|------|----------|---------------|
| 成功 | `[Auto] 收到 {sender} 的邮件 "{subject}"` | `已为该邮件创建回复草稿` |
| 被拦截 | `[Auto] 收到 {sender} 的邮件 "{subject}"` | `⚠️ 检测到可疑内容，已跳过自动草稿` |
| 失败 | `[Auto] 收到 {sender} 的邮件 "{subject}"` | `自动草稿生成失败: {reason}` |

**实现**：
- 从 DB 读取已有对话（若存在），解析 messages JSON
- 追加新消息对（user + assistant），每条带 timestamp
- 写回 DB（INSERT ON CONFLICT UPDATE）
- 控制 messages 数组长度上限为 100 条，超出时裁剪最早的记录

---

## 3. AiQuickActions — 邮件详情 AI 快捷按钮

### 3.1 UI 位置

**文件**：`mail-vue/src/views/content/index.vue`

在 `header-actions` 工具栏的"下载"图标后面，添加一个视觉分隔线（`<span class="divider">`），然后放置三个 AI 快捷按钮。仅当 `settingStore.settings.aiEnabled === 1` 时渲染。

### 3.2 三个按钮

| 按钮 | 图标 | 行为 |
|------|------|------|
| 摘要 | `mdi:text-box-search-outline` | 打开 AI 侧边栏，发送 `请帮我总结这封邮件的要点` |
| 翻译 | `mdi:translate` | el-dropdown 下拉菜单，选项：中文、英文、日文、韩文、法文。选择后打开侧边栏，发送 `请将这封邮件翻译成{语言}` |
| AI 回复 | `mdi:robot-outline` | 打开 AI 侧边栏，发送 `请帮我起草一封回复` |

### 3.3 aiStore 新增 action

**文件**：`mail-vue/src/store/ai.js`

新增 `sendQuickAction(text, emailId)` action：
1. `this.currentEmailId = emailId`
2. 打开 UI 侧边栏 `uiStore.aiSidebarOpen = true`
3. 调用 `this.sendMessage(text)`

`content/index.vue` 直接调用此 action，不需要创建独立的 AiQuickActions 组件。

### 3.4 i18n

新增 key：`aiQuickSummary`、`aiQuickTranslate`、`aiQuickReply`、`aiQuickTranslateTo`（以及各语言选项 key）。

---

## 4. MCP 增强

### 4.1 MCP SSE 完整双向传输

**文件**：`mail-worker/src/api/mcp-api.js`

**架构**（遵循 MCP SSE 传输规范 2024-11-05）：

- `GET /mcp/sse`：建立 SSE 连接，生成 `sessionId`，发送 `endpoint` 事件（URL 含 sessionId），保持连接存活
- `POST /mcp?sessionId=xxx`：客户端发送 JSON-RPC 请求，服务端通过 SSE 推送响应，POST 返回 202 Accepted

**Workers 环境适配**：

```
全局 Map<sessionId, { writer, userId, createdAt }>
```

- SSE handler 创建 session，存入 Map
- POST handler 通过 sessionId 查找 writer，将 JSON-RPC 响应序列化后通过 SSE `message` 事件推送
- **降级策略**：如果找不到 session（isolate 回收），直接在 HTTP 响应体中返回 JSON-RPC 结果（不返回 202），确保客户端始终能获取响应
- SSE 连接超时 5 分钟，30s keep-alive ping
- 连接关闭时从 Map 中清除 session

**SSE 事件格式**：
```
event: endpoint
data: /mcp?sessionId=abc123

event: message
data: {"jsonrpc":"2.0","id":1,"result":{...}}
```

### 4.2 MCP 新增 create_draft 工具

**文件**：`mail-worker/src/service/mcp-service.js` — `mcpExtraTools` 数组

| 字段 | 值 |
|------|-----|
| name | `create_draft` |
| description | `Create a new draft email and save it to Drafts. Does not send.` |
| inputSchema | `body`(required), `to`(optional), `subject`(optional), `accountId`(optional) |

**行为**：
- 创建草稿邮件，status = SAVING，type = SEND
- `to` 和 `subject` 可为空（用户可在 UI 中后续补充）
- 如果未指定 `accountId`，取用户第一个活跃账户
- 调用 `verifyDraft` 审核内容
- 返回 `{ created: true, emailId }`

**与 `draft_email` 的区别**：`draft_email` 是 AI 聊天工具，to/subject 必填；`create_draft` 是 MCP 工具，更灵活。

---

## 5. 文件改动清单

| 文件 | 改动类型 | 涉及项 |
|------|---------|--------|
| `mail-worker/src/service/ai-provider.js` | 修改 | 1.1, 1.2, 1.3 |
| `mail-worker/src/service/ai-service.js` | 修改 | 2.1 |
| `mail-worker/src/api/mcp-api.js` | 修改 | 4.1 |
| `mail-worker/src/service/mcp-service.js` | 修改 | 4.2 |
| `mail-vue/src/views/content/index.vue` | 修改 | 3.1, 3.2 |
| `mail-vue/src/store/ai.js` | 修改 | 3.3 |
| `mail-vue/src/i18n/zh.js` | 修改 | 3.4 |
| `mail-vue/src/i18n/en.js` | 修改 | 3.4 |
