# AI Email Assistant — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI email assistant infrastructure to cloud-mail — OpenAI-compatible API client, 8 email tools, streaming chat API, and Vue 3 sidebar UI.

**Architecture:** Backend adds 4 service files + 1 API route file to mail-worker (Hono on CF Workers). Frontend adds Pinia store, axios request module, and 7 Vue components forming a chat sidebar. AI config stored in existing `setting` table; conversations in a new `ai_conversations` table.

**Tech Stack:** Hono (existing), Drizzle ORM (existing), Vue 3 + Element Plus + Pinia (existing), OpenAI Chat Completions API (HTTP fetch), SSE streaming.

---

## File Structure

### mail-worker (backend, new files)

| File | Responsibility |
|------|---------------|
| `src/service/ai-provider.js` | OpenAI-compatible HTTP client (chat completions, streaming, tool calling loop) |
| `src/service/ai-service.js` | Business orchestration (chat, summarize, translate) |
| `src/service/ai-tool-service.js` | Tool registry — 8 tools with JSON Schema definitions + execute functions |
| `src/api/ai-api.js` | Hono routes: `/ai/chat`, `/ai/summarize`, `/ai/translate`, `/ai/conversations`, `/ai/test-connection` |

### mail-worker (backend, modified files)

| File | Change |
|------|--------|
| `src/entity/setting.js` | Add 6 AI columns to Drizzle schema |
| `src/init/init.js` | Add `v4_2DB` migration for AI columns + `ai_conversations` table |
| `src/hono/webs.js` | Import `ai-api.js` |
| `src/security/security.js` | Add AI routes to `exclude` / `requirePerms` as needed |
| `src/service/setting-service.js` | Parse AI settings in `_parseSettingRow`, mask `aiApiKey` in `get` |

### mail-vue (frontend, new files)

| File | Responsibility |
|------|---------------|
| `src/store/ai.js` | Pinia store — sidebar state, messages, streaming control |
| `src/request/ai.js` | Axios + native fetch wrappers for AI API |
| `src/components/ai-sidebar/AiSidebar.vue` | Container with tab bar (AI / MCP) |
| `src/components/ai-sidebar/AiChatPanel.vue` | Chat panel — messages list + input + SSE streaming |
| `src/components/ai-sidebar/AiMessageBubble.vue` | Single message bubble (Markdown rendering, tool badges) |
| `src/components/ai-sidebar/AiToolCallBadge.vue` | Compact badge showing tool name + status |
| `src/components/ai-sidebar/AiInputBar.vue` | Auto-growing textarea + send/stop buttons |

### mail-vue (frontend, modified files)

| File | Change |
|------|--------|
| `src/layout/index.vue` | Add AI sidebar slot to the right of main content |
| `src/views/sys-setting/index.vue` | Add AI Settings card |
| `src/store/ui.js` | Add `aiSidebarOpen` state |

---

## Task 1: Database Migration

**Files:**
- Modify: `mail-worker/src/entity/setting.js`
- Modify: `mail-worker/src/init/init.js`

- [ ] **Step 1: Add AI columns to setting entity**

```js
// Add after line 68 (mailcowTimeout) in setting.js:
	aiEnabled: integer('ai_enabled').default(0).notNull(),
	aiBaseUrl: text('ai_base_url').default('').notNull(),
	aiApiKey: text('ai_api_key').default('').notNull(),
	aiModel: text('ai_model').default('gpt-4o-mini').notNull(),
	aiSystemPrompt: text('ai_system_prompt').default('').notNull(),
	aiAutoDraft: integer('ai_auto_draft').default(0).notNull()
```

- [ ] **Step 2: Add v4_2DB migration in init.js**

Add to the `init()` method call chain after `await this.v4_1DB(c);`:
```js
await this.v4_2DB(c);
```

