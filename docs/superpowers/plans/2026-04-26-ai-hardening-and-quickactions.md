# AI 安全加固、快捷操作与 MCP 增强 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 7 项改进：安全加固（3）、对话历史（1）、AI 快捷按钮（1）、MCP 增强（2）

**Architecture:** 后端改动集中在 `ai-provider.js`（安全）、`ai-service.js`（对话历史）、`mcp-api.js`+`mcp-service.js`（MCP）。前端改动在 `content/index.vue`（快捷按钮）、`ai.js` store（新 action）、i18n（新 key）。

**Tech Stack:** Hono (Cloudflare Workers), Drizzle ORM, Vue 3 + Pinia, Element Plus, SSE

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `mail-worker/src/service/ai-provider.js` | AI 安全层 | 修改 |
| `mail-worker/src/service/ai-service.js` | 自动草稿对话历史 | 修改 |
| `mail-worker/src/api/mcp-api.js` | MCP SSE 双向传输 | 修改 |
| `mail-worker/src/service/mcp-service.js` | MCP create_draft 工具 | 修改 |
| `mail-vue/src/views/content/index.vue` | 邮件详情 AI 快捷按钮 | 修改 |
| `mail-vue/src/store/ai.js` | sendQuickAction action | 修改 |
| `mail-vue/src/i18n/zh.js` | 中文 i18n | 修改 |
| `mail-vue/src/i18n/en.js` | 英文 i18n | 修改 |

---

### Task 1: isPromptInjection 改为 fail-closed

**Files:**
- Modify: `mail-worker/src/service/ai-provider.js:300-319`

- [ ] **Step 1: 修改 catch 块返回值**

在 `ai-provider.js` 的 `isPromptInjection` 方法中，将 catch 块从 fail-open 改为 fail-closed：

```javascript
	} catch (e) {
		console.warn('Prompt injection check failed, blocking by default:', e.message);
		return true;
	}
```

将原来的：
```javascript
	} catch (e) {
		console.warn('Prompt injection check failed, allowing by default:', e.message);
		return false;
	}
```

替换为上面的代码。

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/service/ai-provider.js
git commit -m "fix(security): isPromptInjection fail-closed on scanner error"
```

---

### Task 2: verifyDraft 增加 blockquote 分离 + 50% 安全检查

**Files:**
- Modify: `mail-worker/src/service/ai-provider.js:322-356`

- [ ] **Step 1: 添加 _splitQuotedBlock 和 _stripHtmlToText 辅助方法**

在 `ai-provider.js` 的 `verifyDraft` 方法前面（`isPromptInjection` 方法之后），添加两个辅助方法：

```javascript
	_splitQuotedBlock(html) {
		const match = html.match(
			/(\s*(?:<br\s*\/?>)\s*)?(<blockquote[\s\S]*<\/blockquote>)\s*$/i
		);
		if (match) {
			const quoted = match[0];
			const reply = html.slice(0, html.length - quoted.length);
			return { reply, quoted };
		}
		return { reply: html, quoted: '' };
	},

	_stripHtmlToText(html) {
		return html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	},
