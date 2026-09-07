import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仓库惯例：切断 i18n 导入副作用链
vi.mock('../../src/i18n/i18n', () => ({
	t: () => '',
	default: {},
}));

// mock 登录上下文：主邮箱判定用
vi.mock('../../src/security/user-context', () => ({
	default: { getUser: vi.fn(() => ({ email: 'me@example.com' })) },
}));

// 切断 email-service -> worker-mailer -> cloudflare:sockets 的导入副作用链
vi.mock('../../src/service/email-service', () => ({
	default: {},
}));

// 切断 smtp-account-service -> smtp-service -> worker-mailer -> cloudflare:sockets 链
vi.mock('../../src/service/smtp-account-service', () => ({
	default: {},
}));

// userService 单测不触达真实实现，一并 mock（saveView 取用户邮箱用）
vi.mock('../../src/service/user-service', () => ({
	default: { selectById: vi.fn(async () => ({ email: 'me@example.com' })) },
}));

// 链式 drizzle stub：终结方法按调用队列返回
function dbStub({ selectAll = [] } = {}) {
	const selectChain = {
		from: vi.fn(() => selectChain),
		innerJoin: vi.fn(() => selectChain),
		where: vi.fn(() => selectChain),
		orderBy: vi.fn(() => selectChain),
		limit: vi.fn(() => selectChain),
		all: vi.fn(async () => selectAll),
		get: vi.fn(async () => undefined),
	};
	return {
		select: vi.fn(() => selectChain),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => ({})) })) })),
		insert: vi.fn(() => ({ values: vi.fn(async () => ({})) })),
		delete: vi.fn(() => ({ where: vi.fn(async () => ({})) })),
		_chains: { selectChain },
	};
}

vi.mock('../../src/entity/orm', () => ({ default: vi.fn() }));
import orm from '../../src/entity/orm';
import accountService from '../../src/service/account-service';

describe('accountService.list（全量化）', () => {
	beforeEach(() => vi.clearAllMocks());

	it('返回行展开 account 并附带 viewSort/viewGroup/memberCount', async () => {
		const stub = dbStub({
			selectAll: [
				{ account: { accountId: 2, email: 'a@example.com', sort: 5 }, viewSort: 7, viewGroup: 0, memberCount: 1 },
			],
		});
		orm.mockImplementation(() => stub);

		const list = await accountService.list({}, {}, 9);

		expect(list).toEqual([
			{ accountId: 2, email: 'a@example.com', sort: 5, viewSort: 7, viewGroup: 0, memberCount: 1 },
		]);
	});

	it('不再分页（不调用 limit），仍按排序查询', async () => {
		const stub = dbStub({ selectAll: [] });
		orm.mockImplementation(() => stub);

		await accountService.list({ lastSort: 5, size: 30, accountId: 3 }, {}, 9);

		expect(stub._chains.selectChain.limit).not.toHaveBeenCalled();
		expect(stub._chains.selectChain.orderBy).toHaveBeenCalled();
	});
});
