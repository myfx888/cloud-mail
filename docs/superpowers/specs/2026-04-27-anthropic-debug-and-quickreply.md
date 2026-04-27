# Anthropic API 调试修复与一键 AI 回复 — 变更记录

**日期**：2026-04-27
**范围**：5 项修复 + 1 项新功能，解决 Anthropic API 无输出问题、AI 按钮不显示、草稿创建失败，并新增一键 AI 回复直接填充写信界面功能

---

## 1. Bug 修复：Anthropic API 无输出

### 问题描述
AI 设置使用 Anthropic 兼容 API 格式，保存和测试连接均成功，但实际使用模型时没有任何输出。

### 根因分析
经过系统性调试，在 `ai-api.js`、`ai-provider.js` 数据链路中发现 3 个互相叠加的 bug。

---

### 1.1 SSE 错误传播失败

**文件**：`mail-worker/src/api/ai-api.js` — `/ai/chat` 端点的 catch 块

**问题**：catch 块返回 `c.json(result.fail(...))` — HTTP 200 + JSON body。前端 `response.ok` 为 true，将 JSON body 当作 SSE 解析，收不到任何事件，导致静默无输出。

**修复**：将 catch 块改为返回 SSE 格式的 error + done 事件流，前端现有的 SSE error 处理逻辑可以正确显示错误信息。

```javascript
// 修复前
} catch (e) {
    return c.json(result.fail(e.message, 500));
}

// 修复后
} catch (e) {
    const encoder = new TextEncoder();
    const { readable: errReadable, writable: errWritable } = new TransformStream();
    const errWriter = errWritable.getWriter();
    (async () => {
        await errWriter.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`));
        await errWriter.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        await errWriter.close();
    })();
    return new Response(errReadable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
```

**影响**：所有 AI 提供商的错误现在都能在前端 AI 侧边栏正确显示。

---

### 1.2 Anthropic 角色交替违规（多工具调用场景）

**文件**：`mail-worker/src/service/ai-provider.js` — `_convertToAnthropicMessages` 方法

**问题**：每个 OpenAI 格式的 `tool` 消息被转换为独立的 Anthropic `user` 消息。当 AI 同时调用多个工具（如 `get_email` + `get_thread`）时，产生连续的 `user` 消息，违反 Anthropic 的角色交替要求（user/assistant 必须交替出现），导致 API 返回 400 错误。该错误被 Bug 1.1 静默吞掉。

**修复**：连续的 `tool_result` 消息合并到同一个 `user` 消息的 `content` 数组中。

```javascript
// 修复前
} else if (msg.role === 'tool') {
    converted.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }]
    });
}

