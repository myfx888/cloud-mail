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
					// Pipe the SSE stream from upstream
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
					// Non-stream fallback
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
});

// Non-stream chat
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

// Quick AI reply — returns reply text for compose UI
app.post('/ai/quick-reply', async (c) => {
	const userId = userContext.getUserId(c);
	const { emailId } = await c.req.json();
	if (!emailId) return c.json(result.fail('emailId is required', 400));
	try {
		const data = await aiService.quickReply(c, userId, Number(emailId));
		return c.json(result.ok(data));
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

// Auto-draft trigger (internal use by email receive flow)
app.post('/ai/auto-draft', async (c) => {
	const userId = userContext.getUserId(c);
	const { emailId } = await c.req.json();
	if (!emailId) {
		return c.json(result.fail('emailId is required', 400));
	}
	try {
		const data = await aiService.handleNewEmail(c, Number(emailId), userId);
		return c.json(result.ok(data));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});

// Test AI connection (admin only)
app.post('/ai/test-connection', async (c) => {
	try {
		const data = await aiProvider.testConnection(c);
		return c.json(result.ok(data));
	} catch (e) {
		return c.json(result.fail(e.message, e.code || 500));
	}
});
