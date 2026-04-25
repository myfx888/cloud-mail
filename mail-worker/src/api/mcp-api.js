import app from '../hono/hono';
import result from '../model/result';
import mcpService from '../service/mcp-service';
import userContext from '../security/user-context';

// MCP JSON-RPC endpoint
app.post('/mcp', async (c) => {
	const userId = userContext.getUserId(c);
	try {
		const body = await c.req.json();

		// Handle batch requests
		if (Array.isArray(body)) {
			const responses = [];
			for (const req of body) {
				const resp = await mcpService.handleRequest(c, userId, req);
				if (resp) responses.push(resp);
			}
			return c.json(responses);
		}

		const response = await mcpService.handleRequest(c, userId, body);
		return c.json(response);
	} catch (e) {
		return c.json({
			jsonrpc: '2.0',
			id: null,
			error: { code: -32700, message: `Parse error: ${e.message}` }
		});
	}
});

// SSE transport for MCP (optional, for streaming clients)
app.get('/mcp/sse', async (c) => {
	const userId = userContext.getUserId(c);
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	// Send endpoint info
	const endpointUrl = new URL(c.req.url);
	endpointUrl.pathname = '/mcp';
	await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl.toString()}\n\n`));

	// Keep-alive ping every 30s
	const keepAlive = setInterval(async () => {
		try {
			await writer.write(encoder.encode(`: ping\n\n`));
		} catch {
			clearInterval(keepAlive);
		}
	}, 30000);

	// Close after 5 minutes
	setTimeout(async () => {
		clearInterval(keepAlive);
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
