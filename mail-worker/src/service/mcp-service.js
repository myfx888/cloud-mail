import aiToolService from './ai-tool-service';
import aiProvider from './ai-provider';
import orm from '../entity/orm';
import email from '../entity/email';
import account from '../entity/account';
import { emailConst, isDel } from '../const/entity-const';
import { and, eq, desc } from 'drizzle-orm';
import emailService from './email-service';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'cloud-mail-mcp';
const SERVER_VERSION = '1.0.0';

// Extra MCP-only tools (beyond the shared AI tools)
const mcpExtraTools = [
	{
		name: 'list_accounts',
		description: 'List available email accounts for the current user.',
		inputSchema: { type: 'object', properties: {} },
		execute: async (params, ctx) => {
			const rows = await orm(ctx.c).select({
				accountId: account.accountId,
				email: account.email,
				name: account.name
			}).from(account)
				.where(and(eq(account.userId, ctx.userId), eq(account.isDel, isDel.NORMAL)))
				.all();
			return { accounts: rows };
		}
	},
	{
		name: 'send_reply',
		description: 'Send a reply to an email. This actually sends the email (not just a draft).',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The email ID to reply to' },
				body: { type: 'string', description: 'The reply body text' }
			},
			required: ['emailId', 'body']
		},
		execute: async (params, ctx) => {
			const original = await orm(ctx.c).select().from(email)
				.where(and(eq(email.emailId, params.emailId), eq(email.userId, ctx.userId), eq(email.isDel, isDel.NORMAL)))
				.get();
			if (!original) return { error: 'Original email not found' };

			let body = params.body;
			try { body = await aiProvider.verifyDraft(ctx.c, body); } catch (e) { /* skip */ }

			const sendParams = {
				accountId: original.accountId,
				sendType: 'reply',
				emailId: original.emailId,
				receiveEmail: [original.sendEmail],
				subject: original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject || ''}`,
				text: body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(body)}</div>`,
				cc: '',
				bcc: ''
			};

			try {
				const result = await emailService.send(ctx.c, sendParams, ctx.userId);
				return { sent: true, emailId: result[0]?.emailId };
			} catch (e) {
				return { error: e.message };
			}
		}
	},
	{
		name: 'send_email',
		description: 'Send a new email. This actually sends the email (not just a draft).',
		inputSchema: {
			type: 'object',
			properties: {
				to: { type: 'string', description: 'Recipient email address' },
				subject: { type: 'string', description: 'Email subject' },
				body: { type: 'string', description: 'Email body text' },
				accountId: { type: 'number', description: 'Sender account ID' }
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

			let body = params.body;
			try { body = await aiProvider.verifyDraft(ctx.c, body); } catch (e) { /* skip */ }

			const sendParams = {
				accountId: accountId,
				sendType: 'send',
				receiveEmail: [params.to],
				subject: params.subject,
				text: body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(body)}</div>`,
				cc: '',
				bcc: ''
			};

			try {
				const result = await emailService.send(ctx.c, sendParams, ctx.userId);
				return { sent: true, emailId: result[0]?.emailId };
			} catch (e) {
				return { error: e.message };
			}
		}
	},
	{
		name: 'update_draft',
		description: 'Update the content of an existing draft email.',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The draft email ID to update' },
				body: { type: 'string', description: 'New body text' },
				subject: { type: 'string', description: 'New subject (optional)' }
			},
			required: ['emailId', 'body']
		},
		execute: async (params, ctx) => {
			const row = await orm(ctx.c).select().from(email)
				.where(and(
					eq(email.emailId, params.emailId),
					eq(email.userId, ctx.userId),
					eq(email.status, emailConst.status.SAVING),
					eq(email.isDel, isDel.NORMAL)
				)).get();
			if (!row) return { error: 'Draft not found' };

			let body = params.body;
			try { body = await aiProvider.verifyDraft(ctx.c, body); } catch (e) { /* skip */ }

			const updates = {
				text: body,
				content: `<div style="white-space:pre-wrap">${escapeHtml(body)}</div>`
			};
			if (params.subject) updates.subject = params.subject;

			await orm(ctx.c).update(email).set(updates)
				.where(eq(email.emailId, params.emailId)).run();
			return { updated: true, emailId: params.emailId };
		}
	},
	{
		name: 'delete_email',
		description: 'Delete an email by marking it as deleted.',
		inputSchema: {
			type: 'object',
			properties: {
				emailId: { type: 'number', description: 'The email ID to delete' }
			},
			required: ['emailId']
		},
		execute: async (params, ctx) => {
			await orm(ctx.c).update(email).set({ isDel: isDel.DELETE })
				.where(and(
					eq(email.emailId, params.emailId),
					eq(email.userId, ctx.userId),
					eq(email.isDel, isDel.NORMAL)
				)).run();
			return { deleted: true, emailId: params.emailId };
		}
	}
];

function escapeHtml(text) {
	if (!text) return '';
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getAllMcpTools() {
	const aiTools = aiToolService.getToolDefinitions().map(t => ({
		name: t.function.name,
		description: t.function.description,
		inputSchema: t.function.parameters
	}));
	const extraTools = mcpExtraTools.map(t => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema
	}));
	return [...aiTools, ...extraTools];
}

async function executeToolCall(name, args, ctx) {
	const extraTool = mcpExtraTools.find(t => t.name === name);
	if (extraTool) {
		return await extraTool.execute(args, ctx);
	}
	return await aiToolService.executeTool(name, args, ctx);
}

function makeJsonRpcResponse(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function makeJsonRpcError(id, code, message) {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

const mcpService = {

	async handleRequest(c, userId, body) {
		const { jsonrpc, id, method, params } = body;

		if (jsonrpc !== '2.0') {
			return makeJsonRpcError(id, -32600, 'Invalid JSON-RPC version');
		}

		switch (method) {
			case 'initialize':
				return makeJsonRpcResponse(id, {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {
						tools: { listChanged: false }
					},
					serverInfo: {
						name: SERVER_NAME,
						version: SERVER_VERSION
					}
				});

			case 'notifications/initialized':
				return makeJsonRpcResponse(id, {});

			case 'tools/list':
				return makeJsonRpcResponse(id, {
					tools: getAllMcpTools()
				});

			case 'tools/call': {
				const toolName = params?.name;
				const toolArgs = params?.arguments || {};

				if (!toolName) {
					return makeJsonRpcError(id, -32602, 'Missing tool name');
				}

				const allTools = getAllMcpTools();
				if (!allTools.find(t => t.name === toolName)) {
					return makeJsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
				}

				const ctx = { c, userId };
				try {
					const result = await executeToolCall(toolName, toolArgs, ctx);
					return makeJsonRpcResponse(id, {
						content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
					});
				} catch (e) {
					return makeJsonRpcResponse(id, {
						content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
						isError: true
					});
				}
			}

			case 'ping':
				return makeJsonRpcResponse(id, {});

			default:
				return makeJsonRpcError(id, -32601, `Method not found: ${method}`);
		}
	}
};

export default mcpService;