// 修复后
} else if (msg.role === 'tool') {
    const toolResult = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content
    };
    const last = converted[converted.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)
        && last.content[0]?.type === 'tool_result') {
        last.content.push(toolResult);
    } else {
        converted.push({ role: 'user', content: [toolResult] });
    }
}
```

**影响**：修复多工具调用场景下 Anthropic API 的 400 错误。

---

### 1.3 流式响应格式兼容性

**文件**：`mail-worker/src/service/ai-provider.js` — `_convertAnthropicStreamToOpenAI` 方法

**问题**：某些 Anthropic 兼容代理（如 one-api、new-api 等中转服务）在流式模式下返回 OpenAI 格式的 SSE 事件（`choices[0].delta.content`），但转换器只识别 Anthropic 原生的 `content_block_delta` 事件，导致文本内容被静默丢弃。

**修复**：在流转换器中增加 OpenAI 格式事件的 fallback 处理。

```javascript
// 在 content_block_delta 处理之后添加
} else if (evt.choices?.[0]?.delta?.content) {
    // OpenAI-compatible format (some Anthropic proxies return this)
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
}
```

**影响**：兼容通过代理中转的 Anthropic API。

---

## 2. Bug 修复：AI 按钮不显示

**文件**：`mail-worker/src/service/setting-service.js` — `websiteConfig` 方法

**问题**：邮件详情工具栏的 AI 快捷按钮使用 `v-if="settingStore.settings.aiEnabled"` 控制显示。但 `websiteConfig` API 返回的字段白名单中没有 `aiEnabled`，前端始终拿到默认值 `0`，AI 按钮永远不显示。

**修复**：在 `websiteConfig` 返回对象中添加 `aiEnabled` 字段。

```javascript
// 在 websiteConfig 返回对象中添加
aiEnabled: settingRow.aiEnabled ?? 0
```

**影响**：后台开启 AI 功能后，邮件详情工具栏正确显示 AI 快捷按钮。

---

## 3. Bug 修复：draft_reply / draft_email 工具创建草稿失败

**文件**：`mail-worker/src/service/ai-tool-service.js` — `draft_reply` 和 `draft_email` 工具

### 问题描述
AI 聊天中调用 `draft_reply` 和 `draft_email` 工具时，草稿创建失败。AI 模型回退为纯文字回复，提示"系统在创建草稿时遇到了技术问题"。

### 修复内容

#### 3.1 draft_reply — sendEmail 字段错误
**问题**：`sendEmail` 使用了原始邮件的发件人地址（外部地址），应该使用收信账户的邮箱地址。
**修复**：查询 `account` 表获取用户自己的邮箱地址作为草稿发件人。

#### 3.2 缺少 recipient 字段
**问题**：`recipient` 字段未设置，数据库约束可能导致插入失败。
**修复**：两个工具都补充了 `recipient` 字段（JSON 格式的收件人数组）。

#### 3.3 缺少类型强转
**问题**：AI 模型可能传递字符串类型的 `emailId`，导致查询失败。
**修复**：添加 `Number()` 强转和有效性校验。

#### 3.4 缺少错误处理
**问题**：数据库插入操作没有 try/catch，异常直接抛出导致工具调用链路中断。
**修复**：整个 execute 函数体包裹在 try/catch 中，错误以 `{ error: "..." }` 格式返回给 AI 模型，同时打印 `console.error` 日志便于排查。

#### 3.5 draft_email — sendEmail/name 为空
**问题**：`sendEmail` 和 `name` 设为空字符串，草稿没有发件人信息。
**修复**：从 account 表查询发件人邮箱和名称。

---

## 4. 新功能：一键 AI 回复（直接填充写邮件界面）

### 需求背景
原有 AI 回复流程：点击 AI 回复按钮 → 打开 AI 侧边栏 → 聊天模式 → 调用 get_email → get_thread → draft_reply（经常失败）→ 用户只能看到文字建议，无法直接发送。用户希望一键操作即可将 AI 生成的回复填充到写邮件界面，直接编辑发送。

### 实现方案

#### 4.1 后端 — 新增 quickReply 服务方法

**文件**：`mail-worker/src/service/ai-service.js`

新增 `quickReply(c, userId, emailId)` 方法：
- 读取原始邮件内容
- 使用专用 prompt 直接生成简洁、专业的回复文本
- 回复语言与原邮件一致
- 不走工具调用链路，一次 AI 请求即返回结果

```javascript
async quickReply(c, userId, emailId) {
    const result = await aiToolService.executeTool('get_email', { emailId }, { c, userId });
    if (result.error) throw new Error(result.error);

    const prompt = `You are a professional email assistant. Draft a concise, polite reply...`;

    const aiResult = await aiProvider.chatCompletion(c, [
        { role: 'system', content: prompt },
        { role: 'user', content: `From: ${result.from}...\n\n${result.body}` }
    ], { max_tokens: 1000, temperature: 0.7 });

    const replyBody = aiResult.choices?.[0]?.message?.content || '';
    if (!replyBody) throw new Error('AI did not generate a reply');
    return { replyBody };
}
```

#### 4.2 后端 — 新增 API 端点

**文件**：`mail-worker/src/api/ai-api.js`

新增 `POST /ai/quick-reply` 端点，接收 `{ emailId }` 参数，返回 `{ replyBody }` 文本。

#### 4.3 前端 — API 函数

**文件**：`mail-vue/src/request/ai.js`

新增 `aiQuickReply(emailId)` 函数调用后端接口。

#### 4.4 前端 — 写邮件组件支持预填充内容

**文件**：`mail-vue/src/layout/write/index.vue`

- `openReply(email, preContent)` 方法增加可选参数 `preContent`
- 当 `preContent` 存在时，将 AI 生成的回复文本转为 HTML 并放在引用块之前
- 新增 `openReplyWithContent(email, content)` 快捷方法，通过 `defineExpose` 暴露

#### 4.5 前端 — 邮件详情 AI 回复按钮改造

**文件**：`mail-vue/src/views/content/index.vue`

- `quickAiReply()` 函数从原来的 `sendQuickAction(打开 AI 侧边栏聊天)` 改为直接调用 `/ai/quick-reply` API
- 成功后调用 `uiStore.writerRef.openReplyWithContent(email, replyBody)` 直接打开写邮件界面
- 添加 `aiReplyLoading` 状态控制按钮加载动画（转圈图标 + 禁止点击）
- 失败时通过 `ElMessage.error` 显示错误提示

### 新流程
1. 用户在邮件详情点击 🤖 AI 回复按钮
2. 按钮变为转圈 loading 状态
3. 后端直接调用 AI 生成回复文本（不走聊天/工具链路）
4. AI 回复自动填充到写邮件界面，原邮件以引用格式附在下方
5. 用户检查/修改后直接发送

---

## 修改文件清单

| 文件 | 类型 | 改动说明 |
|------|------|----------|
| `mail-worker/src/api/ai-api.js` | 修改 | Bug 1.1：SSE 错误传播；新增 `/ai/quick-reply` 端点 |
| `mail-worker/src/service/ai-provider.js` | 修改 | Bug 1.2：工具结果消息合并；Bug 1.3：流格式兼容 |
| `mail-worker/src/service/setting-service.js` | 修改 | Bug 2：websiteConfig 返回 aiEnabled |
| `mail-worker/src/service/ai-tool-service.js` | 修改 | Bug 3：draft 工具完整修复 |
| `mail-worker/src/service/ai-service.js` | 修改 | 新增 quickReply 方法 |
| `mail-vue/src/request/ai.js` | 修改 | 新增 aiQuickReply API 函数 |
| `mail-vue/src/layout/write/index.vue` | 修改 | 新增 openReplyWithContent 方法 |
| `mail-vue/src/views/content/index.vue` | 修改 | AI 回复按钮改为一键填充模式 |

---

## Git 提交记录

```
fix: return AI chat errors as SSE stream instead of JSON for proper frontend display
fix: merge consecutive Anthropic tool results into single user message for role alternation
fix: handle OpenAI-format SSE events in Anthropic stream converter for proxy compatibility
fix: add aiEnabled to websiteConfig response for frontend AI button visibility
fix: draft_reply/draft_email - use account email as sender, add try/catch, type coercion, recipient field
feat: one-click AI reply — direct compose fill via /ai/quick-reply endpoint
```
