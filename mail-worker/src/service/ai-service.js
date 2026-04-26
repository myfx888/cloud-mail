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

		const executeTool = async (name, args) => {
			const result = await aiToolService.executeTool(name, args, ctx);
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

		// First call: non-streaming to check for tool calls
		const firstResult = await aiProvider.chatCompletion(c, messages, { tools: toolDefs });
		const firstChoice = firstResult.choices?.[0];

		if (!firstChoice) {
			return { stream: null, toolCalls: [], content: '' };
		}

		// If no tool calls, re-do with streaming
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

			// Check if more tool calls needed
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
	},

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
			if (messages.length > 100) {
				messages = messages.slice(messages.length - 100);
			}
			await this.saveConversation(c, userId, conversationId, messages);
		} catch (e) {
			console.warn('Failed to log auto-draft:', e.message);
		}
	},

	async handleNewEmail(c, emailId, userId) {
		try {
			const settings = await settingService.query(c);
			if (!settings.aiEnabled || !settings.aiAutoDraft) {
				return { skipped: true, reason: 'AI or auto-draft disabled' };
			}
			if (!settings.aiBaseUrl || !settings.aiApiKey) {
				return { skipped: true, reason: 'AI not configured' };
			}

			const ctx = { c, userId };
			const emailData = await aiToolService.executeTool('get_email', { emailId }, ctx);
			if (emailData.error) {
				return { skipped: true, reason: emailData.error };
			}

			// Prompt injection check on email body
			const isInjection = await aiProvider.isPromptInjection(c, emailData.body);
			if (isInjection) {
				console.warn('Auto-draft skipped: prompt injection detected in email', emailId);
				await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
					'⚠️ 检测到可疑内容，已跳过自动草稿');
				return { skipped: true, reason: 'prompt_injection_detected' };
			}

			// Load thread context if available
			let threadContext = '';
			const threadData = await aiToolService.executeTool('get_thread', { emailId }, ctx);
			if (threadData.thread && threadData.thread.length > 1) {
				// Check thread for injection too
				const threadText = threadData.thread.map(e => e.body).join('\n---\n');
				const threadInjection = await aiProvider.isPromptInjection(c, threadText);
				if (threadInjection) {
					console.warn('Auto-draft skipped: prompt injection detected in thread for email', emailId);
					await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
						'⚠️ 会话历史中检测到可疑内容，已跳过自动草稿');
					return { skipped: true, reason: 'thread_injection_detected' };
				}
				threadContext = threadData.thread
					.filter(e => e.emailId !== emailId)
					.map(e => `From: ${e.from}\nDate: ${e.date}\n${e.body}`)
					.join('\n---\n');
			}

			const config = await aiProvider._getConfig(c);
			const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

			const messages = [
				{ role: 'system', content: systemPrompt },
				{ role: 'system', content: `You are auto-drafting a reply. Create a helpful, professional reply draft. Use draft_reply tool to save it.` }
			];

			if (threadContext) {
				messages.push({ role: 'system', content: `Thread history:\n${threadContext}` });
			}

			messages.push({
				role: 'user',
				content: `New email received:\nFrom: ${emailData.from} (${emailData.fromName})\nSubject: ${emailData.subject}\nDate: ${emailData.date}\n\n${emailData.body}\n\nPlease draft a reply using the draft_reply tool.`
			});

			const toolDefs = aiToolService.getToolDefinitions();
			const executeTool = async (name, args) => {
				return await aiToolService.executeTool(name, args, ctx);
			};

			const result = await aiProvider.callWithTools(c, messages, toolDefs, executeTool, { timeout: 60000 });
			const draftCall = result.toolCalls.find(tc => tc.name === 'draft_reply' && tc.status === 'done');
			await this._logAutoDraft(c, userId, emailData.from, emailData.subject,
				draftCall ? '已为该邮件创建回复草稿' : (result.content || '自动草稿生成完成'));
			return {
				skipped: false,
				draftId: draftCall?.result?.draftId || null,
				content: result.content
			};
		} catch (e) {
			console.error('Auto-draft failed for email', emailId, ':', e.message);
			await this._logAutoDraft(c, userId, 'unknown', '',
				`自动草稿生成失败: ${e.message}`).catch(() => {});
			return { skipped: true, reason: e.message };
		}
	}
};

export default aiService;