```

- [ ] **Step 2: 重写 verifyDraft 方法**

将整个 `verifyDraft` 方法替换为包含 blockquote 分离和 50% 安全检查的新版本：

```javascript
	async verifyDraft(c, draftBody) {
		if (!draftBody || draftBody.trim().length === 0) return draftBody;

		const VERIFIER_PROMPT = `You are a proofreader for outgoing business emails. You will receive the text of an email draft that was composed by an AI assistant on behalf of a human.

Your job: check if the AI assistant accidentally included any of its own internal commentary or system artifacts in the email text.

Examples of system artifacts to REMOVE (if present):
- "Drafted via draft_reply to email ..."
- "Draft saved." / "Draft created."
- "The operator can review and send from the UI."
- "I've drafted a reply for you to review."
- Lines containing tool function names like "draft_reply", "get_email" used as references to actions taken

Examples of legitimate email content to KEEP (never remove these):
- URLs and links
- Questions about the recipient's use case
- Pricing information, technical details
- Sign-off lines (the sender's name)
- Everything that reads like a person talking to another person

RULES:
1. If the email has NO system artifacts, return it EXACTLY as-is, character for character.
2. If you find artifacts, remove ONLY those specific lines. Keep everything else identical.
3. When in doubt, KEEP the content.
4. Return ONLY the email text. No explanations, no wrapper text.`;

		// Separate quoted block so AI only reviews user's reply text
		const isHtml = /<[a-z][\s\S]*>/i.test(draftBody);
		const { reply: replyPart, quoted: quotedBlock } = isHtml
			? this._splitQuotedBlock(draftBody)
			: { reply: draftBody, quoted: '' };

		// Extract plain text of just the reply portion
		const replyText = isHtml ? this._stripHtmlToText(replyPart) : replyPart;

		// Skip very short replies
		if (replyText.trim().length < 20) return draftBody;

		try {
			const result = await this.chatCompletion(c, [
				{ role: 'system', content: VERIFIER_PROMPT },
				{ role: 'user', content: replyText }
			], { max_tokens: 4096, temperature: 0 });

			const cleaned = (result.choices?.[0]?.message?.content || '').trim();
			if (!cleaned) return draftBody;

			// If substantially similar, keep original formatting
			const normalize = s => s.replace(/\s+/g, ' ').trim();
			if (normalize(cleaned) === normalize(replyText)) return draftBody;

			// 50% safety check: if AI removed too much, fall back to original
			if (cleaned.length < replyText.trim().length * 0.5) {
				console.warn(
					'Draft verifier removed >50% of content, falling back to original.',
					`Original: ${replyText.trim().length} chars, Cleaned: ${cleaned.length} chars`
				);
				return draftBody;
			}

			// Rebuild in original format
			if (isHtml) {
				const cleanedHtml = `<div style="white-space:pre-wrap">${cleaned.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
				return quotedBlock ? `${cleanedHtml}${quotedBlock}` : cleanedHtml;
			}
			return quotedBlock ? `${cleaned}\n\n${quotedBlock}` : cleaned;
		} catch (e) {
			console.warn('Draft verification failed, using original:', e.message);
			return draftBody;
		}
	},
```

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/ai-provider.js
git commit -m "feat(security): verifyDraft blockquote separation + 50% safety check"
```

---

### Task 3: handleNewEmail 写入 ai_conversations

**Files:**
- Modify: `mail-worker/src/service/ai-service.js:231-304`

- [ ] **Step 1: 添加 _logAutoDraft 辅助方法**

在 `ai-service.js` 的 `handleNewEmail` 方法之前，添加一个辅助方法：

```javascript
	async _logAutoDraft(c, userId, sender, subject, assistantText) {
		const conversationId = `auto-draft-${userId}`;
		const now = new Date().toISOString();
		const userMsg = {
			role: 'user',
			content: `[Auto] 收到 ${sender} 的邮件 "${subject}"`,
			timestamp: now
		};
		const assistantMsg = {
			role: 'assistant',
			content: assistantText,
			timestamp: now
		};

		try {
			const existing = await this.getConversation(c, userId, conversationId);
			let messages = existing?.messages || [];
			messages.push(userMsg, assistantMsg);
			// 保持最多 100 条消息
			if (messages.length > 100) {
				messages = messages.slice(messages.length - 100);
			}
			await this.saveConversation(c, userId, conversationId, messages);
		} catch (e) {
			console.warn('Failed to log auto-draft:', e.message);
		}
	},
```

- [ ] **Step 2: 在 handleNewEmail 的三个分支中添加日志调用**

在 `handleNewEmail` 方法中的以下位置添加 `_logAutoDraft` 调用：

**a) prompt injection 拦截后** — 在 `return { skipped: true, reason: 'prompt_injection_detected' };` 之前：

```javascript
			await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
				'⚠️ 检测到可疑内容，已跳过自动草稿');
```

**b) thread injection 拦截后** — 在 `return { skipped: true, reason: 'thread_injection_detected' };` 之前：

```javascript
			await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
				'⚠️ 会话历史中检测到可疑内容，已跳过自动草稿');
```

**c) 成功生成草稿后** — 在 `return { skipped: false, draftId: ... }` 之前：

```javascript
			const draftCall = result.toolCalls.find(tc => tc.name === 'draft_reply' && tc.status === 'done');
			await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
				draftCall ? '已为该邮件创建回复草稿' : (result.content || '自动草稿生成完成'));
