import { describe, it, expect, vi, beforeEach } from 'vitest';

const callApiMock = vi.hoisted(() => vi.fn());
const resolvePasswordMock = vi.hoisted(() => vi.fn().mockReturnValue('NewPass123!'));

vi.mock('../../src/service/setting-service', () => ({ default: { query: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../src/error/biz-error', () => ({ default: class BizError extends Error {} }));
// 切断 i18n.js 顶部 `import app from '../hono/hono'` 的导入副作用链（node 环境缺 hono 文件）；
// t 直接回显 key，便于断言错误信息里带原始错误细节。
vi.mock('../../src/i18n/i18n', () => ({ t: (key) => key, default: {} }));

import mailcowService from '../../src/service/mailcow-service';

describe('mailcowService.resetAccountPassword', () => {
	beforeEach(() => {
		callApiMock.mockReset();
		// resetAccountPassword 内部以 this.callApi 调用，直接替换
		mailcowService.callApi = callApiMock;
		mailcowService.resolvePassword = resolvePasswordMock;
	});

	it('调用 edit/mailbox 且 body 为 items+attr，成功返回新密码', async () => {
		callApiMock.mockResolvedValue([{ type: 'success' }]);
		const r = await mailcowService.resetAccountPassword({ env: {} }, 'a@hornmaritime.org', { id: 1 });
		expect(callApiMock).toHaveBeenCalledWith(
			{ env: {} }, 'edit/mailbox', 'POST',
			expect.objectContaining({ items: ['a@hornmaritime.org'], attr: expect.objectContaining({ password: 'NewPass123!', password2: 'NewPass123!' }) }),
			{ id: 1 }
		);
		expect(r.password).toBe('NewPass123!');
	});

	it('API 返回失败时抛错且不带密码细节', async () => {
		callApiMock.mockResolvedValue([{ type: 'danger', msg: 'quota exceeded' }]);
		await expect(mailcowService.resetAccountPassword({ env: {} }, 'a@x.com', { id: 1 }))
			.rejects.toThrow(/quota exceeded/);
	});

	it('空 body 响应按 mailbox 存在性兜底：存在即成功', async () => {
		callApiMock.mockImplementation((c, path) => {
			if (path === 'edit/mailbox') return Promise.resolve('');
			if (path.startsWith('get/mailbox/')) return Promise.resolve([{ username: 'a@x.com' }]);
			return Promise.resolve('');
		});
		mailcowService.accountExists = vi.fn().mockResolvedValue(true);
		const r = await mailcowService.resetAccountPassword({ env: {} }, 'a@x.com', { id: 1 });
		expect(r.password).toBe('NewPass123!');
	});
});
