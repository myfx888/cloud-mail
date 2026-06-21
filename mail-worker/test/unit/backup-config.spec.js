import { describe, it, expect } from 'vitest';
import { sanitizeUsers, sanitizeAccounts } from '../../src/utils/backup-utils';

describe('backup sanitize', () => {
	it('sanitizeUsers 清除敏感字段', () => {
		const out = sanitizeUsers([{ email: 'a@x', password: 'p', salt: 's', createIp: '1.2.3.4' }], false);
		expect(out[0].password).toBe('');
		expect(out[0].salt).toBe('');
		expect(out[0].createIp).toBe('');
		expect(out[0].email).toBe('a@x');
	});

	it('sanitizeUsers includeSecrets=true 保留', () => {
		const out = sanitizeUsers([{ email: 'a@x', password: 'p', salt: 's' }], true);
		expect(out[0].password).toBe('p');
	});

	it('sanitizeAccounts 清除 smtpPassword/smtpUser', () => {
		const out = sanitizeAccounts([{ email: 'a@x', smtpPassword: 'secret', smtpUser: 'u' }], false);
		expect(out[0].smtpPassword).toBe('');
		expect(out[0].smtpUser).toBe('');
	});
});
