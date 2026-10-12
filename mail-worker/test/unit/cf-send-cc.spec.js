import { describe, it, expect, vi, beforeEach } from 'vitest';

const { emailMessageArgs } = vi.hoisted(() => ({ emailMessageArgs: [] }));

vi.mock('cloudflare:email', () => ({
	EmailMessage: class {
		constructor(from, to, raw) {
			this.from = from;
			this.to = to;
			this.raw = raw;
			emailMessageArgs.push(this);
		}
	}
}));

import cfSendService from '../../src/service/cf-send-service';

function buildContext() {
	return {
		env: {
			SEND_EMAIL: {
				send: vi.fn().mockResolvedValue(undefined)
			}
		}
	};
}

function buildEmailData(overrides = {}) {
	return {
		sendEmail: 'sender@example.com',
		name: 'Sender',
		recipient: [
			{ address: 'to1@example.com', name: '' },
			{ address: 'to2@example.com', name: '' }
		],
		cc: [{ address: 'cc1@example.com', name: '' }],
		bcc: [{ address: 'bcc1@example.com', name: '' }],
		subject: 'Test',
		text: 'hello',
		content: '<p>hello</p>',
		attachments: [],
		headers: {},
		...overrides
	};
}

describe('cf-send-service 多收件人投递', () => {

	beforeEach(() => {
		emailMessageArgs.length = 0;
	});

	it('收件人+抄送+密送逐个投递（CF只投递给信封收件人）', async () => {
		const c = buildContext();
		await cfSendService.send(c, buildEmailData());

		expect(c.env.SEND_EMAIL.send).toHaveBeenCalledTimes(4);
		const envelope = emailMessageArgs.map(m => m.to);
		expect(new Set(envelope)).toEqual(new Set([
			'to1@example.com', 'to2@example.com', 'cc1@example.com', 'bcc1@example.com'
		]));
		expect(emailMessageArgs.every(m => m.from === 'sender@example.com')).toBe(true);
	});

	it('MIME头包含To与Cc，但不包含Bcc头（防密送泄露）', async () => {
		const c = buildContext();
		await cfSendService.send(c, buildEmailData());

		const raw = emailMessageArgs[0].raw;
		expect(raw).toMatch(/^To:/m);
		expect(raw).toMatch(/^Cc:/m);
		expect(raw).not.toMatch(/^Bcc:/im);
	});

	it('收件人与抄送重复时去重，不重复投递', async () => {
		const c = buildContext();
		await cfSendService.send(c, buildEmailData({
			recipient: [{ address: 'to1@example.com', name: '' }],
			cc: [{ address: 'to1@example.com', name: '' }],
			bcc: []
		}));

		expect(c.env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
		expect(emailMessageArgs[0].to).toBe('to1@example.com');
	});

	it('所有信封收件人共享同一份raw（同一Message-ID，利于会话串联合并）', async () => {
		const c = buildContext();
		await cfSendService.send(c, buildEmailData());

		const raws = new Set(emailMessageArgs.map(m => m.raw));
		expect(raws.size).toBe(1);
	});

	it('部分收件人投递失败时抛错并指明失败地址', async () => {
		const c = buildContext();
		c.env.SEND_EMAIL.send.mockImplementation(async (message) => {
			if (message.to === 'to2@example.com') {
				throw new Error('destination not verified');
			}
		});

		await expect(cfSendService.send(c, buildEmailData())).rejects.toThrow(/to2@example\.com/);
	});
});
