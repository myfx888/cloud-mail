import { describe, it, expect } from 'vitest';
import mboxUtils from '../../src/utils/mbox-utils';

describe('mbox-utils', () => {
	it('appendEntry 加分隔符', () => {
		const out = mboxUtils.appendEntry('', 'Subject: a\r\n\r\nbody');
		expect(out.startsWith('\nFrom - cloud-mail\n')).toBe(true);
	});

	it('appendEntry 转义正文中的行首 From', () => {
		const out = mboxUtils.appendEntry('', 'From danger\r\nx');
		expect(out).toContain('\n>From danger');
	});

	it('splitNextBatch 切批并推进游标', () => {
		let mbox = mboxUtils.appendEntry('', 'Subject: 1\r\n\r\nbody1');
		mbox = mboxUtils.appendEntry(mbox, 'Subject: 2\r\n\r\nbody2');
		const r1 = mboxUtils.splitNextBatch(mbox, 0, 1);
		expect(r1.messages.length).toBe(1);
		expect(r1.messages[0]).toContain('Subject: 1');
		expect(r1.messages[0]).toContain('body1');
		expect(r1.done).toBe(false);
		const r2 = mboxUtils.splitNextBatch(mbox, r1.nextCursor, 10);
		expect(r2.messages.length).toBe(1);
		expect(r2.messages[0]).toContain('Subject: 2');
		expect(r2.done).toBe(true);
	});

	it('还原转义 >From -> From', () => {
		const mbox = mboxUtils.appendEntry('', 'From danger\r\nx');
		const r = mboxUtils.splitNextBatch(mbox, 0, 10);
		expect(r.messages[0]).toContain('From danger\r\nx');
	});

	it('countEntries 统计封数', () => {
		let mbox = mboxUtils.appendEntry('', 'a');
		mbox = mboxUtils.appendEntry(mbox, 'b');
		expect(mboxUtils.countEntries(mbox)).toBe(2);
	});

	it('标准 mbox（规范化 \\n 前缀）首封不丢失', () => {
		const raw = 'From sender Mon Jan 1\nSubject: 1\n\nbody1\nFrom sender Mon Jan 2\nSubject: 2\n\nbody2';
		const mbox = '\n' + raw;
		const r = mboxUtils.splitNextBatch(mbox, 0, 10);
		expect(r.messages.length).toBe(2);
		expect(r.messages[0]).toContain('Subject: 1');
		expect(r.messages[1]).toContain('Subject: 2');
	});

	it('findMessagesInBytes 切出邮件并推进字节游标（eof）', () => {
		let mbox = mboxUtils.appendEntry('', 'Subject: 1\n\nbody1');
		mbox = mboxUtils.appendEntry(mbox, 'Subject: 2\n\nbody2');
		const bytes = new TextEncoder().encode(mbox);
		const r = mboxUtils.findMessagesInBytes(bytes, 0, 10, true);
		expect(r.messages.length).toBe(2);
		expect(new TextDecoder().decode(r.messages[0])).toContain('Subject: 1');
		expect(new TextDecoder().decode(r.messages[1])).toContain('Subject: 2');
		expect(r.done).toBe(true);
	});

	it('findMessagesInBytes 非 eof 时最后一封留游标（跨块累积）', () => {
		let mbox = mboxUtils.appendEntry('', 'Subject: 1\n\nbody1');
		mbox = mboxUtils.appendEntry(mbox, 'Subject: 2\n\nbody2');
		const bytes = new TextEncoder().encode(mbox);
		const r = mboxUtils.findMessagesInBytes(bytes, 0, 10, false);
		expect(r.messages.length).toBe(1);
		expect(r.done).toBe(false);
		expect(r.nextCursor).toBeGreaterThan(0);
		const r2 = mboxUtils.findMessagesInBytes(bytes.slice(r.nextCursor), r.nextCursor, 10, true);
		expect(r2.messages.length).toBe(1);
		expect(new TextDecoder().decode(r2.messages[0])).toContain('Subject: 2');
	});
});
