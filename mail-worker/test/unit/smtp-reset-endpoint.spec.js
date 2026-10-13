import { describe, it, expect, vi, beforeEach } from 'vitest';

const resetMock = vi.hoisted(() => vi.fn());
const findByServerMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const canAccessMock = vi.hoisted(() => vi.fn());
const getServerMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/service/mailcow-service', () => ({
	default: {
		getServerById: getServerMock,
		resetAccountPassword: resetMock,
		getSmtpConfig: vi.fn().mockResolvedValue({})
	}
}));
vi.mock('../../src/service/smtp-account-service', () => ({
	default: { findByMailcowServer: findByServerMock, update: updateMock }
}));
vi.mock('../../src/service/member-service', () => ({
	default: { canAccessAccount: canAccessMock }
}));

// 仓库惯例（同 account-view.spec.js）：
// 1) 切断 i18n -> hono/hono 的导入副作用链（node 环境缺 hono 运行时文件）；
// 2) 切断 email-service -> worker-mailer -> cloudflare:sockets 的导入副作用链。
// 均为模块加载需要，与本测试断言无关。
vi.mock('../../src/i18n/i18n', () => ({ t: (key) => key, default: {} }));
vi.mock('../../src/service/email-service', () => ({ default: {} }));

import accountService from '../../src/service/account-service';

describe('重置密码流程（服务层接线）', () => {
	beforeEach(() => {
		resetMock.mockReset().mockResolvedValue({ password: 'NewPass1!' });
		findByServerMock.mockReset().mockResolvedValue({ smtpAccountId: 7 });
		updateMock.mockClear();
		canAccessMock.mockReset().mockResolvedValue(true);
		getServerMock.mockReset().mockResolvedValue({ id: 'srv1', apiUrl: 'https://mc', apiKey: 'k' });
	});

	it('成功路径：重置后更新对应 smtp_account 行的 password', async () => {
		// 直接驱动 account-service 中抽出的可测函数（逻辑抽为 resetMailcowPasswordForAccount）
		const r = await accountService.resetMailcowPasswordForAccount(
			{ env: {} },
			{ accountId: 3, email: 'a@hornmaritime.org', mailcowServerId: 'srv1' }
		);
		expect(resetMock).toHaveBeenCalledWith({ env: {} }, 'a@hornmaritime.org', { id: 'srv1', apiUrl: 'https://mc', apiKey: 'k' });
		expect(updateMock).toHaveBeenCalledWith(expect.anything(), 7, 3, expect.objectContaining({ password: 'NewPass1!' }));
		expect(r).toEqual({ success: true });
	});

	it('mailcowServerId 为空：抛错且不调 API', async () => {
		await expect(accountService.resetMailcowPasswordForAccount(
			{ env: {} }, { accountId: 3, email: 'a@x.com', mailcowServerId: '' }
		)).rejects.toThrow();
		expect(resetMock).not.toHaveBeenCalled();
	});

	it('无对应 smtp_account 行：跳过本地更新仍成功', async () => {
		findByServerMock.mockResolvedValue(null);
		const r = await accountService.resetMailcowPasswordForAccount(
			{ env: {} }, { accountId: 3, email: 'a@hornmaritime.org', mailcowServerId: 'srv1' }
		);
		expect(updateMock).not.toHaveBeenCalled();
		expect(r).toEqual({ success: true });
	});
});