Add the migration function before the closing `};` of dbInit:
```js
async v4_2DB(c) {
	const settingMigrations = [
		`ALTER TABLE setting ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;`,
		`ALTER TABLE setting ADD COLUMN ai_base_url TEXT NOT NULL DEFAULT '';`,
		`ALTER TABLE setting ADD COLUMN ai_api_key TEXT NOT NULL DEFAULT '';`,
		`ALTER TABLE setting ADD COLUMN ai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini';`,
		`ALTER TABLE setting ADD COLUMN ai_system_prompt TEXT NOT NULL DEFAULT '';`,
		`ALTER TABLE setting ADD COLUMN ai_auto_draft INTEGER NOT NULL DEFAULT 0;`
	];

	for (const sql of settingMigrations) {
		try {
			await c.env.db.prepare(sql).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	}

	try {
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS ai_conversations (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				messages TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`).run();
	} catch (e) {
		console.warn(`AI conversations table: ${e.message}`);
	}
},
```

- [ ] **Step 3: Update setting-service.js — parse AI fields**

In `_parseSettingRow(row)`, add before the `return parsed;` line:
```js
// 解析 AI 设置
if (parsed.aiEnabled === undefined) parsed.aiEnabled = parsed.ai_enabled ?? 0;
if (parsed.aiBaseUrl === undefined) parsed.aiBaseUrl = parsed.ai_base_url ?? '';
if (parsed.aiApiKey === undefined) parsed.aiApiKey = parsed.ai_api_key ?? '';
if (parsed.aiModel === undefined) parsed.aiModel = parsed.ai_model ?? 'gpt-4o-mini';
if (parsed.aiSystemPrompt === undefined) parsed.aiSystemPrompt = parsed.ai_system_prompt ?? '';
if (parsed.aiAutoDraft === undefined) parsed.aiAutoDraft = parsed.ai_auto_draft ?? 0;
```

In `get(c)`, add after the s3SecretKey masking line:
```js
settingRow.aiApiKey = settingRow.aiApiKey ? `${settingRow.aiApiKey.slice(0, 8)}******` : '';
```

In `set(c, params)`, add AI key handling (before the final `orm(c).update` call):
```js
// AI settings: 保留原始 key 如果前端发送了 masked 值
if (params.aiApiKey && params.aiApiKey.includes('******')) {
	delete params.aiApiKey;
}
```

- [ ] **Step 4: Commit**

```
git add mail-worker/src/entity/setting.js mail-worker/src/init/init.js mail-worker/src/service/setting-service.js
git commit -m "feat(ai): add AI setting columns and ai_conversations table migration"
```

---

## Task 2: AI Provider Service

**Files:**
- Create: `mail-worker/src/service/ai-provider.js`

- [ ] **Step 1: Create ai-provider.js**

```js
import settingService from './setting-service';

const AI_TIMEOUT = 30000;
const MAX_TOOL_STEPS = 5;

const aiProvider = {

	async _getConfig(c) {
		const settings = await settingService.query(c);
		if (!settings.aiEnabled) {
			throw Object.assign(new Error('AI_NOT_CONFIGURED'), { code: 400 });
		}
		if (!settings.aiBaseUrl || !settings.aiApiKey) {
			throw Object.assign(new Error('AI_NOT_CONFIGURED'), { code: 400 });
		}
		return {
			baseUrl: settings.aiBaseUrl.replace(/\/+$/, ''),
			apiKey: settings.aiApiKey,
			model: settings.aiModel || 'gpt-4o-mini',
			systemPrompt: settings.aiSystemPrompt || ''
		};
	},

	async chatCompletion(c, messages, options = {}) {
		const config = await this._getConfig(c);
		const body = {
			model: options.model || config.model,
			messages,
			...(options.temperature !== undefined && { temperature: options.temperature }),
			...(options.max_tokens && { max_tokens: options.max_tokens }),
			...(options.tools && { tools: options.tools })
		};

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), options.timeout || AI_TIMEOUT);

		try {
			const resp = await fetch(`${config.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${config.apiKey}`
				},
				body: JSON.stringify(body),
				signal: controller.signal
			});

			if (!resp.ok) {
				const errBody = await resp.text().catch(() => '');
				if (resp.status === 401) throw Object.assign(new Error('AI_AUTH_FAILED'), { code: 401 });
				if (resp.status === 429) throw Object.assign(new Error('AI_RATE_LIMITED'), { code: 429 });
				if (resp.status === 404) throw Object.assign(new Error('AI_MODEL_NOT_FOUND'), { code: 404 });
				throw Object.assign(new Error(`AI_ERROR: ${resp.status} ${errBody.slice(0, 200)}`), { code: resp.status });
			}

			return await resp.json();
		} catch (e) {
			if (e.name === 'AbortError') throw Object.assign(new Error('AI_TIMEOUT'), { code: 408 });
			throw e;
		} finally {
			clearTimeout(timeoutId);
		}
	},

	async chatCompletionStream(c, messages, options = {}) {
		const config = await this._getConfig(c);
		const body = {
			model: options.model || config.model,
			messages,
			stream: true,
			...(options.temperature !== undefined && { temperature: options.temperature }),
			...(options.max_tokens && { max_tokens: options.max_tokens }),
			...(options.tools && { tools: options.tools })
		};

		const resp = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`
			},
			body: JSON.stringify(body)
		});

		if (!resp.ok) {
			const errBody = await resp.text().catch(() => '');
			if (resp.status === 401) throw Object.assign(new Error('AI_AUTH_FAILED'), { code: 401 });
			if (resp.status === 429) throw Object.assign(new Error('AI_RATE_LIMITED'), { code: 429 });
			throw Object.assign(new Error(`AI_ERROR: ${resp.status} ${errBody.slice(0, 200)}`), { code: resp.status });
		}

		return resp.body;
	},

	async callWithTools(c, messages, tools, executeTool, options = {}) {
		const maxSteps = options.maxSteps || MAX_TOOL_STEPS;
		let currentMessages = [...messages];
		const toolCallLog = [];

		for (let step = 0; step < maxSteps; step++) {
			const result = await this.chatCompletion(c, currentMessages, { ...options, tools });
			const choice = result.choices?.[0];
			if (!choice) break;

			const assistantMsg = choice.message;
			currentMessages.push(assistantMsg);

			if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
				return { content: assistantMsg.content, toolCalls: toolCallLog, messages: currentMessages };
			}

			for (const toolCall of assistantMsg.tool_calls) {
				const fnName = toolCall.function.name;
				let fnArgs = {};
				try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

				let toolResult;
				try {
					toolResult = await executeTool(fnName, fnArgs);
					toolCallLog.push({ name: fnName, args: fnArgs, result: toolResult, status: 'done' });
				} catch (e) {
					toolResult = { error: e.message };
					toolCallLog.push({ name: fnName, args: fnArgs, result: toolResult, status: 'error' });
				}

				currentMessages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(toolResult)
				});
			}
		}

		const lastAssistant = currentMessages.filter(m => m.role === 'assistant').pop();
		return { content: lastAssistant?.content || '', toolCalls: toolCallLog, messages: currentMessages };
	},

	async testConnection(c) {
		const config = await this._getConfig(c);
		const resp = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`
			},
			body: JSON.stringify({
				model: config.model,
				messages: [{ role: 'user', content: 'Hi' }],
				max_tokens: 5
			})
		});

		if (!resp.ok) {
			const errBody = await resp.text().catch(() => '');
			throw new Error(`Connection failed: ${resp.status} ${errBody.slice(0, 200)}`);
		}
		const data = await resp.json();
		return { success: true, model: data.model || config.model };
	}
};

export default aiProvider;
```

- [ ] **Step 2: Commit**

```
git add mail-worker/src/service/ai-provider.js
git commit -m "feat(ai): add OpenAI-compatible AI provider service"
```

---

## Task 3: AI Tool Service

**Files:**
- Create: `mail-worker/src/service/ai-tool-service.js`

- [ ] **Step 1: Create ai-tool-service.js with 8 Phase 1 tools**

```js
import emailService from './email-service';
import orm from '../entity/orm';
import email from '../entity/email';
import { emailConst, isDel } from '../const/entity-const';
import { and, eq, desc, like, or } from 'drizzle-orm';
import { star } from '../entity/star';
import account from '../entity/account';
import attService from './att-service';

const tools = [
	{
		name: 'list_emails',
		description: 'List emails in the inbox. Returns subject, sender, date, read status. Use type=0 for received, type=1 for sent.',
		parameters: {
			type: 'object',
			properties: {
				type: { type: 'number', description: '0=received (inbox), 1=sent', default: 0 },
				size: { type: 'number', description: 'Number of emails to return (max 20)', default: 10 }
			}
		},
		execute: async (params, ctx) => {
			const type = params.type ?? 0;
			const size = Math.min(params.size || 10, 20);
			const rows = await orm(ctx.c)
				.select({
					emailId: email.emailId,
					sendEmail: email.sendEmail,
					name: email.name,
					subject: email.subject,
					unread: email.unread,
					createTime: email.createTime
				})
				.from(email)
				.where(and(
					eq(email.userId, ctx.userId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL)
				))
				.orderBy(desc(email.emailId))
				.limit(size)
				.all();
			return { emails: rows, count: rows.length };
		}
	},
	{
		name: 'get_email',
		description: 'Get the full content of a single email by its ID. Returns subject, sender, body text, attachments.',
		parameters: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The email ID to retrieve' }
			},
			required: ['emailId']
		},
		execute: async (params, ctx) => {
			const row = await orm(ctx.c).select().from(email)
				.where(and(
					eq(email.emailId, params.emailId),
					eq(email.userId, ctx.userId),
					eq(email.isDel, isDel.NORMAL)
				)).get();
			if (!row) return { error: 'Email not found' };
			const attList = await attService.selectByEmailIds(ctx.c, [row.emailId]);
			const textBody = row.text || stripHtml(row.content || '');
			return {
				emailId: row.emailId,
				from: row.sendEmail,
				fromName: row.name,
				subject: row.subject,
				body: textBody.slice(0, 3000),
				date: row.createTime,
				unread: row.unread,
				attachments: attList.map(a => ({ name: a.name, size: a.size }))
			};
		}
	},
	{
		name: 'get_thread',
		description: 'Get all emails in a conversation thread by email ID. Uses messageId/inReplyTo to find related emails.',
		parameters: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'Any email ID in the thread' }
			},
			required: ['emailId']
		},
		execute: async (params, ctx) => {
			const row = await orm(ctx.c).select().from(email)
				.where(and(eq(email.emailId, params.emailId), eq(email.userId, ctx.userId), eq(email.isDel, isDel.NORMAL)))
				.get();
			if (!row) return { error: 'Email not found' };

			const messageId = row.messageId;
			if (!messageId) return { thread: [formatThreadEmail(row)] };

			const threadEmails = await orm(ctx.c).select().from(email)
				.where(and(
					eq(email.userId, ctx.userId),
					eq(email.isDel, isDel.NORMAL),
					or(
						eq(email.messageId, messageId),
						eq(email.inReplyTo, messageId),
						eq(email.messageId, row.inReplyTo || '__none__')
					)
				))
				.orderBy(desc(email.emailId))
				.limit(20)
				.all();

			return { thread: threadEmails.map(formatThreadEmail), count: threadEmails.length };
		}
	},
	{
		name: 'search_emails',
		description: 'Search emails by keyword in subject or body text. Returns matching emails.',
		parameters: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search keyword' },
				type: { type: 'number', description: '0=received, 1=sent', default: 0 },
				limit: { type: 'number', description: 'Max results', default: 10 }
			},
			required: ['query']
		},
		execute: async (params, ctx) => {
			const q = `%${params.query}%`;
			const rows = await orm(ctx.c)
				.select({
					emailId: email.emailId,
					sendEmail: email.sendEmail,
					name: email.name,
					subject: email.subject,
					createTime: email.createTime,
					unread: email.unread
				})
				.from(email)
				.where(and(
					eq(email.userId, ctx.userId),
					eq(email.type, params.type ?? 0),
					eq(email.isDel, isDel.NORMAL),
					or(like(email.subject, q), like(email.text, q))
				))
				.orderBy(desc(email.emailId))
				.limit(Math.min(params.limit || 10, 20))
				.all();
			return { results: rows, count: rows.length };
		}
	},
	{
		name: 'draft_reply',
		description: 'Create a draft reply to an email. The draft is saved but NOT sent. The user reviews and sends from UI.',
		parameters: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The email ID to reply to' },
				body: { type: 'string', description: 'The reply body text (plain text, no HTML)' }
			},
			required: ['emailId', 'body']
		},
		execute: async (params, ctx) => {
			const original = await orm(ctx.c).select().from(email)
				.where(and(eq(email.emailId, params.emailId), eq(email.userId, ctx.userId), eq(email.isDel, isDel.NORMAL)))
				.get();
			if (!original) return { error: 'Original email not found' };

			const draftData = {
				sendEmail: original.sendEmail,
				name: original.name || '',
				accountId: original.accountId,
				userId: ctx.userId,
				subject: original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject || ''}`,
				text: params.body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(params.body)}</div>`,
				toEmail: original.sendEmail || '',
				inReplyTo: original.messageId || '',
				messageId: '',
				type: emailConst.type.SEND,
				status: emailConst.status.SAVING,
				isDel: isDel.NORMAL,
				unread: emailConst.unread.READ
			};

			const result = await orm(ctx.c).insert(email).values(draftData).returning().get();
			return { draftId: result.emailId, message: 'Draft reply saved. User can review and send from the UI.' };
		}
	},
	{
		name: 'draft_email',
		description: 'Create a new draft email. The draft is saved but NOT sent. The user reviews and sends from UI.',
		parameters: {
			type: 'object',
			properties: {
				to: { type: 'string', description: 'Recipient email address' },
				subject: { type: 'string', description: 'Email subject' },
				body: { type: 'string', description: 'Email body text (plain text, no HTML)' },
				accountId: { type: 'number', description: 'Sender account ID (from list_emails results)' }
			},
			required: ['to', 'subject', 'body']
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

			const draftData = {
				sendEmail: '',
				name: '',
				accountId: accountId,
				userId: ctx.userId,
				subject: params.subject,
				text: params.body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(params.body)}</div>`,
				toEmail: params.to,
				type: emailConst.type.SEND,
				status: emailConst.status.SAVING,
				isDel: isDel.NORMAL,
				unread: emailConst.unread.READ
			};

			const result = await orm(ctx.c).insert(email).values(draftData).returning().get();
			return { draftId: result.emailId, message: 'Draft email saved. User can review and send from the UI.' };
		}
	},
	{
		name: 'mark_email_read',
		description: 'Mark one or more emails as read.',
		parameters: {
			type: 'object',
			properties: {
				emailIds: {
					type: 'array',
					items: { type: 'number' },
					description: 'Array of email IDs to mark as read'
				}
			},
			required: ['emailIds']
		},
		execute: async (params, ctx) => {
			const ids = Array.isArray(params.emailIds) ? params.emailIds : [params.emailIds];
			await emailService.read(ctx.c, { emailIds: ids }, ctx.userId);
			return { marked: ids.length, message: `${ids.length} email(s) marked as read` };
		}
	},
	{
		name: 'summarize_email',
		description: 'Generate an AI summary of an email. Returns a concise summary of the email content.',
		parameters: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The email ID to summarize' }
			},
			required: ['emailId']
		},
		execute: async (params, ctx) => {
			// This tool delegates to ai-service.summarizeEmail
			// It's handled specially in ai-service.js chat flow
			return { _delegate: 'summarize', emailId: params.emailId };
		}
	}
];