```

**d) catch 块中** — 在 `return { skipped: true, reason: e.message };` 之前：

```javascript
			await this._logAutoDraft(c, userId, 'unknown', '',
				`自动草稿生成失败: ${e.message}`).catch(() => {});
```

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/ai-service.js
git commit -m "feat: log auto-draft results to ai_conversations"
```

---

### Task 4: MCP create_draft 工具

**Files:**
- Modify: `mail-worker/src/service/mcp-service.js:151-172`

- [ ] **Step 1: 在 mcpExtraTools 的 delete_email 之后添加 create_draft**

在 `mcp-service.js` 的 `mcpExtraTools` 数组中 `delete_email` 工具之后（闭合 `}` 之后），添加新工具：

```javascript
	{
		name: 'create_draft',
		description: 'Create a new draft email and save it to Drafts. Does not send. Fields to and subject are optional - user can fill them in the UI later.',
		inputSchema: {
			type: 'object',
			properties: {
				body: { type: 'string', description: 'Draft body text' },
				to: { type: 'string', description: 'Recipient email address (optional)' },
				subject: { type: 'string', description: 'Email subject (optional)' },
				accountId: { type: 'number', description: 'Sender account ID (optional, defaults to first account)' }
			},
			required: ['body']
		},
		execute: async (params, ctx) => {
			let accountId = params.accountId;
			if (!accountId) {
				const acc = await orm(ctx.c).select().from(account)
					.where(and(eq(account.userId, ctx.userId), eq(account.isDel, isDel.NORMAL)))
					.limit(1).get();
				if (!acc) return { error: 'No email account found' };
				accountId = acc.accountId;
			}

			let body = params.body;
			try { body = await aiProvider.verifyDraft(ctx.c, body); } catch (e) { /* skip */ }

			const draftData = {
				sendEmail: '',
				name: '',
				accountId: accountId,
				userId: ctx.userId,
				subject: params.subject || '',
				text: body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(body)}</div>`,
				toEmail: params.to || '',
				type: emailConst.type.SEND,
				status: emailConst.status.SAVING,
				isDel: isDel.NORMAL,
				unread: emailConst.unread.READ
			};

			const result = await orm(ctx.c).insert(email).values(draftData).returning().get();
			return { created: true, emailId: result.emailId };
		}
	}
```

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/service/mcp-service.js
git commit -m "feat(mcp): add create_draft tool"
```

---

### Task 5: MCP SSE 完整双向传输

**Files:**
- Modify: `mail-worker/src/api/mcp-api.js:1-68`

- [ ] **Step 1: 重写 mcp-api.js**

将整个 `mcp-api.js` 替换为支持双向 SSE 的新版本：

