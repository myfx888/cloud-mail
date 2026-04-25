import settingService from './setting-service';

const AI_TIMEOUT = 30000;
const MAX_TOOL_STEPS = 5;

const aiProvider = {

	async _getConfig(c) {
		const settings = await settingService.query(c);
		if (!settings.aiEnabled) {
			throw Object.assign(new Error('AI功能未启用'), { code: 400 });
		}
		if (!settings.aiBaseUrl || !settings.aiApiKey) {
			throw Object.assign(new Error('AI未配置（缺少API地址或密钥）'), { code: 400 });
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
				if (resp.status === 401) throw Object.assign(new Error('AI认证失败（API Key无效）'), { code: 401 });
				if (resp.status === 429) throw Object.assign(new Error('AI请求频率超限'), { code: 429 });
				if (resp.status === 404) throw Object.assign(new Error('AI模型不存在'), { code: 404 });
				throw Object.assign(new Error(`AI请求失败: ${resp.status} ${errBody.slice(0, 200)}`), { code: resp.status });
			}

			return await resp.json();
		} catch (e) {
			if (e.name === 'AbortError') throw Object.assign(new Error('AI请求超时'), { code: 408 });
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
			if (resp.status === 401) throw Object.assign(new Error('AI认证失败（API Key无效）'), { code: 401 });
			if (resp.status === 429) throw Object.assign(new Error('AI请求频率超限'), { code: 429 });
			throw Object.assign(new Error(`AI请求失败: ${resp.status} ${errBody.slice(0, 200)}`), { code: resp.status });
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
			throw new Error(`连接失败: ${resp.status} ${errBody.slice(0, 200)}`);
		}
		const data = await resp.json();
		return { success: true, model: data.model || config.model };
	}
};

export default aiProvider;
