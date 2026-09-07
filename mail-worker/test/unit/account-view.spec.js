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

// 更细的链式 stub：支持 insert().values().returning().get() 与可观察的 update/delete
function fullDbStub({ allQueue = [], getQueue = [], returningRow = {} } = {}) {
	const selectChain = {
		from: vi.fn(() => selectChain),
		innerJoin: vi.fn(() => selectChain),
		where: vi.fn(() => selectChain),
		orderBy: vi.fn(() => selectChain),
		all: vi.fn(async () => allQueue.length ? allQueue.shift() : []),
		get: vi.fn(async () => getQueue.length ? getQueue.shift() : undefined),
	};
	const updateChain = {
		set: vi.fn(() => updateChain),
		where: vi.fn(() => updateChain),
		run: vi.fn(async () => ({})),
	};
	const insertChain = {
		values: vi.fn(() => insertChain),
		returning: vi.fn(() => ({ get: vi.fn(async () => returningRow) })),
		run: vi.fn(async () => ({})),
	};
	const deleteChain = {
		where: vi.fn(() => deleteChain),
		run: vi.fn(async () => ({})),
	};
	return {
		select: vi.fn(() => selectChain),
		update: vi.fn(() => updateChain),
		insert: vi.fn(() => insertChain),
		delete: vi.fn(() => deleteChain),
		_chains: { selectChain, updateChain, insertChain, deleteChain },
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

describe('accountService.saveView', () => {
	beforeEach(() => vi.clearAllMocks());

	it('越权 accountId（非自己成员账户）整体拒绝', async () => {
		// 第一次 all = 成员批查（返回空 → 请求里的 accountId 99 越权）
		const stub = fullDbStub({ allQueue: [[]] });
		orm.mockImplementation(() => stub);

		await expect(accountService.saveView({}, {
			groups: [],
			items: [{ accountId: 99, viewGroup: 0, viewSort: 1 }],
		}, 9)).rejects.toThrow();
	});

	it('新建组（负数临时id）插入并按映射更新 items；主邮箱 item 被忽略', async () => {
		// all 队列：第1次=成员批查(含 12)，第2次=旧组列表(空)
		const stub = fullDbStub({
			allQueue: [[{ accountId: 12 }], []],
			returningRow: { groupId: 55 },
		});
		orm.mockImplementation(() => stub);
		// selectByEmailIncludeDel 走 select().get()：返回主邮箱行 accountId=1
		stub._chains.selectChain.get.mockResolvedValueOnce({ accountId: 1, email: 'me@example.com' });

		await accountService.saveView({}, {
			groups: [{ id: -1, name: '工作', sort: 1 }],
			items: [
				{ accountId: 12, viewGroup: -1, viewSort: 5 },
				{ accountId: 1, viewGroup: 0, viewSort: 9 }, // 主邮箱，应被过滤
			],
		}, 9);

		// 主邮箱不产生 member 更新 → update 仅因 item 12 调用一次
		expect(stub._chains.updateChain.set).toHaveBeenCalledTimes(1);
		// 新组插入一次
		expect(stub._chains.insertChain.values).toHaveBeenCalledTimes(1);
	});

	it('请求未携带的旧组被删除，其成员 view_group 回落 0', async () => {
		// items 为空 → 不触发成员批查；第一次 all = 旧组列表[11,22]
		const stub = fullDbStub({
			allQueue: [[{ groupId: 11, name: 'A', sort: 2 }, { groupId: 22, name: 'B', sort: 1 }]],
		});
		orm.mockImplementation(() => stub);
		stub._chains.selectChain.get.mockResolvedValueOnce({ accountId: 1, email: 'me@example.com' });

		await accountService.saveView({}, {
			groups: [{ id: 11, name: 'A', sort: 2 }], // 组22消失
			items: [],
		}, 9);

		// 回落未分组的 update（viewGroup:0）+ 组删除
		expect(stub._chains.updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ viewGroup: 0 }));
		expect(stub._chains.deleteChain.where).toHaveBeenCalled();
	});

	it('正常结束时返回该用户组列表', async () => {
		// 第1次 all = 旧组列表(空)，第2次 all = saveView 末尾读组列表
		const finalGroups = [{ groupId: 11, name: 'A', sort: 1 }];
		const stub = fullDbStub({ allQueue: [[], finalGroups] });
		orm.mockImplementation(() => stub);
		stub._chains.selectChain.get.mockResolvedValueOnce({ accountId: 1, email: 'me@example.com' });

		const result = await accountService.saveView({}, { groups: [], items: [] }, 9);
		expect(result).toEqual(finalGroups);
	});
});