function stripHtml(html) {
	if (!html) return '';
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(text) {
	if (!text) return '';
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function formatThreadEmail(row) {
	return {
		emailId: row.emailId,
		from: row.sendEmail,
		fromName: row.name,
		subject: row.subject,
		body: (row.text || stripHtml(row.content || '')).slice(0, 2000),
		date: row.createTime
	};
}

const aiToolService = {

	getToolDefinitions() {
		return tools.map(t => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters
			}
		}));
	},

	async executeTool(name, args, ctx) {
		const tool = tools.find(t => t.name === name);
		if (!tool) throw new Error(`Unknown tool: ${name}`);
		return await tool.execute(args, ctx);
	},

	getToolNames() {
		return tools.map(t => t.name);
	}
};

export default aiToolService;
```

- [ ] **Step 2: Commit**

```
git add mail-worker/src/service/ai-tool-service.js
git commit -m "feat(ai): add AI tool service with 8 email tools"
```

---

## Task 4: AI Service

**Files:**
- Create: `mail-worker/src/service/ai-service.js`

- [ ] **Step 1: Create ai-service.js**

```js
import aiProvider from './ai-provider';
import aiToolService from './ai-tool-service';
import settingService from './setting-service';

const DEFAULT_SYSTEM_PROMPT = `You are an email assistant helping manage this inbox. You can read emails, draft replies, search, and organize conversations.

## Writing Style
Write like a real person. Short, direct, natural. Do not use HTML tags.

## Rules
- Drafts are saved but NEVER sent automatically. The user reviews and sends from UI.
- Draft body should only contain the email text, no metadata.
- Read the full thread history before replying.
- Do not repeat information already in the thread.

## Draft Management
Use draft_reply to draft a reply to an existing email.
Use draft_email to compose a new email.

## Language
Respond in the same language the user uses to talk to you.`;

