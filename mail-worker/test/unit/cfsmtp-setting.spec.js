import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseMock = vi.fn();
const runMock = vi.fn().mockResolvedValue(undefined);

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual };
});

vi.mock('../../src/entity/orm', () => ({
	default: (c) => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					get: parseMock,
					all: vi.fn().mockResolvedValue([])
				}))
			}))
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({ run: runMock }))
			}))
		}))
	})
}));

// 切断 i18n.js 顶部 `import app from '../hono/hono'` 的导入副作用链（node 环境缺 hono 文件）
vi.mock('../../src/i18n/i18n', () => ({ t: (key) => key, default: {} }));

import settingService from '../../src/service/setting-service';

describe('cfSmtpTokens 设置解析', () => {
	beforeEach(() => {
		parseMock.mockReset();
	});

	it('字符串形式的 cfSmtpTokens 被解析为对象', () => {
		parseMock.mockReturnValue({ resendTokens: '{}', cfSmtpTokens: '{"a.com":{"user":"api_token","password":"tok"}}' });
		const row = settingService._parseSettingRow({ resendTokens: '{}', cfSmtpTokens: '{"a.com":{"user":"api_token","password":"tok"}}' });
		expect(row.cfSmtpTokens).toEqual({ 'a.com': { user: 'api_token', password: 'tok' } });
	});

	it('解析失败时回退为空对象', () => {
		const row = settingService._parseSettingRow({ resendTokens: '{}', cfSmtpTokens: '{bad json' });
		expect(row.cfSmtpTokens).toEqual({});
	});

	it('cfSmtpDomains 投影返回已配置域名数组', () => {
		parseMock.mockReturnValue({
			resendTokens: '{}',
			cfSmtpTokens: { 'a.com': { user: 'u', password: 'p' }, 'b.com': { user: 'u', password: 'p' } }
		});
		const row = settingService._parseSettingRow({
			resendTokens: '{}',
			cfSmtpTokens: { 'a.com': { user: 'u', password: 'p' }, 'b.com': { user: 'u', password: 'p' } }
		});
		expect(row.cfSmtpDomains.sort()).toEqual(['a.com', 'b.com']);
	});
});
