import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仓库惯例：切断 i18n -> hono/hono 导入副作用链
vi.mock('../../src/i18n/i18n', () => ({ t: () => '', default: {} }));
// 切断 perm-service / email-service 的导入副作用链
vi.mock('../../src/service/perm-service', () => ({ default: {} }));
vi.mock('../../src/service/email-service', () => ({ default: {} }));
// orm 用可观察链式 stub
vi.mock('../../src/entity/orm', () => ({ default: vi.fn() }));

import orm from '../../src/entity/orm';
import memberService from '../../src/service/member-service';
import BizError from '../../src/error/biz-error';

// 链式 stub（同 account-view.spec.js 款式），update 链可观察 set() 入参
function dbStub() {
	const updateChain = {
		set: vi.fn(() => updateChain),
		where: vi.fn(() => updateChain),
		run: vi.fn(async () => ({})),
	};
	const selectChain = {
		from: vi.fn(() => selectChain),
		where: vi.fn(() => selectChain),
		get: vi.fn(async () => undefined),
		all: vi.fn(async () => []),
	};
	return {
		select: vi.fn(() => selectChain),
		update: vi.fn(() => updateChain),
		_chains: { selectChain, updateChain },
	};
}

describe('memberService.setLastSendChoice', () => {
	beforeEach(() => vi.clearAllMocks());

	it('按 accountId+userId 更新两列，smtpAccountId 归一为数字', async () => {
		const stub = dbStub();
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		await memberService.setLastSendChoice({}, 20, 3, 'smtp', '7');

		expect(stub._chains.updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ lastSendMethod: 'smtp', lastSmtpAccountId: 7 })
		);
	});

	it('非 smtp 方式时 smtpAccountId 存 0', async () => {
		const stub = dbStub();
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		await memberService.setLastSendChoice({}, 20, 3, 'cloudflare', 7);

		expect(stub._chains.updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({ lastSendMethod: 'cloudflare', lastSmtpAccountId: 0 })
		);
	});

	it('非成员抛 BizError（assertMember 拦截）', async () => {
		vi.spyOn(memberService, 'isMember').mockResolvedValue(undefined);
		await expect(memberService.setLastSendChoice({}, 20, 999, 'smtp', 1)).rejects.toBeInstanceOf(BizError);
	});
});

describe('memberService.resolveSendChoice', () => {
	beforeEach(() => vi.clearAllMocks());

	it('成员行有记录时返回两字段', async () => {
		const stub = dbStub();
		orm.mockImplementation(() => stub);
		// resolveSendChoice 修复后复用 assertMember 的整行，不再二次查询：
		// 记录字段直接补在 isMember 返回的成员行上（断言不变）
		vi.spyOn(memberService, 'isMember').mockResolvedValue(
			{ memberId: 1, lastSendMethod: 'smtp', lastSmtpAccountId: 7 }
		);

		const r = await memberService.resolveSendChoice({}, 20, 3);

		expect(r).toEqual({ sendMethod: 'smtp', smtpAccountId: 7 });
	});

	it('从未发送过（空串）返回空串与 0', async () => {
		const stub = dbStub();
		stub._chains.selectChain.get.mockResolvedValue({ lastSendMethod: '', lastSmtpAccountId: 0 });
		orm.mockImplementation(() => stub);
		vi.spyOn(memberService, 'isMember').mockResolvedValue({ memberId: 1 });

		const r = await memberService.resolveSendChoice({}, 20, 3);

		expect(r).toEqual({ sendMethod: '', smtpAccountId: 0 });
	});
});