```javascript
import app from '../hono/hono';
import result from '../model/result';
import mcpService from '../service/mcp-service';
import userContext from '../security/user-context';

// Session store: sessionId -> { writer, userId, createdAt }
const sessions = new Map();

// Cleanup stale sessions (older than 6 minutes)
function cleanupSessions() {
	const now = Date.now();
	for (const [id, session] of sessions) {
		if (now - session.createdAt > 360000) {
			try { session.writer.close(); } catch {}
			sessions.delete(id);
		}
	}
}

// MCP SSE transport: client establishes SSE connection
app.get('/mcp/sse', async (c) => {
	const userId = userContext.getUserId(c);
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	const sessionId = crypto.randomUUID();

	// Register session
	cleanupSessions();
	sessions.set(sessionId, { writer, userId, createdAt: Date.now() });

	// Send endpoint event
	const endpointUrl = new URL(c.req.url);
	endpointUrl.pathname = '/mcp';
	endpointUrl.search = `?sessionId=${sessionId}`;
	await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl.toString()}\n\n`));

	// Keep-alive ping every 30s
	const keepAlive = setInterval(async () => {
		try {
			await writer.write(encoder.encode(`: ping\n\n`));
		} catch {
			clearInterval(keepAlive);
			sessions.delete(sessionId);
		}
	}, 30000);

	// Close after 5 minutes
	setTimeout(async () => {
		clearInterval(keepAlive);
		sessions.delete(sessionId);
		try { await writer.close(); } catch {}
	}, 300000);

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
});

// MCP JSON-RPC endpoint (supports both SSE-linked and direct modes)
app.post('/mcp', async (c) => {
	const sessionId = c.req.query('sessionId');
	const userId = userContext.getUserId(c);

	try {
		const body = await c.req.json();

		// Handle batch requests
		const requests = Array.isArray(body) ? body : [body];
		const responses = [];
		for (const req of requests) {
			const resp = await mcpService.handleRequest(c, userId, req);
			if (resp) responses.push(resp);
		}

		const responseData = Array.isArray(body) ? responses : responses[0];

		// Try to push via SSE if session exists
		if (sessionId) {
			const session = sessions.get(sessionId);
			if (session && session.userId === userId) {
				try {
					const encoder = new TextEncoder();
					const payload = JSON.stringify(responseData);
					await session.writer.write(
						encoder.encode(`event: message\ndata: ${payload}\n\n`)
					);
					// SSE push succeeded — return 202 Accepted
					return new Response(null, { status: 202 });
				} catch {
					// SSE write failed, fall through to direct response
					sessions.delete(sessionId);
				}
			}
		}

		// Fallback: return response directly in HTTP body
		return c.json(responseData);
	} catch (e) {
		const errorResp = {
			jsonrpc: '2.0',
			id: null,
			error: { code: -32700, message: `Parse error: ${e.message}` }
		};

		// Try SSE push for errors too
		if (sessionId) {
			const session = sessions.get(sessionId);
			if (session) {
				try {
					const encoder = new TextEncoder();
					await session.writer.write(
						encoder.encode(`event: message\ndata: ${JSON.stringify(errorResp)}\n\n`)
					);
					return new Response(null, { status: 202 });
				} catch {
					sessions.delete(sessionId);
				}
			}
		}

		return c.json(errorResp);
	}
});
```

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/api/mcp-api.js
git commit -m "feat(mcp): full bidirectional SSE transport with fallback"
```

---

### Task 6: AI 快捷按钮 — aiStore 新 action + i18n

**Files:**
- Modify: `mail-vue/src/store/ai.js:113-118`
- Modify: `mail-vue/src/i18n/zh.js`
- Modify: `mail-vue/src/i18n/en.js`

- [ ] **Step 1: 在 aiStore 的 clearMessages action 之前添加 sendQuickAction**

在 `ai.js` 的 `clearMessages()` 方法之前添加：

```javascript
        async sendQuickAction(text, emailId) {
            const { useUiStore } = await import('@/store/ui.js');
            const uiStore = useUiStore();
            this.currentEmailId = emailId;
            uiStore.aiSidebarOpen = true;
            // 等待侧边栏渲染
            await new Promise(r => setTimeout(r, 100));
            await this.sendMessage(text);
        },
```

- [ ] **Step 2: 在 zh.js 添加 i18n key**

在 `mcpEndpoint: 'MCP 端点'` 之前添加：

```javascript
    aiQuickSummary: '摘要',
    aiQuickTranslate: '翻译',
    aiQuickReply: 'AI 回复',
    aiQuickTranslateTo: '翻译为{lang}',
    aiLangZh: '中文',
    aiLangEn: '英文',
    aiLangJa: '日文',
    aiLangKo: '韩文',
    aiLangFr: '法文',
```

