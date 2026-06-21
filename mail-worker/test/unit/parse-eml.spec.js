import { describe, it, expect } from 'vitest';
import { parseEmailRaw } from '../../src/utils/eml-utils';

const EML = [
	'From: Alice <alice@example.com>',
	'To: bob@rttx.net',
	'Subject: =?UTF-8?B?5rWL6K+V?=',
	'Message-ID: <abc@example.com>',
	'Date: Wed, 1 Jan 2025 00:00:00 +0000',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset=UTF-8',
	'',
	'hello body'
].join('\r\n');

describe('parseEmailRaw', () => {
	it('解析发件/收件/主题(解码)/正文', async () => {
		const p = await parseEmailRaw(EML);
		expect(p.from.address).toBe('alice@example.com');
		expect(p.to[0].address).toBe('bob@rttx.net');
		expect(p.subject).toBe('测试');
		expect(p.text).toContain('hello body');
		expect(p.messageId).toBe('<abc@example.com>');
	});
});
