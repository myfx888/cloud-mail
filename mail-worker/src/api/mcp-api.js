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