const aiService = {

	async chat(c, userId, userMessage, options = {}) {
		const config = await aiProvider._getConfig(c);
		const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

		const messages = [];
		messages.push({ role: 'system', content: systemPrompt });

		// Add conversation history if provided
		if (options.history && Array.isArray(options.history)) {
			for (const msg of options.history) {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		// Add context about current email if provided
		if (options.currentEmailId) {
			messages.push({
				role: 'system',
				content: `The user is currently viewing email ID: ${options.currentEmailId}. You can reference this email in tool calls.`
			});
		}

		messages.push({ role: 'user', content: userMessage });

		const toolDefs = aiToolService.getToolDefinitions();

		const ctx = { c, userId };

		const executeTool = async (name, args) => {
			const result = await aiToolService.executeTool(name, args, ctx);
			// Handle delegated tools (like summarize_email)
			if (result._delegate === 'summarize') {
				return await this._summarizeForTool(c, userId, result.emailId);
			}
			return result;
		};

		const result = await aiProvider.callWithTools(c, messages, toolDefs, executeTool);
		return result;
	},

	async chatStream(c, userId, userMessage, options = {}) {
		const config = await aiProvider._getConfig(c);
		const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

		const messages = [];
		messages.push({ role: 'system', content: systemPrompt });

		if (options.history && Array.isArray(options.history)) {
			for (const msg of options.history) {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		if (options.currentEmailId) {
			messages.push({
				role: 'system',
				content: `The user is currently viewing email ID: ${options.currentEmailId}. You can reference this email in tool calls.`
			});
		}

		messages.push({ role: 'user', content: userMessage });

		const toolDefs = aiToolService.getToolDefinitions();
		const ctx = { c, userId };

		// For streaming with tools, we first do a non-stream call to handle tool calls,
		// then stream the final response.
		const firstResult = await aiProvider.chatCompletion(c, messages, { tools: toolDefs });
		const firstChoice = firstResult.choices?.[0];

		if (!firstChoice) {
			return { stream: null, toolCalls: [], content: '' };
		}

		// If no tool calls, re-do with streaming for the response
		if (!firstChoice.message.tool_calls || firstChoice.message.tool_calls.length === 0) {
			const stream = await aiProvider.chatCompletionStream(c, messages);
			return { stream, toolCalls: [], content: null };
		}

		// Handle tool calls in non-streaming mode, collect results
		let currentMessages = [...messages, firstChoice.message];
		const toolCallLog = [];

		const maxSteps = 5;
		for (let step = 0; step < maxSteps; step++) {
			const assistantMsg = currentMessages[currentMessages.length - 1];
			if (assistantMsg.role !== 'assistant' || !assistantMsg.tool_calls) break;

			for (const toolCall of assistantMsg.tool_calls) {
				const fnName = toolCall.function.name;
				let fnArgs = {};
				try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

				let toolResult;
				try {
					toolResult = await aiToolService.executeTool(fnName, fnArgs, ctx);
					if (toolResult._delegate === 'summarize') {
						toolResult = await this._summarizeForTool(c, userId, toolResult.emailId);
					}
					toolCallLog.push({ name: fnName, args: fnArgs, status: 'done' });
				} catch (e) {
					toolResult = { error: e.message };
					toolCallLog.push({ name: fnName, args: fnArgs, status: 'error', error: e.message });
				}

				currentMessages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(toolResult)
				});
			}

			// Check if more tool calls
			const nextResult = await aiProvider.chatCompletion(c, currentMessages, { tools: toolDefs });
			const nextChoice = nextResult.choices?.[0];
			if (!nextChoice) break;
			currentMessages.push(nextChoice.message);

			if (!nextChoice.message.tool_calls || nextChoice.message.tool_calls.length === 0) {
				// Final response ready — stream it
				const stream = await aiProvider.chatCompletionStream(c, currentMessages);
				return { stream, toolCalls: toolCallLog, content: null };
			}
		}

		// Fallback: return last content if max steps reached
		const lastAssistant = currentMessages.filter(m => m.role === 'assistant').pop();
		return { stream: null, toolCalls: toolCallLog, content: lastAssistant?.content || '' };
	},

	async _summarizeForTool(c, userId, emailId) {
		const result = await aiToolService.executeTool('get_email', { emailId }, { c, userId });
		if (result.error) return result;
		const summaryResult = await aiProvider.chatCompletion(c, [
			{ role: 'system', content: 'Summarize the following email concisely in 2-3 sentences. Respond in the same language as the email.' },
			{ role: 'user', content: `From: ${result.from}\nSubject: ${result.subject}\nDate: ${result.date}\n\n${result.body}` }
		], { max_tokens: 300 });
		return { emailId, subject: result.subject, summary: summaryResult.choices?.[0]?.message?.content || '' };
	},

	async summarizeEmail(c, userId, emailId) {
		return await this._summarizeForTool(c, userId, emailId);
	},

	async translateEmail(c, userId, emailId, targetLang) {
		const result = await aiToolService.executeTool('get_email', { emailId }, { c, userId });
		if (result.error) return result;
		const translated = await aiProvider.chatCompletion(c, [
			{ role: 'system', content: `Translate the following email into ${targetLang}. Preserve the formatting. Only output the translation.` },
			{ role: 'user', content: `Subject: ${result.subject}\n\n${result.body}` }
		], { max_tokens: 2000 });
		return {
			emailId,
			originalSubject: result.subject,
			translation: translated.choices?.[0]?.message?.content || '',
			targetLang
		};
	},

	async saveConversation(c, userId, conversationId, messages) {
		const now = new Date().toISOString();
		const messagesJson = JSON.stringify(messages);
		try {
			await c.env.db.prepare(
				`INSERT OR REPLACE INTO ai_conversations (id, user_id, messages, created_at, updated_at)
				 VALUES (?, ?, ?, COALESCE((SELECT created_at FROM ai_conversations WHERE id = ?), ?), ?)`
			).bind(conversationId, userId, messagesJson, conversationId, now, now).run();
		} catch (e) {
			console.warn('Failed to save conversation:', e.message);
		}
	},

	async getConversation(c, userId, conversationId) {
		try {
			const row = await c.env.db.prepare(
				'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?'
			).bind(conversationId, userId).first();
			if (!row) return null;
			return { ...row, messages: JSON.parse(row.messages || '[]') };
		} catch {
			return null;
		}
	},

	async listConversations(c, userId) {
		try {
			const { results } = await c.env.db.prepare(
				'SELECT id, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20'
			).bind(userId).all();
			return results || [];
		} catch {
			return [];
		}
	},

	async deleteConversation(c, userId, conversationId) {
		try {
			if (conversationId) {
				await c.env.db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?')
					.bind(conversationId, userId).run();
			} else {
				await c.env.db.prepare('DELETE FROM ai_conversations WHERE user_id = ?')
					.bind(userId).run();
			}
		} catch (e) {
			console.warn('Failed to delete conversation:', e.message);
		}
	}
};

export default aiService;
```

- [ ] **Step 2: Commit**

```
git add mail-worker/src/service/ai-service.js
git commit -m "feat(ai): add AI service with chat, summarize, translate, conversations"
```

---

## Task 5: AI API Routes + Security Config

**Files:**
- Create: `mail-worker/src/api/ai-api.js`
- Modify: `mail-worker/src/hono/webs.js`
- Modify: `mail-worker/src/security/security.js`

- [ ] **Step 1: Create ai-api.js**

```js
import app from '../hono/hono';
import result from '../model/result';
import aiService from '../service/ai-service';
import aiProvider from '../service/ai-provider';
import userContext from '../security/user-context';

// Streaming chat (SSE)
app.post('/ai/chat', async (c) => {
	const userId = userContext.getUserId(c);
	const { message, conversationId, currentEmailId, history } = await c.req.json();

	if (!message || !message.trim()) {
		return c.json(result.fail('Message is required', 400));
	}

	try {
		const chatResult = await aiService.chatStream(c, userId, message, {
			currentEmailId,
			history: history || []
		});

		// If we have tool calls, send them as SSE events first
		const encoder = new TextEncoder();
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();

		const writeSSE = async (data) => {
			await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
		};

		(async () => {
			try {
				// Send tool call events
				for (const tc of chatResult.toolCalls) {
					await writeSSE({ type: 'tool_call', name: tc.name, status: tc.status, error: tc.error });
				}

				if (chatResult.stream) {
					// Pipe the SSE stream from upstream, re-packaging chunks
					const reader = chatResult.stream.getReader();
					const decoder = new TextDecoder();
					let buffer = '';

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (const line of lines) {
							if (line.startsWith('data: ')) {
								const data = line.slice(6).trim();
								if (data === '[DONE]') {
									await writeSSE({ type: 'done' });
									continue;
								}
								try {
									const parsed = JSON.parse(data);
									const delta = parsed.choices?.[0]?.delta;
									if (delta?.content) {
										await writeSSE({ type: 'text', content: delta.content });
									}
								} catch {}
							}
						}
					}
				} else if (chatResult.content) {
					// Non-stream fallback: send full content as single event
					await writeSSE({ type: 'text', content: chatResult.content });
				}

				await writeSSE({ type: 'done' });
			} catch (e) {
				await writeSSE({ type: 'error', message: e.message });
			} finally {
				await writer.close();
			}
		})();

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});

// Non-stream chat (for simple tool calls)
app.post('/ai/chatSync', async (c) => {
	const userId = userContext.getUserId(c);
	const { message, currentEmailId, history } = await c.req.json();

	if (!message || !message.trim()) {
		return c.json(result.fail('Message is required', 400));
	}

	try {
		const chatResult = await aiService.chat(c, userId, message, {
			currentEmailId,
			history: history || []
		});
		return c.json(result.ok({
			content: chatResult.content,
			toolCalls: chatResult.toolCalls
		}));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});

// Summarize email
app.post('/ai/summarize', async (c) => {
	const userId = userContext.getUserId(c);
	const { emailId } = await c.req.json();
	try {
		const data = await aiService.summarizeEmail(c, userId, Number(emailId));
		return c.json(result.ok(data));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});

// Translate email
app.post('/ai/translate', async (c) => {
	const userId = userContext.getUserId(c);
	const { emailId, targetLang } = await c.req.json();
	try {
		const data = await aiService.translateEmail(c, userId, Number(emailId), targetLang || 'Chinese');
		return c.json(result.ok(data));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});

// List conversations
app.get('/ai/conversations', async (c) => {
	const userId = userContext.getUserId(c);
	const list = await aiService.listConversations(c, userId);
	return c.json(result.ok(list));
});

// Delete conversation(s)
app.delete('/ai/conversations', async (c) => {
	const userId = userContext.getUserId(c);
	const conversationId = c.req.query('id');
	await aiService.deleteConversation(c, userId, conversationId);
	return c.json(result.ok());
});

// Test AI connection
app.post('/ai/test-connection', async (c) => {
	try {
		const data = await aiProvider.testConnection(c);
		return c.json(result.ok(data));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});
```

- [ ] **Step 2: Register ai-api.js in webs.js**

Add after the last import in `mail-worker/src/hono/webs.js`:
```js
import '../api/ai-api';
```

- [ ] **Step 3: Update security.js — add AI test-connection to admin-only routes**

Add to the `requirePerms` array:
```js
'/ai/test-connection',
```

Add to the `premKey` object:
```js
'setting:set': ['/setting/set', '/setting/setBackground', '/setting/deleteBackground', '/ai/test-connection'],
```
(Replace the existing `'setting:set'` line.)

- [ ] **Step 4: Commit**

```
git add mail-worker/src/api/ai-api.js mail-worker/src/hono/webs.js mail-worker/src/security/security.js
git commit -m "feat(ai): add AI API routes and security config"
```

---

## Task 6: Frontend — Request Module + Store

**Files:**
- Create: `mail-vue/src/request/ai.js`
- Create: `mail-vue/src/store/ai.js`
- Modify: `mail-vue/src/store/ui.js`

- [ ] **Step 1: Create ai.js request module**

```js
import http from '@/axios/index.js';

export function aiSummarize(emailId) {
    return http.post('/ai/summarize', { emailId })
}

export function aiTranslate(emailId, targetLang) {
    return http.post('/ai/translate', { emailId, targetLang })
}

export function aiConversationList() {
    return http.get('/ai/conversations')
}

export function aiConversationDelete(id) {
    return http.delete('/ai/conversations' + (id ? `?id=${id}` : ''))
}

export function aiTestConnection() {
    return http.post('/ai/test-connection')
}

// SSE chat — uses native fetch, not axios (axios doesn't support streaming)
export function aiChatStream(message, options = {}) {
    const baseUrl = import.meta.env.VITE_BASE_URL;
    const token = localStorage.getItem('token');

    const controller = new AbortController();

    const fetchPromise = fetch(`${baseUrl}/ai/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify({
            message,
            currentEmailId: options.currentEmailId,
            history: options.history || []
        }),
        signal: controller.signal
    });

    return { fetchPromise, controller };
}

// Parse SSE stream
export async function* parseSSEStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (!data) continue;
                    try {
                        const parsed = JSON.parse(data);
                        yield parsed;
                    } catch {}
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
```

- [ ] **Step 2: Create ai.js Pinia store**

```js
import { defineStore } from 'pinia'
import { aiChatStream, parseSSEStream } from '@/request/ai.js'

export const useAiStore = defineStore('ai', {
    state: () => ({
        sidebarOpen: false,
        messages: [],        // [{ role, content, toolCalls?, timestamp }]
        isStreaming: false,
        currentEmailId: null,
        abortController: null,
        streamingContent: '',
        streamingToolCalls: []
    }),
    actions: {
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
        },

        setCurrentEmail(emailId) {
            this.currentEmailId = emailId;
        },

        async sendMessage(text) {
            if (this.isStreaming) return;
            if (!text.trim()) return;

            // Add user message
            this.messages.push({
                role: 'user',
                content: text,
                timestamp: new Date().toISOString()
            });

            this.isStreaming = true;
            this.streamingContent = '';
            this.streamingToolCalls = [];

            // Build history (last 20 messages for context)
            const history = this.messages.slice(-21, -1).map(m => ({
                role: m.role,
                content: m.content
            }));

            const { fetchPromise, controller } = aiChatStream(text, {
                currentEmailId: this.currentEmailId,
                history
            });

            this.abortController = controller;

            try {
                const response = await fetchPromise;

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ message: 'AI request failed' }));
                    this.messages.push({
                        role: 'assistant',
                        content: errData.message || 'Error communicating with AI',
                        isError: true,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }

                for await (const event of parseSSEStream(response)) {
                    if (event.type === 'text') {
                        this.streamingContent += event.content;
                    } else if (event.type === 'tool_call') {
                        this.streamingToolCalls.push({
                            name: event.name,
                            status: event.status,
                            error: event.error
                        });
                    } else if (event.type === 'error') {
                        this.streamingContent += `\n\nError: ${event.message}`;
                    } else if (event.type === 'done') {
                        break;
                    }
                }

                // Commit assistant message
                if (this.streamingContent || this.streamingToolCalls.length) {
                    this.messages.push({
                        role: 'assistant',
                        content: this.streamingContent,
                        toolCalls: [...this.streamingToolCalls],
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                if (e.name !== 'AbortError') {
                    this.messages.push({
                        role: 'assistant',
                        content: 'Connection error: ' + e.message,
                        isError: true,
                        timestamp: new Date().toISOString()
                    });
                }
            } finally {
                this.isStreaming = false;
                this.streamingContent = '';
                this.streamingToolCalls = [];
                this.abortController = null;
            }
        },

        stopStreaming() {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
        },

        clearMessages() {
            this.messages = [];
            this.streamingContent = '';
            this.streamingToolCalls = [];
        }
    }
})
```

- [ ] **Step 3: Add aiSidebarOpen to ui store**

In `mail-vue/src/store/ui.js`, add `aiSidebarOpen: false` to state (after `dark: false`):

```js
aiSidebarOpen: false
```

Add to the `persist.pick` array:
```js
persist: {
    pick: ['dark', 'aiSidebarOpen'],
},
```

- [ ] **Step 4: Commit**

```
git add mail-vue/src/request/ai.js mail-vue/src/store/ai.js mail-vue/src/store/ui.js
git commit -m "feat(ai): add frontend AI request module and Pinia store"
```

---

## Task 7: AI Settings UI

**Files:**
- Modify: `mail-vue/src/views/sys-setting/index.vue`

- [ ] **Step 1: Add AI settings card to sys-setting**

Add an AI Settings card to the template's `card-grid` div. Place it after the existing settings cards. The exact insertion point is after the last `</div><!-- settings-card -->` inside `card-grid`:

```html
<!-- AI Settings Card -->
<div class="settings-card">
  <div class="card-title">AI {{ $t('setting') }}</div>
  <div class="card-content">
    <div class="setting-item">
      <div><span>AI {{ $t('enable') }}</span></div>
      <div>
        <el-switch @change="change" :active-value="1" :inactive-value="0" v-model="setting.aiEnabled"/>
      </div>
    </div>
    <div class="setting-item" v-if="setting.aiEnabled">
      <div><span>API Base URL</span></div>
      <div>
        <el-input v-model="setting.aiBaseUrl" placeholder="https://api.openai.com/v1" style="width: 300px" @change="change"/>
      </div>
    </div>
    <div class="setting-item" v-if="setting.aiEnabled">
      <div><span>API Key</span></div>
      <div>
        <el-input v-model="setting.aiApiKey" type="password" show-password placeholder="sk-..." style="width: 300px" @change="change"/>
      </div>
    </div>
    <div class="setting-item" v-if="setting.aiEnabled">
      <div><span>Model</span></div>
      <div>
        <el-input v-model="setting.aiModel" placeholder="gpt-4o-mini" style="width: 200px" @change="change"/>
      </div>
    </div>
    <div class="setting-item" v-if="setting.aiEnabled">
      <div><span>System Prompt</span></div>
      <div>
        <el-input v-model="setting.aiSystemPrompt" type="textarea" :rows="3" placeholder="Custom system prompt (optional)" style="width: 400px" @change="change"/>
      </div>
    </div>
    <div class="setting-item" v-if="setting.aiEnabled">
      <div><span>{{ $t('test') }}</span></div>
      <div>
        <el-button type="primary" :loading="aiTestLoading" @click="testAiConnection">
          Test Connection
        </el-button>
      </div>
    </div>
  </div>
</div>
```

Add to the `<script setup>` section — data and method:

```js
import { aiTestConnection } from '@/request/ai.js'

const aiTestLoading = ref(false)

const testAiConnection = async () => {
    aiTestLoading.value = true
    try {
        const data = await aiTestConnection()
        ElMessage.success(`AI Connected! Model: ${data.model}`)
    } catch (e) {
        ElMessage.error(`AI Connection failed: ${e.message || e}`)
    } finally {
        aiTestLoading.value = false
    }
}
```

> Note: the exact insertion points depend on the existing sys-setting/index.vue structure. The implementer should find the `card-grid` container and add this as a new card.

- [ ] **Step 2: Commit**

```
git add mail-vue/src/views/sys-setting/index.vue
git commit -m "feat(ai): add AI configuration card to system settings"
```

---

## Task 8: AI Sidebar Components

**Files:**
- Create: `mail-vue/src/components/ai-sidebar/AiToolCallBadge.vue`
- Create: `mail-vue/src/components/ai-sidebar/AiInputBar.vue`
- Create: `mail-vue/src/components/ai-sidebar/AiMessageBubble.vue`
- Create: `mail-vue/src/components/ai-sidebar/AiChatPanel.vue`
- Create: `mail-vue/src/components/ai-sidebar/AiSidebar.vue`

- [ ] **Step 1: Create AiToolCallBadge.vue**

```vue
<template>
  <div class="tool-badge" :class="status">
    <span class="tool-icon">{{ toolIcon }}</span>
    <span class="tool-name">{{ displayName }}</span>
    <el-icon v-if="status === 'done'" class="status-icon"><Check /></el-icon>
    <el-icon v-else-if="status === 'error'" class="status-icon error"><CloseBold /></el-icon>
    <el-icon v-else class="status-icon loading"><Loading /></el-icon>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Check, CloseBold, Loading } from '@element-plus/icons-vue'

const props = defineProps({
  name: { type: String, required: true },
  status: { type: String, default: 'running' }
})

const TOOL_ICONS = {
  list_emails: '📧', get_email: '👁', get_thread: '🔗',
  search_emails: '🔍', draft_reply: '✏️', draft_email: '✏️',
  mark_email_read: '✅', summarize_email: '📋', translate_email: '🌐',
  move_email: '📁', discard_draft: '🗑️'
}

const TOOL_NAMES = {
  list_emails: 'List Emails', get_email: 'Read Email', get_thread: 'Get Thread',
  search_emails: 'Search', draft_reply: 'Draft Reply', draft_email: 'Draft Email',
  mark_email_read: 'Mark Read', summarize_email: 'Summarize', translate_email: 'Translate',
  move_email: 'Move Email', discard_draft: 'Discard Draft'
}

const toolIcon = computed(() => TOOL_ICONS[props.name] || '🔧')
const displayName = computed(() => TOOL_NAMES[props.name] || props.name)
</script>

<style scoped>
.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  margin: 2px 4px 2px 0;
}
.tool-badge.done { background: var(--el-color-success-light-9); }
.tool-badge.error { background: var(--el-color-danger-light-9); }
.tool-icon { font-size: 12px; }
.tool-name { font-weight: 500; }
.status-icon { font-size: 12px; margin-left: 2px; }
.status-icon.error { color: var(--el-color-danger); }
.status-icon.loading { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: Create AiInputBar.vue**

```vue
<template>
  <div class="ai-input-bar">
    <div class="input-row">
      <el-input
        ref="inputRef"
        v-model="text"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        :placeholder="$t('ai.inputPlaceholder') || 'Ask your email assistant...'"
        @keydown.enter.exact.prevent="send"
        :disabled="isStreaming"
      />
      <el-button
        v-if="isStreaming"
        type="danger"
        circle
        size="small"
        @click="$emit('stop')"
        class="send-btn"
      >
        <el-icon><VideoPause /></el-icon>
      </el-button>
      <el-button
        v-else
        type="primary"
        circle
        size="small"
        @click="send"
        :disabled="!text.trim()"
        class="send-btn"
      >
        <el-icon><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Promotion, VideoPause } from '@element-plus/icons-vue'

const props = defineProps({
  isStreaming: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'stop'])
const text = ref('')
const inputRef = ref(null)

function send() {
  if (!text.value.trim() || props.isStreaming) return
  emit('send', text.value)
  text.value = ''
}

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style scoped>
.ai-input-bar {
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.input-row :deep(.el-textarea__inner) {
  resize: none;
  padding-right: 8px;
}
.send-btn { flex-shrink: 0; }
</style>
```

- [ ] **Step 3: Create AiMessageBubble.vue**

```vue
<template>
  <div class="message-bubble" :class="msg.role">
    <div v-if="msg.role === 'user'" class="bubble user-bubble">
      {{ msg.content }}
    </div>
    <div v-else class="bubble assistant-bubble">
      <div v-if="msg.toolCalls && msg.toolCalls.length" class="tool-calls">
        <AiToolCallBadge v-for="(tc, i) in msg.toolCalls" :key="i" :name="tc.name" :status="tc.status" />
      </div>
      <div v-if="msg.content" class="content" v-html="renderedContent"></div>
      <div v-if="msg.isError" class="error-text">{{ msg.content }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AiToolCallBadge from './AiToolCallBadge.vue'

const props = defineProps({
  msg: { type: Object, required: true }
})

// Simple markdown rendering (bold, italic, code, links, line breaks)
function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>')
  return html
}

const renderedContent = computed(() => renderMarkdown(props.msg.content))
</script>

<style scoped>
.message-bubble { display: flex; margin: 8px 0; }
.message-bubble.user { justify-content: flex-end; }
.message-bubble.assistant { justify-content: flex-start; }

.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.user-bubble {
  background: var(--el-color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.assistant-bubble {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border-bottom-left-radius: 4px;
}

.tool-calls { margin-bottom: 6px; display: flex; flex-wrap: wrap; }

.content :deep(pre) {
  background: var(--el-fill-color-darker);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 4px 0;
}
.content :deep(code) {
  background: var(--el-fill-color-dark);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.content :deep(pre code) { background: none; padding: 0; }
.error-text { color: var(--el-color-danger); font-style: italic; }
</style>
```

- [ ] **Step 4: Create AiChatPanel.vue**

```vue
<template>
  <div class="ai-chat-panel">
    <!-- Empty state -->
    <div v-if="!aiStore.messages.length && !aiStore.isStreaming" class="empty-state">
      <div class="robot-icon">🤖</div>
      <p class="intro">{{ $t('ai.intro') || 'I\'m your email assistant. I can read, search, draft, and manage your emails.' }}</p>
      <div class="suggestions">
        <el-button v-for="s in suggestions" :key="s" size="small" @click="sendSuggestion(s)" round>
          {{ s }}
        </el-button>
      </div>
    </div>

    <!-- Messages -->
    <el-scrollbar ref="scrollRef" class="messages-area" v-show="aiStore.messages.length || aiStore.isStreaming">
      <div class="messages-inner" ref="messagesRef">
        <AiMessageBubble v-for="(msg, i) in aiStore.messages" :key="i" :msg="msg" />
        <!-- Streaming message -->
        <div v-if="aiStore.isStreaming" class="message-bubble assistant">
          <div class="bubble assistant-bubble">
            <div v-if="aiStore.streamingToolCalls.length" class="tool-calls">
              <AiToolCallBadge
                v-for="(tc, i) in aiStore.streamingToolCalls" :key="i"
                :name="tc.name" :status="tc.status"
              />
            </div>
            <div v-if="aiStore.streamingContent" class="content" v-html="renderMarkdown(aiStore.streamingContent)"></div>
            <span v-else class="typing-indicator">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </span>
          </div>
        </div>
      </div>
    </el-scrollbar>

    <AiInputBar
      :is-streaming="aiStore.isStreaming"
      @send="onSend"
      @stop="aiStore.stopStreaming()"
    />
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { useAiStore } from '@/store/ai.js'
import AiMessageBubble from './AiMessageBubble.vue'
import AiToolCallBadge from './AiToolCallBadge.vue'
import AiInputBar from './AiInputBar.vue'

const aiStore = useAiStore()
const scrollRef = ref(null)
const messagesRef = ref(null)

const suggestions = [
  'Show my latest emails',
  'Find unread emails',
  'Draft a new email'
]

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

function onSend(text) {
  aiStore.sendMessage(text)
  scrollToBottom()
}

function sendSuggestion(s) {
  aiStore.sendMessage(s)
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollIntoView && scrollRef.value?.setScrollTop(messagesRef.value.scrollHeight)
    }
  })
}

watch(() => aiStore.streamingContent, scrollToBottom)
watch(() => aiStore.messages.length, scrollToBottom)
</script>

<style scoped>
.ai-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}
.robot-icon { font-size: 48px; margin-bottom: 12px; }
.intro { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 16px; max-width: 260px; }
.suggestions { display: flex; flex-direction: column; gap: 6px; }

.messages-area { flex: 1; min-height: 0; }
.messages-inner { padding: 12px; }

.typing-indicator { display: inline-flex; gap: 3px; padding: 4px 0; }
.dot {
  width: 6px; height: 6px;
  background: var(--el-text-color-secondary);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}
.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.message-bubble { display: flex; margin: 8px 0; }
.message-bubble.assistant { justify-content: flex-start; }
.bubble { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-break: break-word; }
.assistant-bubble { background: var(--el-fill-color); color: var(--el-text-color-primary); border-bottom-left-radius: 4px; }
.tool-calls { margin-bottom: 6px; display: flex; flex-wrap: wrap; }
.content :deep(pre) { background: var(--el-fill-color-darker); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 4px 0; }
.content :deep(code) { background: var(--el-fill-color-dark); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.content :deep(pre code) { background: none; padding: 0; }
</style>
```

- [ ] **Step 5: Create AiSidebar.vue**

```vue
<template>
  <div class="ai-sidebar" v-if="uiStore.aiSidebarOpen">
    <div class="sidebar-header">
      <div class="tabs">
        <button :class="{ active: tab === 'chat' }" @click="tab = 'chat'">🤖 AI</button>
      </div>
      <div class="header-actions">
        <el-button link size="small" @click="aiStore.clearMessages()" :disabled="aiStore.isStreaming">
          <el-icon><Delete /></el-icon>
        </el-button>
        <el-button link size="small" @click="uiStore.aiSidebarOpen = false">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </div>
    <div class="sidebar-body">
      <AiChatPanel v-if="tab === 'chat'" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useUiStore } from '@/store/ui.js'
import { useAiStore } from '@/store/ai.js'
import AiChatPanel from './AiChatPanel.vue'
import { Delete, Close } from '@element-plus/icons-vue'

const uiStore = useUiStore()
const aiStore = useAiStore()
const tab = ref('chat')
</script>

<style scoped>
.ai-sidebar {
  width: 360px;
  min-width: 360px;
  height: 100%;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .ai-sidebar {
    position: fixed;
    right: 0;
    top: 0;
    z-index: 200;
    width: 100%;
    max-width: 400px;
    box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  }
}

@media (max-width: 767px) {
  .ai-sidebar {
    max-width: 100%;
    width: 100%;
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.tabs { display: flex; gap: 4px; }
.tabs button {
  padding: 4px 12px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}
.tabs button.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.header-actions { display: flex; gap: 2px; }

.sidebar-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
```

- [ ] **Step 6: Commit**

```
git add mail-vue/src/components/ai-sidebar/
git commit -m "feat(ai): add AI sidebar Vue components (chat panel, messages, input, tool badges)"
```

---

## Task 9: Layout Integration

**Files:**
- Modify: `mail-vue/src/layout/index.vue`

- [ ] **Step 1: Add AI sidebar and toggle button to layout**

In `mail-vue/src/layout/index.vue`, add AiSidebar component import and the AI toggle button.

Update `<template>`:
```html
<template>
  <el-container class="layout">
    <el-aside
        class="aside"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'">
      <Aside />
    </el-aside>
    <div
        :class="(uiStore.asideShow && isMobile)? 'overlay-show':'overlay-hide'"
        @click="uiStore.asideShow = false"
    ></div>
    <el-container class="main-container">
      <el-main>
        <el-header>
            <Header />
        </el-header>
        <Main />
      </el-main>
    </el-container>
    <AiSidebar />
  </el-container>
  <writer ref="writerRef" />
  <MobileNav />
  <!-- AI toggle button -->
  <div
    v-if="settingStore.settings.aiEnabled"
    class="ai-fab"
    :class="{ 'ai-fab-hidden': uiStore.aiSidebarOpen }"
    @click="uiStore.aiSidebarOpen = true"
  >
    🤖
  </div>
</template>
```

Update `<script setup>`:
```js
import AiSidebar from '@/components/ai-sidebar/AiSidebar.vue'
import {useSettingStore} from "@/store/setting.js";

const settingStore = useSettingStore();
```

Add styles:
```css
.ai-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  z-index: 100;
  transition: all 0.2s;
}
.ai-fab:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.ai-fab-hidden { display: none; }

@media (max-width: 767px) {
  .ai-fab {
    bottom: calc(70px + env(safe-area-inset-bottom));
  }
}
```

- [ ] **Step 2: Ensure settings store carries aiEnabled**

In `mail-vue/src/store/setting.js`, confirm the `settings` default has `aiEnabled: 0`:
```js
settings: {
    r2Domain: '',
    loginOpacity: 1.00,
    resendEnabled: 1,
    sendEmailAvailable: false,
    aiEnabled: 0,
},
```

> The setting-api already returns `aiEnabled` from the DB. This just sets the default before the first fetch.

- [ ] **Step 3: Commit**

```
git add mail-vue/src/layout/index.vue mail-vue/src/store/setting.js
git commit -m "feat(ai): integrate AI sidebar into main layout with FAB toggle"
```

---

## Task 10: Verification

- [ ] **Step 1: Verify backend — run init to test migration**

Deploy or test locally. Hit the init endpoint to run migrations:
```
curl https://your-worker/init/{jwt_secret}
```
Expected: `success` — no errors about AI columns.

- [ ] **Step 2: Verify AI settings — save and query**

1. Open sys-setting page
2. Enable AI switch, enter API base URL, API key, model
3. Click save
4. Refresh page — settings should persist
5. Click "Test Connection" — should show success with model name

- [ ] **Step 3: Verify chat — send a message**

1. Click the 🤖 FAB button
2. AI sidebar opens on the right
3. Click a suggestion or type "Show my latest emails"
4. SSE stream should show tool call badge (list_emails) then AI response
5. Try "Summarize email #123" (use a real email ID)

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "feat(ai): complete Phase 1 — AI email assistant with chat, tools, and sidebar UI"
```
