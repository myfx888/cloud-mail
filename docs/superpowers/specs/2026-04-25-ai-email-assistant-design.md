# AI 邮件助手 — 设计规格

> 移植自 [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) 的 AI 功能，适配 cloud-mail 架构，使用外部 OpenAI 兼容 API。

## 概述

为 cloud-mail 增加 AI 邮件助手功能，包含：侧边栏对话面板、13+ 邮件工具（tool calling）、收信自动草稿、prompt 注入检测、草稿内容审核、MCP 服务器。

### 决策记录

| 决策项 | 选择 |
|--------|------|
| AI API 方式 | 外部 OpenAI 兼容 API（base_url + api_key + model） |
| 实现方案 | 分层递进式（3 阶段） |
| UI 位置 | 右侧可折叠侧边栏 |
| API 调用方式 | 直接 HTTP fetch（无重型 SDK） |
| 配置范围 | 系统级全局配置 |
| 工具集 | 扩展集（13+ 工具，超过 agentic-inbox 的 9 个） |

### 交付阶段

- **Phase 1**：AI 基础设施 + 聊天面板 + 基础工具（list/get/search/draft/summarize/translate/mark_read）
- **Phase 2**：完整工具集 + 自动草稿 + 安全层（prompt 注入检测 + 草稿审核）
- **Phase 3**：MCP 服务器

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  mail-vue (Vue 3)                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ AI Sidebar   │  │ Email Views  │  │  AI Settings Page  │  │
│  │ (Chat Panel) │  │ (existing)   │  │  (sys-setting)     │  │
│  └──────┬───────┘  └──────────────┘  └───────────────────┘  │
│         │ SSE / fetch                                       │
├─────────┼───────────────────────────────────────────────────┤
│  mail-worker (Hono on CF Workers)                           │
│  ┌──────┴───────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ ai-api.js    │  │ ai-service.js│  │ ai-tool-service.js │  │
│  │ /api/ai/*    │  │ (LLM 编排)   │  │ (13+ 工具)        │  │
│  └──────────────┘  └──────┬───────┘  └───────────────────┘  │
│                           │                                 │
│  ┌────────────────────────┴──────────────────────────────┐  │
│  │ ai-provider.js  (OpenAI-compatible HTTP client)       │  │
│  │ - POST /v1/chat/completions (stream + non-stream)     │  │
│  │ - tool calling (function calling protocol)            │  │
│  │ - configurable: base_url / api_key / model            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ mcp-server  │  │ auto-draft   │  │ ai-security.js     │  │
│  │ (Phase 3)   │  │ (Phase 2)    │  │ (injection detect) │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 文件结构（mail-worker 新增）

```
mail-worker/src/
  service/
    ai-provider.js        — OpenAI 兼容 HTTP 调用封装
    ai-service.js         — AI 业务编排（对话、摘要、翻译等）
    ai-tool-service.js    — 工具注册中心 + 执行逻辑
    ai-security.js        — prompt 注入检测 + 草稿审核
  api/
    ai-api.js             — AI 相关 API 路由
```

### 文件结构（mail-vue 新增）

```
mail-vue/src/
  components/
    ai-sidebar/
      AiSidebar.vue           — 容器（Tab 切换：AI 助手 / MCP）
      AiChatPanel.vue         — 聊天主面板
      AiMessageBubble.vue     — 消息气泡（Markdown + 工具状态）
      AiToolCallBadge.vue     — 工具调用进度指示器
      AiInputBar.vue          — 输入框 + 发送/停止按钮
      AiSuggestedPrompts.vue  — 空状态建议提示词
      AiQuickActions.vue      — 邮件上下文快捷操作
  views/
    setting/
      AiSettings.vue          — AI 配置页面（或集成到现有 sys-setting）
  store/
    ai-store.js               — AI 相关状态管理
```

---

## 2. 后端模块设计

### 2.1 AI Provider (`ai-provider.js`)

最底层 LLM 调用封装。所有 AI 功能都通过此模块与外部 API 通信。

#### 配置项

| Key | 类型 | 说明 | 示例 |
|-----|------|------|------|
| `ai_enabled` | integer | 全局开关 | `1` |
| `ai_base_url` | string | API 端点 | `https://api.openai.com/v1` |
| `ai_api_key` | string | API 密钥（加密存储） | `sk-...` |
| `ai_model` | string | 默认模型 | `gpt-4o-mini` |
| `ai_system_prompt` | text | 自定义系统提示词（可选） | 自定义文本 |

#### 核心函数

**`chatCompletion(messages, options)`**
- 调用 `POST {base_url}/chat/completions`
- 参数：`{ model, messages, temperature?, max_tokens?, tools? }`
- 返回：完整的 ChatCompletion 响应对象
- 用于：摘要、翻译、情感分析等一次性任务

**`chatCompletionStream(messages, options)`**
- 调用 `POST {base_url}/chat/completions` 且 `stream: true`
- 返回：`ReadableStream`，直接 pipe 给前端
- Worker 不缓冲完整响应，逐 chunk 转发
- 用于：对话聊天的实时流式输出

**`callWithTools(messages, tools, options)`**
- 带 tool calling 的多轮对话循环
- 流程：发送请求 → 若响应含 `tool_calls` → 执行工具 → 将结果作为 `tool` role message 追加 → 继续请求 → 直到模型不再调用工具
- `stopAfterSteps` 参数限制最大工具调用轮数（默认 5，对标 agentic-inbox 的 `stepCountIs(5)`）
- 用于：AI 助手对话中的自动工具调用

**`testConnection()`**
- 发送一个简单的 completion 请求验证 API 可用性
- 用于：设置页面的"测试连接"按钮

#### 错误处理

- API key 无效 → 返回 `{ error: "AI_AUTH_FAILED" }`
- 请求超时（30s） → 返回 `{ error: "AI_TIMEOUT" }`
- 速率限制 → 返回 `{ error: "AI_RATE_LIMITED" }` + `retry_after`
- 模型不存在 → 返回 `{ error: "AI_MODEL_NOT_FOUND" }`
- AI 未配置/已禁用 → 返回 `{ error: "AI_NOT_CONFIGURED" }`

### 2.2 AI Service (`ai-service.js`)

业务编排层。管理对话上下文、工具调度。

#### 核心方法

**`chat(accountId, userMessage, conversationId?)`**
- 加载/创建对话历史
- 组装：system prompt + 对话历史 + 当前消息 + 工具定义
- 调用 `ai-provider.callWithTools()` 或 `chatCompletionStream()`
- 持久化新消息到 `ai_conversations` 表
- 返回流式响应（SSE）

**`summarizeEmail(emailId, accountId)`**
- 通过 `email-service` 获取邮件内容
- 调用 `chatCompletion()` 生成摘要
- 返回 `{ summary: "..." }`

**`translateEmail(emailId, targetLang, accountId)`**
- 获取邮件内容
- 调用 `chatCompletion()` 翻译为目标语言
- 返回 `{ translation: "...", sourceLang: "en", targetLang: "zh" }`

**`extractCalendarEvents(emailId, accountId)` (Phase 2)**
- 从邮件中识别日期、时间、会议信息
- 返回 `{ events: [{ title, date, time, location }] }`

**`analyzeSentiment(emailId, accountId)` (Phase 2)**
- 分析邮件情感倾向
- 返回 `{ sentiment: "positive" | "negative" | "neutral", confidence: 0.85 }`

**`autoDraftReply(emailId, accountId)` (Phase 2)**
- 移植自 agentic-inbox 的 `handleNewEmail()`
- 读取邮件和线程上下文
- 调用 `isPromptInjection()` 安全检查
- 生成回复草稿并保存
- 调用 `verifyDraft()` 审核内容

#### System Prompt

默认系统提示词移植并翻译自 agentic-inbox：

```
你是一个邮件助手，帮助管理这个收件箱。你可以阅读邮件、起草回复、搜索和整理会话。

## 写作风格
像真人一样写作。简短、直接、流畅。不使用 HTML 标签。

## 行为规则
- 草稿只保存不发送，用户审核后从 UI 发送
- 草稿正文只包含邮件文本，不包含元信息
- 回复前仔细阅读完整线程历史
- 不重复线程中已有的信息

## 草稿管理
使用 draft_reply 起草回复，使用 draft_email 起草新邮件。
使用 discard_draft 删除不需要的草稿。
```

### 2.3 AI Tool Service (`ai-tool-service.js`)

工具注册中心。定义所有 AI 可调用的工具。

#### 工具定义格式

```js
const tool = {
  name: "list_emails",
  description: "列出指定文件夹中的邮件...",
  parameters: {
    type: "object",
    properties: {
      folder: { type: "string", description: "文件夹名称", default: "inbox" },
      limit: { type: "number", description: "返回数量", default: 20 },
      page: { type: "number", description: "页码", default: 1 }
    }
  },
  execute: async (params, context) => {
    // 调用 email-service 现有方法
  }
};
```

#### 完整工具清单

**Phase 1 工具（8 个）：**

| 工具名 | 描述 | 对应现有 service |
|--------|------|-----------------|
| `list_emails` | 列出文件夹中的邮件列表 | `email-service.getList()` |
| `get_email` | 获取单封邮件完整内容 | `email-service.getById()` |
| `get_thread` | 获取邮件线程所有消息 | `email-service.getThread()` |
| `search_emails` | 搜索邮件（主题+正文） | `email-service.search()` |
| `draft_reply` | 起草回复并保存到草稿箱 | `email-service.saveDraft()` |
| `draft_email` | 起草新邮件保存到草稿箱 | `email-service.saveDraft()` |
| `mark_email_read` | 标记邮件已读/未读 | `email-service.markRead()` |
| `summarize_email` | **新增** - 生成邮件摘要 | 调用 `ai-service.summarizeEmail()` |

**Phase 2 工具（5 个）：**

| 工具名 | 描述 | 对应现有 service |
|--------|------|-----------------|
| `move_email` | 移动邮件到其他文件夹 | `email-service.moveEmail()` |
| `discard_draft` | 删除草稿 | `email-service.deleteDraft()` |
| `translate_email` | **新增** - 翻译邮件内容 | 调用 `ai-service.translateEmail()` |
| `extract_calendar` | **新增** - 提取日程事件 | 调用 `ai-service.extractCalendarEvents()` |
| `analyze_sentiment` | **新增** - 情感分析 | 调用 `ai-service.analyzeSentiment()` |

#### 工具执行上下文

每个工具执行时接收 `context` 对象：

```js
{
  accountId: "user@example.com",  // 当前用户的邮箱
  userId: 1,                       // 用户 ID
  env: { DB, KV, ... }            // Worker 环境绑定
}
```

### 2.4 AI Security (`ai-security.js`)

移植自 agentic-inbox 的 `workers/lib/ai.ts`。

#### Prompt 注入检测 (`isPromptInjection`)

```
输入: 邮件正文（HTML 或纯文本）
输出: boolean

流程:
1. 去除 HTML 标签，提取纯文本
2. 文本长度 < 10 字符 → 返回 false（太短不可能注入）
3. 调用 AI（轻量模型）判断是否为注入尝试
4. 使用严格的安全扫描 prompt（仅返回 YES/NO）
5. AI 调用失败 → 返回 true（fail-closed，宁可误报）
```

#### 草稿审核 (`verifyDraft`)

```
输入: 草稿 HTML 正文
输出: 清理后的正文（或空字符串表示审核失败）

流程:
1. 分离引用块（blockquote），只审核用户回复部分
2. 提取纯文本发给 AI 审核
3. 文本长度 < 20 字符 → 跳过审核
4. AI 检查是否含系统痕迹（"Draft saved."、tool 名称引用等）
5. 若 AI 删除了 >50% 内容 → 放弃清理，返回原文（保护阈值）
6. AI 失败 → 返回空字符串，调用方决定是否使用原文
```

### 2.5 API 路由 (`ai-api.js`)

| 方法 | 路径 | 说明 | 阶段 |
|------|------|------|------|
| POST | `/api/ai/chat` | 流式对话（SSE 响应） | P1 |
| POST | `/api/ai/summarize` | 邮件摘要 | P1 |
| POST | `/api/ai/translate` | 邮件翻译 | P1 |
| GET | `/api/ai/conversations` | 获取对话历史 | P1 |
| DELETE | `/api/ai/conversations` | 清除对话历史 | P1 |
| POST | `/api/ai/test-connection` | 测试 AI API 连接 | P1 |
| POST | `/api/ai/extract-calendar` | 日程提取 | P2 |
| POST | `/api/ai/sentiment` | 情感分析 | P2 |
| POST | `/api/ai/auto-draft` | 触发自动草稿 | P2 |

#### 流式对话协议 (`POST /api/ai/chat`)

请求：
```json
{
  "message": "帮我总结最近的未读邮件",
  "conversationId": "optional-uuid",
  "currentEmailId": "optional-email-id"
}
```

响应（SSE 格式）：
```
data: {"type": "text", "content": "正在"}
data: {"type": "text", "content": "查找"}
data: {"type": "tool_call", "name": "list_emails", "status": "running"}
data: {"type": "tool_call", "name": "list_emails", "status": "done", "result": {...}}
data: {"type": "text", "content": "你有 3 封未读邮件..."}
data: [DONE]
```

SSE 事件类型：
- `text` — AI 文本输出片段
- `tool_call` — 工具调用状态变化
- `error` — 错误信息
- `[DONE]` — 流结束标记

### 2.6 数据库变更

#### 新增 `ai_conversations` 表

```sql
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`messages` 字段 JSON 格式：
```json
[
  { "role": "user", "content": "帮我总结这封邮件", "timestamp": "..." },
  { "role": "assistant", "content": "这封邮件是...", "timestamp": "...",
    "tool_calls": [{ "name": "get_email", "result": "..." }] }
]
```

#### setting 表新增列

```sql
ALTER TABLE setting ADD COLUMN ai_enabled INTEGER DEFAULT 0;
ALTER TABLE setting ADD COLUMN ai_base_url TEXT DEFAULT '';
ALTER TABLE setting ADD COLUMN ai_api_key TEXT DEFAULT '';
ALTER TABLE setting ADD COLUMN ai_model TEXT DEFAULT 'gpt-4o-mini';
ALTER TABLE setting ADD COLUMN ai_system_prompt TEXT DEFAULT '';
ALTER TABLE setting ADD COLUMN ai_auto_draft INTEGER DEFAULT 0;
```

---

## 3. 前端 UI 设计

### 3.1 AI 侧边栏 (`AiSidebar.vue`)

#### 布局

邮件视图右侧，宽度 360px，可折叠。包含两个 Tab：
- **AI 助手** — 聊天对话面板
- **MCP** — MCP 服务器信息（Phase 3）

#### 入口

邮件视图头部工具栏新增 AI 图标按钮，点击展开/收起侧边栏。

### 3.2 聊天面板 (`AiChatPanel.vue`)

#### 空状态

显示：
- AI 机器人图标
- 简介文字："我是你的邮件助手，可以帮你阅读、搜索、起草和管理邮件。"
- 3 个建议提示词按钮：
  - "帮我查看最新的邮件"
  - "查找未读邮件"
  - "帮我起草一封邮件"

#### 消息列表

- 用户消息：右对齐，品牌色背景
- AI 消息：左对齐，浅色背景，支持 Markdown 渲染
- 工具调用：显示为 Badge（图标 + 名称 + 状态：运行中/完成）
- 草稿操作：AI 创建草稿后显示"编辑并发送"按钮

#### 输入区域

- 自动增高的 textarea（最小 1 行，最大 4 行）
- Enter 发送，Shift+Enter 换行
- 流式输出时显示"停止生成"按钮

### 3.3 工具调用可视化 (`AiToolCallBadge.vue`)

每个工具调用显示为紧凑的 Badge：

```
[📧 正在获取邮件列表...  ⏳]
[📧 获取邮件列表        ✅]
```

工具图标映射（对标 agentic-inbox 的 TOOL_ICONS）：
- `list_emails` → 📧 信封图标
- `get_email` → 👁 眼睛图标
- `get_thread` → 🔗 链接图标
- `search_emails` → 🔍 搜索图标
- `draft_reply` / `draft_email` → ✏️ 编辑图标
- `mark_email_read` → ✅ 勾选图标
- `move_email` → 📁 文件夹图标
- `summarize_email` → 📋 摘要图标
- `translate_email` → 🌐 翻译图标

### 3.4 邮件详情快捷操作 (`AiQuickActions.vue`)

在邮件详情视图工具栏添加 AI 快捷按钮：
- **摘要** — 调用 `/api/ai/summarize`，在弹窗中显示结果
- **翻译** — 调用 `/api/ai/translate`，在弹窗中显示结果
- **AI 回复** — 打开 AI 侧边栏，预填消息"帮我回复这封邮件"

### 3.5 AI 设置页面

在系统设置中新增 AI 配置区域：

- **启用开关** — 全局 AI 开关
- **API Base URL** — 输入框，placeholder: `https://api.openai.com/v1`
- **API Key** — 密码输入框，加密存储
- **模型名称** — 输入框，placeholder: `gpt-4o-mini`
- **系统提示词** — 多行文本框（可选）
- **自动草稿** — 开关（Phase 2）
- **测试连接** — 按钮，调用 `/api/ai/test-connection` 验证配置

### 3.6 状态管理 (`ai-store.js`)

```js
{
  sidebarOpen: false,        // 侧边栏是否展开
  messages: [],              // 当前对话消息列表
  conversationId: null,      // 当前对话 ID
  isStreaming: false,         // 是否正在流式接收
  currentEmailId: null,      // 上下文：当前查看的邮件 ID
  aiEnabled: false,          // AI 是否已配置且启用
  abortController: null      // 用于取消流式请求
}
```

### 3.7 响应式适配

- **桌面端**（>1024px）：邮件视图右侧 360px 侧边栏
- **平板端**（768-1024px）：覆盖式侧边栏（带遮罩）
- **移动端**（<768px）：底部全屏抽屉

---

## 4. Phase 2：自动草稿 + 安全层

### 4.1 自动草稿流程

移植自 agentic-inbox 的 `EmailAgent.handleNewEmail()`：

```
新邮件到达（已有的 email worker 触发）
  ↓
检查 ai_auto_draft 设置是否启用
  ↓
调用 isPromptInjection() 扫描邮件正文
  ├── 检测到注入 → 跳过自动草稿，记录日志
  └── 安全 → 继续
      ↓
加载邮件线程上下文
  ↓
调用 isPromptInjection() 扫描线程上下文
  ├── 检测到注入 → 跳过，记录日志
  └── 安全 → 继续
      ↓
组装 prompt（邮件内容 + 线程历史 + system prompt）
  ↓
调用 AI 生成回复草稿（非流式，带 tool calling）
  ↓
调用 verifyDraft() 审核草稿内容
  ↓
保存草稿到数据库
```

### 4.2 安全层集成点

- **自动草稿**：注入检测 + 草稿审核
- **AI 对话中的 draft_reply/draft_email**：草稿审核
- **MCP draft_reply/send_reply**：草稿审核（Phase 3）

---

## 5. Phase 3：MCP 服务器

### 5.1 概述

暴露标准 MCP (Model Context Protocol) 接口，供外部 AI 工具（Claude Desktop、Cursor 等）直接操作邮箱。

### 5.2 端点

`/mcp` — MCP 标准 JSON-RPC 端点

### 5.3 暴露的工具

复用 `ai-tool-service.js` 中的全部工具定义，封装为 MCP 格式。额外增加：
- `list_accounts` — 列出可用邮箱账户
- `send_reply` — 实际发送回复（MCP 允许，因为外部 AI 工具有自己的确认流程）
- `send_email` — 实际发送新邮件
- `update_draft` — 更新草稿内容
- `delete_email` — 删除邮件

### 5.4 认证

MCP 请求使用与现有 API 相同的认证机制（JWT token），确保只有授权用户可通过 MCP 操作邮箱。

---

## 6. 与现有代码的集成点

### mail-worker 集成

- `ai-provider.js` 通过 `setting-service.js` 读取 AI 配置
- `ai-tool-service.js` 中各工具调用 `email-service.js` 现有方法
- `ai-api.js` 注册到现有 Hono app（`src/index.js`）
- 数据库 migration 在 `init/` 目录中添加

### mail-vue 集成

- `AiSidebar.vue` 嵌入现有邮件视图布局
- `AiQuickActions.vue` 添加到邮件详情工具栏
- `AiSettings.vue` 添加到系统设置路由
- `ai-store.js` 使用现有状态管理模式

### 不修改的部分

- 现有邮件收发流程不变
- SMTP 服务不受影响
- 用户认证/权限体系不变
- AI 功能可通过全局开关完全禁用，不影响无 AI 场景
