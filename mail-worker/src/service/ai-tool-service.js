import emailService from './email-service';
import orm from '../entity/orm';
import email from '../entity/email';
import { emailConst, isDel } from '../const/entity-const';
import { and, eq, desc, like, or } from 'drizzle-orm';
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