- [ ] **Step 3: 在 en.js 添加 i18n key**

在 `mcpEndpoint: 'MCP Endpoint'` 之前添加：

```javascript
    aiQuickSummary: 'Summary',
    aiQuickTranslate: 'Translate',
    aiQuickReply: 'AI Reply',
    aiQuickTranslateTo: 'Translate to {lang}',
    aiLangZh: 'Chinese',
    aiLangEn: 'English',
    aiLangJa: 'Japanese',
    aiLangKo: 'Korean',
    aiLangFr: 'French',
```

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/store/ai.js mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat: aiStore sendQuickAction + i18n keys for quick actions"
```

---

### Task 7: 邮件详情 AI 快捷按钮 UI

**Files:**
- Modify: `mail-vue/src/views/content/index.vue:1-16` (template)
- Modify: `mail-vue/src/views/content/index.vue:77-95` (script imports)

- [ ] **Step 1: 在 template 的 header-actions 中添加 AI 按钮**

在 `content/index.vue` 的 template 中，在导出按钮（`exportEmail` 的 Icon）之后、`</div>` 闭合标签之前，添加：

```html
      <template v-if="settingStore.settings.aiEnabled">
        <span class="ai-divider"></span>
        <Icon class="icon ai-icon" icon="mdi:text-box-search-outline" width="18" height="18" @click="quickSummary" :title="$t('aiQuickSummary')" />
        <el-dropdown trigger="click" @command="quickTranslate">
          <Icon class="icon ai-icon" icon="mdi:translate" width="18" height="18" :title="$t('aiQuickTranslate')" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="中文">{{ $t('aiLangZh') }}</el-dropdown-item>
              <el-dropdown-item command="English">{{ $t('aiLangEn') }}</el-dropdown-item>
              <el-dropdown-item command="日本語">{{ $t('aiLangJa') }}</el-dropdown-item>
              <el-dropdown-item command="한국어">{{ $t('aiLangKo') }}</el-dropdown-item>
              <el-dropdown-item command="Français">{{ $t('aiLangFr') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <Icon class="icon ai-icon" icon="mdi:robot-outline" width="18" height="18" @click="quickAiReply" :title="$t('aiQuickReply')" />
      </template>
```

- [ ] **Step 2: 在 script 中导入 aiStore 并添加快捷方法**

在 `content/index.vue` 的 script setup 中：

a) 在 imports 区域添加：
```javascript
import {useAiStore} from "@/store/ai.js";
```

b) 在 `const email = emailStore.contentData.email` 之后添加：
```javascript
const aiStore = useAiStore()
```

c) 在 `openForward` 函数之后添加三个快捷方法：
```javascript
function quickSummary() {
  aiStore.sendQuickAction('请帮我总结这封邮件的要点', email.emailId)
}

function quickTranslate(lang) {
  aiStore.sendQuickAction(`请将这封邮件翻译成${lang}`, email.emailId)
}

function quickAiReply() {
  aiStore.sendQuickAction('请帮我起草一封回复', email.emailId)
}
```

- [ ] **Step 3: 添加分隔线样式**

在 `content/index.vue` 的 `<style>` 块中添加：

```css
.ai-divider {
  display: inline-block;
  width: 1px;
  height: 16px;
  background: var(--el-border-color);
  margin: 0 6px;
  vertical-align: middle;
}

.ai-icon {
  color: var(--el-color-primary);
  opacity: 0.7;
}

.ai-icon:hover {
  opacity: 1;
}
```

- [ ] **Step 4: 提交**

```bash
git add mail-vue/src/views/content/index.vue
git commit -m "feat: AI quick action buttons in email detail toolbar"
```

---

### Task 8: 前端构建验证 + 最终提交

- [ ] **Step 1: 前端构建验证**

```bash
cd mail-vue && npx vite build
```

预期：构建成功，无错误。

- [ ] **Step 2: 推送到 GitHub**

```bash
git push
```
