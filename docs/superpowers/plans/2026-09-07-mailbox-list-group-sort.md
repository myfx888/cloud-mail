# 邮箱列表分组与拖动排序 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 邮箱列表支持用户级可折叠分组与拖动排序（主邮箱永远第一），删除改为"仅移出自己列表"。

**Architecture:** `account_member` 表扩展 `view_sort`/`view_group` 两列 + 新表 `account_group` 存用户级视图；后端 list 改全量、新增 `PUT /account/view` 整体保存与 `GET /account/groups`；前端引入 sortablejs 多容器拖动，乐观更新失败回滚。

**Tech Stack:** Cloudflare Workers + D1 + drizzle-orm（mail-worker，vitest node 单测）；Vue3 + Element Plus + sortablejs（mail-vue）。

**规格文档：** `docs/superpowers/specs/2026-09-07-mailbox-list-group-sort-design.md`

## Global Constraints

- 主邮箱判定：`account.email === 登录用户 email`（`userContext.getUser(c).email`），列表永远排第一，不存视图数据、不可拖、不可删。
- `view_sort` / 组 `sort`：数值越大越靠前；`view_group = 0` 表示未分组。
- 兼容性：旧数据全 `view_sort = 0` 时列表顺序必须与改造前一致（`account.sort DESC, accountId ASC` 兜底）。
- 前端 axios 拦截器已 resolve `data.data`，消费方**不要再取 `.data`**。
- i18n：zh.js 与 en.js 同步加 key；worker 侧文案走 `t()`。
- 单测命令：`cd mail-worker && npx vitest run --config vitest.unit.config.js`（node 环境，mock 模块风格，参考 `test/unit/member-service.spec.js`）。
- D1 迁移：本地 `npx wrangler d1 execute cloudmail --local --command "..."`；**远程迁移命令只在 Task 7 汇总，由用户择机执行**。
- 不动：allReceive 逻辑、回复身份选择、`/mailbox/:accountId/leave` 接口、admin 后台账户管理页。
- worker 的 `package.json` scripts 与部署流程不变；前端构建 `cd mail-vue && npm run build`。

---

### Task 1: DB 迁移（本地）+ entity 定义

**Files:**
- Modify: `mail-worker/src/entity/account-member.js`
- Create: `mail-worker/src/entity/account-group.js`

**Interfaces:**
- Produces: drizzle 实体 `accountGroup`（字段 `groupId/userId/name/sort`）、`accountMember` 新字段 `viewSort/viewGroup`，后续所有后端任务引用。

- [ ] **Step 1: 本地库执行迁移**

```bash
cd mail-worker
npx wrangler d1 execute cloudmail --local --command "ALTER TABLE account_member ADD COLUMN view_sort INTEGER NOT NULL DEFAULT 0"
npx wrangler d1 execute cloudmail --local --command "ALTER TABLE account_member ADD COLUMN view_group INTEGER NOT NULL DEFAULT 0"
npx wrangler d1 execute cloudmail --local --command "CREATE TABLE account_group (group_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)"
```

Expected: 每条输出 `Executed 1 query`（或本地库不存在的提示——若本地无库，先跑 `npx wrangler d1 execute cloudmail --local --command "SELECT 1"` 初始化再重试）。

- [ ] **Step 2: 验证迁移生效**

```bash
npx wrangler d1 execute cloudmail --local --command "SELECT view_sort, view_group FROM account_member LIMIT 1"
```

Expected: 查询成功（空表返回空结果也算通过）。

- [ ] **Step 3: 更新 account-member entity**

`mail-worker/src/entity/account-member.js` 的表定义追加两列（放在 `lastSigId` 之后、`createTime` 之前）：

```js
	viewSort: integer('view_sort').default(0).notNull(),
	viewGroup: integer('view_group').default(0).notNull(),
```

- [ ] **Step 4: 新建 account-group entity**

`mail-worker/src/entity/account-group.js`：

```js
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accountGroup = sqliteTable('account_group', {
	groupId: integer('group_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	sort: integer('sort').default(0).notNull()
});
export default accountGroup
```

- [ ] **Step 5: Commit**

```bash
git add mail-worker/src/entity/account-member.js mail-worker/src/entity/account-group.js
git commit -m "feat(account): 视图排序/分组数据模型——member扩展列+account_group表"
```

---

### Task 2: GET /account/list 全量化

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（`list` 函数，约 232-274 行）
- Test: `mail-worker/test/unit/account-view.spec.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `accountMember.viewSort/viewGroup`。
- Produces: `list(c, params, userId)` 返回全量数组，每行 `{...account, viewSort, viewGroup, memberCount}`；不再读取 `params.lastSort/size/accountId`。

- [ ] **Step 1: 写失败测试**

`mail-worker/test/unit/account-view.spec.js`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

```bash
cd mail-worker && npx vitest run --config vitest.unit.config.js test/unit/account-view.spec.js
```

Expected: FAIL（list 仍读 lastSort 走 limit 分支、返回行无 viewSort 字段）。

- [ ] **Step 3: 重写 list 函数**

`account-service.js` 中 `async list(c, params, userId) {...}` 整体替换为：

```js
	async list(c, params, userId) {

		// 主邮箱（account.email === 登录用户邮箱）永远排第一，视图排序也无法超越
		const isPrimary = sql`CASE WHEN ${account.email} = ${userContext.getUser(c).email} THEN 1 ELSE 0 END`;
		const memberCount = sql`(SELECT COUNT(*) FROM account_member am WHERE am.account_id = ${account.accountId})`;

		const rows = await orm(c).select({
				account: account,
				viewSort: accountMember.viewSort,
				viewGroup: accountMember.viewGroup,
				memberCount
			})
			.from(account)
			.innerJoin(accountMember, eq(accountMember.accountId, account.accountId))
			.where(
				and(
					eq(accountMember.userId, userId),
					eq(account.isDel, isDel.NORMAL)
				))
			.orderBy(desc(isPrimary), desc(accountMember.viewSort), desc(account.sort), asc(account.accountId))
			.all();
		return rows.map(row => ({
			...row.account,
			viewSort: row.viewSort,
			viewGroup: row.viewGroup,
			memberCount: Number(row.memberCount) || 0
		}));
	},
```

（保留函数上方原注释删除亦可；`accountMember`、`sql`、`desc/asc/and/eq` 均已在文件 import。）

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --config vitest.unit.config.js test/unit/account-view.spec.js
```

Expected: 2 个用例 PASS。

- [ ] **Step 5: 全量单测回归**

```bash
npx vitest run --config vitest.unit.config.js
```

Expected: 全部 PASS（list 改造未破坏其他单测）。

- [ ] **Step 6: Commit**

```bash
git add mail-worker/src/service/account-service.js mail-worker/test/unit/account-view.spec.js
git commit -m "feat(account): 邮箱列表接口全量化，附带用户级视图排序/分组字段"
```

---

### Task 3: GET /account/groups + PUT /account/view

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（新增 `listGroups`、`saveView` 函数）
- Modify: `mail-worker/src/api/account-api.js`（新增两条路由）
- Modify: `mail-worker/src/entity/account-group.js`（无改动则跳过——Task 1 已建）
- Test: `mail-worker/test/unit/account-view.spec.js`（追加用例）

**Interfaces:**
- Consumes: Task 1 实体、`userService.selectById`、`selectByEmailIncludeDel`。
- Produces:
  - `listGroups(c, userId)` → `[{groupId, userId, name, sort}]`（sort DESC）
  - `saveView(c, params, userId)` → 保存后的组列表（供前端回填真实组 id）
  - 路由：`GET /account/groups`、`PUT /account/view`

- [ ] **Step 1: 追加失败测试（saveView 分支逻辑）**

在 `account-view.spec.js` 顶部补充 mock（若 Task 2 已有则复用），并追加：

```js
// saveView 依赖 userService.selectById 取用户邮箱；memberService 不参与 saveView
vi.mock('../../src/service/user-service', () => ({
	default: { selectById: vi.fn(async () => ({ email: 'me@example.com' })) },
}));

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
		where: vi.fn(async () => ({})),
	};
	const insertChain = {
		values: vi.fn(() => insertChain),
		returning: vi.fn(() => ({ get: vi.fn(async () => returningRow) })),
		run: vi.fn(async () => ({})),
	};
	const deleteChain = { where: vi.fn(async () => ({})) };
	return {
		select: vi.fn(() => selectChain),
		update: vi.fn(() => updateChain),
		insert: vi.fn(() => insertChain),
		delete: vi.fn(() => deleteChain),
		_chains: { selectChain, updateChain, insertChain, deleteChain },
	};
}

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
		// all 队列：第1次=成员批查(空 items 不校验也行，直接给空)，第2次=旧组[11,22]
		const stub = fullDbStub({
			allQueue: [[], [{ groupId: 11, name: 'A', sort: 2 }, { groupId: 22, name: 'B', sort: 1 }]],
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
		const stub = fullDbStub({
			allQueue: [[], []],
			// 第3次 all 是 saveView 末尾读组列表
		});
		orm.mockImplementation(() => stub);
		stub._chains.selectChain.get.mockResolvedValueOnce({ accountId: 1, email: 'me@example.com' });
		const finalGroups = [{ groupId: 11, name: 'A', sort: 1 }];
		stub._chains.selectChain.all.mockResolvedValueOnce(finalGroups);

		const result = await accountService.saveView({}, { groups: [], items: [] }, 9);
		expect(result).toEqual(finalGroups);
	});
});
```

注意：`saveView` 内部读组列表的 `all` 排在队列之后——上面第4个用例通过 `mockResolvedValueOnce` 直接覆盖；第2、3个用例队列耗尽后默认返回 `[]`，不影响断言。

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --config vitest.unit.config.js test/unit/account-view.spec.js
```

Expected: 新增用例 FAIL（`saveView is not a function`）。

- [ ] **Step 3: 实现 listGroups / saveView**

`account-service.js` 顶部补充 import：

```js
import accountGroup from '../entity/account-group';
```

在 `list` 函数之后新增：

```js
	listGroups(c, userId) {
		return orm(c).select().from(accountGroup)
			.where(eq(accountGroup.userId, userId))
			.orderBy(desc(accountGroup.sort), desc(accountGroup.groupId))
			.all();
	},

	async saveView(c, params, userId) {

		let { groups = [], items = [] } = params;
		if (!Array.isArray(groups)) groups = [];
		if (!Array.isArray(items)) items = [];

		const user = await userService.selectById(c, userId);

		// 主邮箱不存视图数据：请求里携带也直接忽略
		const mainRow = this.selectByEmailIncludeDel(c, user?.email);
		const mainAccountId = mainRow?.accountId || 0;

		// 1. 越权校验：items 每个账户都必须是自己的成员账户，任一越权整体拒绝
		const accountIds = [...new Set(
			items.map(i => Number(i?.accountId)).filter(id => id && id !== mainAccountId)
		)];
		if (accountIds.length > 0) {
			const memberRows = await orm(c).select({ accountId: accountMember.accountId })
				.from(accountMember)
				.where(and(eq(accountMember.userId, userId), inArray(accountMember.accountId, accountIds)))
				.all();
			const memberSet = new Set(memberRows.map(r => r.accountId));
			for (const accountId of accountIds) {
				if (!memberSet.has(accountId)) throw new BizError(t('noUserAccount'));
			}
		}

		// 2. 组 upsert：正数=更新，非正数=新建（前端对新建组使用负数临时id）
		const oldGroups = await this.listGroups(c, userId);
		const keepIds = new Set();
		const tempIdMap = new Map(); // 前端负数临时id -> 真实group_id
		for (const g of groups) {
			const name = String(g?.name || '').trim().slice(0, 30);
			if (!name) continue;
			const gid = Number(g?.id) || 0;
			const sort = Number(g?.sort) || 0;
			if (gid > 0 && oldGroups.some(o => o.groupId === gid)) {
				keepIds.add(gid);
				await orm(c).update(accountGroup).set({ name, sort })
					.where(and(eq(accountGroup.groupId, gid), eq(accountGroup.userId, userId)))
					.run();
			} else {
				const row = await orm(c).insert(accountGroup)
					.values({ userId, name, sort }).returning().get();
				tempIdMap.set(gid, row.groupId);
			}
		}

		// 3. 请求未携带的旧组删除，组内成员回落未分组
		const removedIds = oldGroups.map(o => o.groupId).filter(id => !keepIds.has(id));
		if (removedIds.length > 0) {
			await orm(c).update(accountMember).set({ viewGroup: 0 })
				.where(and(eq(accountMember.userId, userId), inArray(accountMember.viewGroup, removedIds)))
				.run();
			await orm(c).delete(accountGroup)
				.where(and(eq(accountGroup.userId, userId), inArray(accountGroup.groupId, removedIds)))
				.run();
		}

		// 4. items 批量更新 member 行（负数 viewGroup 经映射换真实id，映射不到回落未分组）
		for (const item of items) {
			const accountId = Number(item?.accountId);
			if (!accountId || accountId === mainAccountId) continue;
			let viewGroup = Number(item?.viewGroup) || 0;
			if (viewGroup < 0) viewGroup = tempIdMap.get(viewGroup) || 0;
			await orm(c).update(accountMember)
				.set({ viewSort: Number(item?.viewSort) || 0, viewGroup })
				.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId)))
				.run();
		}

		return await this.listGroups(c, userId);
	},
```

- [ ] **Step 4: 新增路由**

`account-api.js`，放在 `app.get('/account/list', ...)` 之后：

```js
app.get('/account/groups', async (c) => {
	const list = await accountService.listGroups(c, userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.put('/account/view', async (c) => {
	const list = await accountService.saveView(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(list));
});
```

- [ ] **Step 5: 运行确认通过 + 回归**

```bash
npx vitest run --config vitest.unit.config.js
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add mail-worker/src/service/account-service.js mail-worker/src/api/account-api.js mail-worker/test/unit/account-view.spec.js
git commit -m "feat(account): 新增用户视图分组接口 GET /account/groups 与整体保存 PUT /account/view"
```

---

### Task 4: 删除新语义 + 移除 setAsTop

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（重写 `delete`；删除两个重复的 `setAsTop`）
- Modify: `mail-worker/src/api/account-api.js`（删除 `PUT /account/setAsTop` 路由）
- Test: `mail-worker/test/unit/account-view.spec.js`（追加用例）

**Interfaces:**
- Consumes: `memberService.assertMember`（mock 验证调用）。
- Produces: `DELETE /account/delete` 新行为——成员移出自己列表；无剩余成员时沿用原真删流程。

- [ ] **Step 1: 追加失败测试**

```js
describe('accountService.delete（仅移出自己）', () => {
	beforeEach(() => vi.clearAllMocks());

	function deleteMocks({ accountRow, memberCount }) {
		const stub = fullDbStub({ getQueue: [] });
		// select 链 get 队列：第1次 = selectById 账户行，第2次 = 剩余成员计数
		stub._chains.selectChain.get
			.mockResolvedValueOnce(accountRow)
			.mockResolvedValueOnce({ num: memberCount });
		orm.mockImplementation(() => stub);
		return stub;
	}

	it('删除主邮箱被拒绝', async () => {
		const stub = fullDbStub({});
		orm.mockImplementation(() => stub);
		// selectById 返回主邮箱（email 与登录用户一致）
		stub._chains.selectChain.get.mockResolvedValueOnce({ accountId: 1, email: 'me@example.com' });

		await expect(accountService.delete({}, { accountId: 1 }, 9)).rejects.toThrow();
		expect(stub._chains.deleteChain.where).not.toHaveBeenCalled();
	});

	it('普通成员删除只移除自己的 member 行，不真删', async () => {
		const stub = deleteMocks({ accountRow: { accountId: 5, email: 'a@example.com' }, memberCount: 2 });

		await accountService.delete({}, { accountId: 5 }, 9);

		expect(stub._chains.deleteChain.where).toHaveBeenCalledTimes(1); // 仅删 member 行
		expect(stub._chains.updateChain.set).not.toHaveBeenCalled();     // 不触发 isDel 更新
	});

	it('最后一个成员删除触发真删（isDel + 邮件/附件释放）', async () => {
		const stub = deleteMocks({ accountRow: { accountId: 5, email: 'a@example.com' }, memberCount: 0 });

		await accountService.delete({}, { accountId: 5 }, 9);

		expect(stub._chains.deleteChain.where).toHaveBeenCalledTimes(1);
		// account isDel 更新 + email 释放 + att 释放 = 3 次 update().set()
		expect(stub._chains.updateChain.set).toHaveBeenCalledTimes(3);
	});
});
```

同时确认文件顶部已有 `vi.mock('../../src/service/member-service', ...)`——**新增**（若尚未 mock）：

```js
vi.mock('../../src/service/member-service', () => ({
	default: {
		assertMember: vi.fn(async () => ({})),
		isMember: vi.fn(),
		isCreator: vi.fn(),
	},
}));
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --config vitest.unit.config.js test/unit/account-view.spec.js
```

Expected: 新增用例 FAIL（现 delete 走 assertCanManage/真删分支）。

- [ ] **Step 3: 重写 delete、删除 setAsTop**

`account-service.js` 中 `async delete(c, params, userId) {...}` 整体替换为：

```js
	async delete(c, params, userId) {

		let { accountId } = params;
		accountId = Number(accountId);

		if (!accountId) {
			throw new BizError(t('invalidParams'));
		}

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		// 新语义：删除 = 仅移出自己的列表，其他成员不受影响
		await memberService.assertMember(c, accountId, userId);
		await orm(c).delete(accountMember)
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId)))
			.run();

		// 已无剩余成员：沿用原真删流程（邮件/附件释放回 NOONE 可再认领）
		const { num } = await orm(c).select({ num: count() }).from(accountMember)
			.where(eq(accountMember.accountId, accountId)).get();
		if (Number(num) > 0) {
			return;
		}

		await orm(c).update(account).set({ isDel: isDel.DELETE }).where(
			eq(account.accountId, accountId))
			.run();

		try {
			await orm(c).update(email)
				.set({ userId: 0, accountId: 0, status: emailConst.status.NOONE })
				.where(eq(email.accountId, accountId))
				.run();

			await orm(c).update(att)
				.set({ userId: 0, accountId: 0 })
				.where(eq(att.accountId, accountId))
				.run();
		} catch (error) {
			console.error(`Failed to reset ownership for emails of account ${accountId}:`, error);
		}
	},
```

删除 service 中**两个** `async setAsTop(c, params, userId) {...}` 函数（约 449-467 行，注意两个重名函数全部删除）。

`account-api.js` 删除：

```js
app.put('/account/setAsTop', async (c) => {
	await accountService.setAsTop(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});
```

- [ ] **Step 4: 运行确认通过 + 回归**

```bash
npx vitest run --config vitest.unit.config.js
```

Expected: 全部 PASS。若 `email`/`att` 实体未 import（原实现已 import 则无需动）。

- [ ] **Step 5: Commit**

```bash
git add mail-worker/src/service/account-service.js mail-worker/src/api/account-api.js mail-worker/test/unit/account-view.spec.js
git commit -m "feat(account): 删除改为仅移出自己列表，最后成员删除才真删；移除setAsTop及重复函数"
```

---

### Task 5: 前端封装 + 一次性加载 + 分组渲染

**Files:**
- Modify: `mail-vue/src/request/account.js`
- Modify: `mail-vue/src/layout/account/index.vue`（大改：列表结构 + 加载逻辑 + 菜单）
- Modify: `mail-vue/src/i18n/zh.js`、`mail-vue/src/i18n/en.js`（新增 `ungrouped` key）

**Interfaces:**
- Consumes: Task 2/3 后端接口（拦截器已解包 `data.data`）。
- Produces（Task 6 依赖的组件内部结构）:
  - `const view = reactive({ main: null, groups: [], ungrouped: [] })`，groups 元素 `{ id, name, sort, collapsed, accounts: [] }`
  - `const groupsRef = ref(null)`（组容器 DOM，Task 6 sortable 挂载点）
  - `function loadAll()`（全量刷新视图）、`function cardClick(item)`（点击切换账户，Task 6 加拖动抑制）
  - 组内容容器 class：`account-drag-area` + `:data-group-id`；卡片自带 `:data-account-id`

- [ ] **Step 1: 更新 request 封装**

`mail-vue/src/request/account.js`：`accountList` 改参并新增两个函数，删除 `accountSetAsTop`：

```js
export function accountList() {
    return http.get('/account/list');
}

export function accountGroups() {
    return http.get('/account/groups');
}

export function accountSaveView(data) {
    return http.put('/account/view', data);
}
```

（删除原 `accountSetAsTop`；`accountDelete` 不变。）

- [ ] **Step 2: i18n 加 key**

`zh.js` 中找到 `pin: '置顶'` 所在对象段落，同段追加：

```js
    ungrouped: '未分组',
```

`en.js` 中 `pin` 对应段落追加：

```js
    ungrouped: 'Ungrouped',
```

- [ ] **Step 3: 重构列表组件**

`mail-vue/src/layout/account/index.vue`。以下为模板中 `<el-scrollbar>` 内部的**替换结构**（原无限滚动 + 骨架屏分页部分整体删除）：

```html
    <el-scrollbar class="scrollbar" ref="scrollbarRef">
      <div class="list-wrap" v-loading="loading">
        <!-- 主邮箱：固定第一，不可拖、无下拉设置 -->
        <el-card v-if="view.main" class="item main-item" :class="itemBg(view.main.accountId)"
                 :key="'main-' + view.main.accountId" @click="cardClick(view.main)">
          <div class="account">{{ view.main.email }}</div>
          <div class="opt">
            <div class="send-email" @click.stop>
              <Icon @click="setAllReceive(view.main)" v-if="!view.main.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
              <Icon @click="setAllReceive(view.main)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
            </div>
            <div class="settings" @click.stop>
              <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(view.main)" style="cursor:pointer"/>
              <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(view.main.email)"/>
              <el-dropdown v-if="!showNullSetting(view.main)" @visible-change="onDropdownToggle">
                <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(view.main)">{{ $t('rename') }}</el-dropdown-item>
                    <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(view.main)">{{ $t('smtpSetting') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <Icon v-else icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
            </div>
          </div>
        </el-card>

        <!-- 自定义分组：组间可拖动（Task 6），组头可折叠 -->
        <div class="group-list" ref="groupsRef">
          <div class="group" v-for="group in view.groups" :key="group.id">
            <div class="group-head">
              <Icon class="fold" :icon="group.collapsed ? 'mingcute:right-line' : 'mingcute:down-line'"
                    width="16" height="16" @click="toggleCollapse(group)"/>
              <span class="group-name" @click="toggleCollapse(group)">{{ group.name }}</span>
            </div>
            <div class="group-body account-drag-area" v-show="!group.collapsed" :data-group-id="group.id">
              <el-card v-for="item in group.accounts" :key="item.accountId"
                       class="item" :class="itemBg(item.accountId)"
                       :data-account-id="item.accountId"
                       @click="cardClick(item)">
                <div class="account">{{ item.email }}</div>
                <div class="opt">
                  <div class="send-email" @click.stop>
                    <Icon @click="setAllReceive(item)" v-if="!item.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
                    <Icon @click="setAllReceive(item)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
                  </div>
                  <div class="settings" @click.stop>
                    <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(item)" style="cursor:pointer"/>
                    <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(item.email)"/>
                    <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399" v-if="showNullSetting(item)"/>
                    <el-dropdown v-else>
                      <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(item)">{{ $t('rename') }}</el-dropdown-item>
                          <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId" @click="remove(item)">{{ $t('delete') }}</el-dropdown-item>
                          <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(item)">{{ $t('smtpSetting') }}</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </div>

        <!-- 未分组 -->
        <template v-if="view.ungrouped.length > 0">
          <div class="group-head ungrouped-head">
            <span class="group-name">{{ $t('ungrouped') }}</span>
          </div>
          <div class="ungrouped-body account-drag-area" :data-group-id="0">
            <el-card v-for="item in view.ungrouped" :key="item.accountId"
                     class="item" :class="itemBg(item.accountId)"
                     :data-account-id="item.accountId"
                     @click="cardClick(item)">
              <div class="account">{{ item.email }}</div>
              <div class="opt">
                <div class="send-email" @click.stop>
                  <Icon @click="setAllReceive(item)" v-if="!item.allReceive" icon="eva:email-fill" width="22" height="22" color="#fccb1a"/>
                  <Icon @click="setAllReceive(item)" v-else icon="flat-color-icons:folder" width="22" height="22" color="#23c4f1" />
                </div>
                <div class="settings" @click.stop>
                  <Icon icon="mdi:signature-freehand" width="22" height="22" color="#67C23A" @click.stop="openSignatureManager(item)" style="cursor:pointer"/>
                  <Icon icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(item.email)"/>
                  <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399" v-if="showNullSetting(item)"/>
                  <el-dropdown v-else>
                    <Icon icon="fluent:settings-24-filled" width="21" height="21" color="#909399"/>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(item)">{{ $t('rename') }}</el-dropdown-item>
                        <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId" @click="remove(item)">{{ $t('delete') }}</el-dropdown-item>
                        <el-dropdown-item v-if="hasPerm('smtp:set')" @click="openSmtpManager(item)">{{ $t('smtpSetting') }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-card>
          </div>
        </template>

        <div class="empty" v-if="!loading && accounts.length === 0">
          <el-empty :description="$t('noMessagesFound')"/>
        </div>
      </div>
    </el-scrollbar>
```

script 部分改动（保留原有弹窗/turnstile/签名/SMTP 逻辑不动）：

1. **删除**：`v-infinite-scroll` 相关、`getAccountList`、`getSkeletonRows`、`skeletonRows`、`followLoading`、`noLoading`、`queryParams`、`first`、`setAsTop` 函数及其 import（`accountSetAsTop`）。
2. **新增状态与视图构建**：

```js
import { accountList, accountAdd, accountDelete, accountSetName, accountSetAllReceive, accountGroups } from "@/request/account.js";

const accounts = ref([])
const groupsMeta = ref([])          // 服务端组定义
const view = reactive({ main: null, groups: [], ungrouped: [] })
const groupsRef = ref(null)
const loading = ref(false)
const collapsedMap = reactive(JSON.parse(localStorage.getItem('account-group-collapsed') || '{}'))

const isMobile = () => window.innerWidth < 768

async function loadAll() {
  loading.value = true
  try {
    const [list, groups] = await Promise.all([accountList(), accountGroups()])
    accounts.value = list
    groupsMeta.value = groups
    buildView()
    accountStore.setAccounts([...accounts.value])
    if (!accountStore.currentAccountId && accounts.value.length > 0) {
      changeAccount(accounts.value[0])
    }
  } finally {
    loading.value = false
  }
}

function buildView() {
  const mainId = userStore.user?.account?.accountId
  view.main = accounts.value.find(a => a.accountId === mainId) || null
  const rest = accounts.value.filter(a => a.accountId !== mainId)
  view.groups = groupsMeta.value.map(g => ({
    id: g.groupId,
    name: g.name,
    sort: g.sort,
    collapsed: !!collapsedMap[g.groupId],
    accounts: rest.filter(a => (a.viewGroup || 0) === g.groupId)
  }))
  const groupedIds = new Set(view.groups.flatMap(g => g.accounts.map(a => a.accountId)))
  view.ungrouped = rest.filter(a => !groupedIds.has(a.accountId))
}
```

3. **刷新入口改造**（原 `refresh()` 与两个 watch）：

```js
function refresh() {
  loadAll()
}

watch(() => accountStore.accountListUpdated, () => { loadAll() })

if (hasPerm('account:query')) {
  loadAll()
}
```

（原 `watch(() => accountStore.changeUserAccountName, ...)` 保留，改为 `if (view.main) view.main.name = accountStore.changeUserAccountName`。）

4. **`remove` 改为删除后重载**（弹窗文案 Task 6 再换新 key，本任务沿用现有 `delConfirm`）：

```js
async function remove(account) {
  await ElMessageBox.confirm(t('delConfirm', {msg: account.email}), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  })
  await accountDelete(account.accountId)
  ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true })
  await loadAll()
}
```

5. **`cardClick`**（本任务直接转发，Task 6 加拖动抑制）：

```js
function cardClick(item) {
  changeAccount(item)
}
```

6. **`showNullSetting` 简化**（delete 不再要求 `account:delete`）：

```js
function showNullSetting(item) {
  return !hasPerm('email:send') && !hasPerm('smtp:set')
}
```

7. **style 增量**（`<style scoped lang="scss">` 内 `.account-box` 下追加）：

```scss
  .group-list { padding: 0 10px; }
  .group { margin-top: 6px; }
  .group-head {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 4px; cursor: pointer; user-select: none;
    .group-name { font-weight: 600; font-size: 13px; color: var(--secondary-text-color); }
    .fold { flex-shrink: 0; }
  }
  .ungrouped-head { margin: 6px 14px 0; cursor: default; }
  .main-item { border: 1px solid var(--el-color-primary-light-5); }
```

- [ ] **Step 4: 本地验证**

```bash
cd mail-vue && npm run dev
```

Expected: 列表一次性加载；主邮箱第一；未分组邮箱在"未分组"段；切换账户、复制、allReceive、重命名、删除、签名/SMTP 入口全部正常；无 `accountSetAsTop` 引用残留（`grep -n "accountSetAsTop\|setAsTop" mail-vue/src -r` 无结果）。

- [ ] **Step 5: Commit**

```bash
git add mail-vue/src/request/account.js mail-vue/src/layout/account/index.vue mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(mailbox): 邮箱面板一次性加载+分组渲染骨架，移除置顶与分页"
```

---

### Task 6: sortablejs 拖动 + 视图保存 + 组管理 + 删除文案

**Files:**
- Modify: `mail-vue/package.json`（新增依赖 `sortablejs`）
- Modify: `mail-vue/src/layout/account/index.vue`
- Modify: `mail-vue/src/i18n/zh.js`、`mail-vue/src/i18n/en.js`

**Interfaces:**
- Consumes: Task 5 的 `view/groupsRef/loadAll/cardClick/account-drag-area` 结构、Task 3 的 `PUT /account/view`（返回保存后的组列表）。

- [ ] **Step 1: 安装依赖**

```bash
cd mail-vue && npm install sortablejs
```

Expected: `package.json` dependencies 出现 `"sortablejs": "^1.x"`。

- [ ] **Step 2: i18n 追加 key**

（实现决策说明：spec 5.4 原拟"还有其他成员/最后成员"两种弹窗文案；实现统一为一条同时说明两种后果的文案，前端无需预知成员数，信息等价。）

`zh.js`（与 Task 5 同段）：

```js
    newGroup: '新建分组',
    groupName: '组名',
    renameGroup: '重命名分组',
    deleteGroupConfirm: '删除分组后，组内邮箱将移至“未分组”，确认删除？',
    removeAccountConfirm: '确认删除 {msg} ？删除后该邮箱将从你的列表移除；若你是最后一个成员，邮箱将被彻底删除。',
    saveViewFailMsg: '排序保存失败',
```

`en.js`：

```js
    newGroup: 'New Group',
    groupName: 'Group name',
    renameGroup: 'Rename Group',
    deleteGroupConfirm: 'Mailboxes in this group will move to "Ungrouped". Delete this group?',
    removeAccountConfirm: 'Delete {msg}? It will be removed from your list. If you are the last member, the mailbox will be permanently deleted.',
    saveViewFailMsg: 'Failed to save ordering',
```

- [ ] **Step 3: 模板增量**

1. `head-opt` 里"+"按钮后追加"新建分组"图标：

```html
      <Icon class="icon group-add" icon="ion:folder-open-outline" width="20" height="20" :title="$t('newGroup')" @click="openGroupDialog(null)"/>
```

2. `group-head` 内 `group-name` 后追加组操作（Task 5 的组头结构补全）：

```html
              <span class="group-opt" @click.stop>
                <Icon icon="fluent:edit-24-regular" width="14" height="14" @click.stop="openGroupDialog(group)"/>
                <Icon icon="fluent:delete-24-regular" width="14" height="14" @click.stop="removeGroup(group)"/>
              </span>
```

3. 组件模板尾部（`signatureManager` 旁）追加组弹窗：

```html
  <el-dialog v-model="groupDialogShow" :title="groupEditTarget ? $t('renameGroup') : $t('newGroup')" width="400px">
    <el-input v-model="groupNameInput" :placeholder="$t('groupName')" maxlength="30" autocomplete="off"/>
    <template #footer>
      <el-button @click="groupDialogShow = false">{{ $t('cancel') }}</el-button>
      <el-button type="primary" @click="saveGroupDialog">{{ $t('confirm') }}</el-button>
    </template>
  </el-dialog>
```

4. 未分组段的 `el-card` 内部结构已在 Task 5 复制完整（此处无需改动）。

- [ ] **Step 4: script 增量**

import 区：

```js
import Sortable from 'sortablejs';
import { accountList, accountAdd, accountDelete, accountSetName, accountSetAllReceive, accountGroups, accountSaveView } from "@/request/account.js";
```

状态与拖动逻辑（追加到 Task 5 代码之后）：

```js
let nextTempGroupId = -1
let accountSortables = []
let groupSortable = null
let justDragged = false
const groupDialogShow = ref(false)
const groupNameInput = ref('')
const groupEditTarget = ref(null)

// ===== 视图保存（乐观更新 + 失败回滚） =====
function buildViewPayload() {
  return {
    groups: view.groups.map((g, idx) => ({ id: g.id, name: g.name, sort: view.groups.length - idx })),
    items: [
      ...view.groups.flatMap(g => g.accounts.map((a, idx) => ({ accountId: a.accountId, viewGroup: g.id, viewSort: g.accounts.length - idx }))),
      ...view.ungrouped.map((a, idx) => ({ accountId: a.accountId, viewGroup: 0, viewSort: view.ungrouped.length - idx }))
    ]
  }
}

function snapshotView() {
  return JSON.stringify({ groups: view.groups, ungrouped: view.ungrouped })
}

function restoreView(snapshot) {
  const s = JSON.parse(snapshot)
  view.groups = s.groups
  view.ungrouped = s.ungrouped
}

function syncGroupIds(serverGroups) {
  // 后端按提交顺序返回（sort DESC == 提交时数组顺序），按下标回填真实 id
  view.groups.forEach((g, idx) => {
    const sg = serverGroups[idx]
    if (!sg) return
    if (sg.groupId !== g.id) {
      if (collapsedMap[g.id] !== undefined) {
        collapsedMap[sg.groupId] = collapsedMap[g.id]
        delete collapsedMap[g.id]
      }
      g.id = sg.groupId
    }
    g.sort = sg.sort
  })
  localStorage.setItem('account-group-collapsed', JSON.stringify(collapsedMap))
}

async function persistView() {
  const snapshot = snapshotView()
  try {
    const serverGroups = await accountSaveView(buildViewPayload())
    syncGroupIds(serverGroups || [])
  } catch (e) {
    restoreView(snapshot)
    ElMessage({ message: t('saveViewFailMsg'), type: 'error', plain: true })
  } finally {
    nextTick(initSortables)
  }
}

// ===== 组管理 =====
function openGroupDialog(group) {
  groupEditTarget.value = group
  groupNameInput.value = group ? group.name : ''
  groupDialogShow.value = true
}

async function saveGroupDialog() {
  const name = groupNameInput.value.trim()
  if (!name) return
  if (groupEditTarget.value) {
    groupEditTarget.value.name = name
  } else {
    view.groups.push({ id: nextTempGroupId--, name, sort: 0, collapsed: false, accounts: [] })
  }
  groupDialogShow.value = false
  await persistView()
}

function removeGroup(group) {
  ElMessageBox.confirm(t('deleteGroupConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    view.ungrouped.push(...group.accounts)
    view.groups.splice(view.groups.indexOf(group), 1)
    await persistView()
  })
}

function toggleCollapse(group) {
  group.collapsed = !group.collapsed
  if (group.id > 0) {
    collapsedMap[group.id] = group.collapsed
    localStorage.setItem('account-group-collapsed', JSON.stringify(collapsedMap))
  }
}

// ===== 拖动（sortablejs 多容器） =====
function destroySortables() {
  accountSortables.forEach(s => s.destroy())
  accountSortables = []
  if (groupSortable) { groupSortable.destroy(); groupSortable = null }
}

function initSortables() {
  destroySortables()
  if (groupsRef.value) {
    groupSortable = new Sortable(groupsRef.value, {
      group: 'groups', handle: '.group-head', animation: 150,
      onEnd: onGroupDrop
    })
  }
  document.querySelectorAll('.account-drag-area').forEach(el => {
    accountSortables.push(new Sortable(el, {
      group: 'accounts', animation: 150,
      delay: isMobile() ? 200 : 0, delayOnTouchOnly: true,
      onEnd: onAccountDrop
    }))
  })
}

// sortable 已物理移动 DOM，先还原再改响应式数据，避免与 Vue patch 冲突
function revertDom(evt) {
  const { item, from, oldIndex } = evt
  if (from.children[oldIndex] === item) return
  from.insertBefore(item, from.children[oldIndex] || null)
}

function listByGroupId(groupId) {
  if (Number(groupId) === 0) return view.ungrouped
  return view.groups.find(g => g.id === Number(groupId))?.accounts
}

function onAccountDrop(evt) {
  revertDom(evt)
  justDragged = true
  setTimeout(() => { justDragged = false }, 300)
  const { from, to, oldIndex, newIndex } = evt
  const accountId = Number(evt.item.dataset.accountId)
  const fromList = listByGroupId(from.dataset.groupId)
  const toList = listByGroupId(to.dataset.groupId)
  if (!fromList || !toList) return
  const [acc] = fromList.splice(fromList.findIndex(a => a.accountId === accountId), 1)
  toList.splice(newIndex, 0, acc)
  persistView()
}

function onGroupDrop(evt) {
  revertDom(evt)
  justDragged = true
  setTimeout(() => { justDragged = false }, 300)
  const { oldIndex, newIndex } = evt
  if (oldIndex === newIndex) return
  const [g] = view.groups.splice(oldIndex, 1)
  view.groups.splice(newIndex, 0, g)
  persistView()
}
```

改造 Task 5 的 `cardClick` 与 `loadAll`：

```js
function cardClick(item) {
  if (justDragged) return
  changeAccount(item)
}

async function loadAll() {
  loading.value = true
  try {
    const [list, groups] = await Promise.all([accountList(), accountGroups()])
    accounts.value = list
    groupsMeta.value = groups
    buildView()
    accountStore.setAccounts([...accounts.value])
    if (!accountStore.currentAccountId && accounts.value.length > 0) {
      changeAccount(accounts.value[0])
    }
    await nextTick()
    initSortables()
  } finally {
    loading.value = false
  }
}
```

删除确认换新文案（替换 Task 5 的 `remove` 中 `delConfirm` 一行）：

```js
  await ElMessageBox.confirm(t('removeAccountConfirm', {msg: account.email}), {
```

`onMounted`（若无则新增）：

```js
onMounted(() => { nextTick(initSortables) })
```

（`nextTick`、`onMounted` 已在 vue import 中则复用，缺则补。）

- [ ] **Step 5: 本地验证**

```bash
cd mail-vue && npm run dev
```

验收点：
1. 组内拖动排序 → 刷新页面顺序保持；组间拖邮箱 → 落入对应组；组头拖动 → 组顺序变化。
2. 新建分组 → 出现空组；拖邮箱入新组；重命名、删除组（组员回落"未分组"）。
3. 折叠组 → 刷新后仍折叠；折叠组不可拖入。
4. 断网拖动 → 弹"排序保存失败"且列表还原。
5. 拖放不触发卡片选中（点击仍可切换账户）。
6. 手机宽度（<768）下长按 200ms 触发拖动。

- [ ] **Step 6: Commit**

```bash
git add mail-vue/package.json mail-vue/package-lock.json mail-vue/src/layout/account/index.vue mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(mailbox): sortablejs分组拖动排序+视图整体保存+组管理与删除新文案"
```

---

### Task 7: 构建验证 + 远程迁移清单（部署准备）

**Files:** 无代码改动（验证任务）

- [ ] **Step 1: 前端构建**

```bash
cd mail-vue && npm run build
```

Expected: 构建成功无报错。

- [ ] **Step 2: worker 全量单测回归**

```bash
cd ../mail-worker && npx vitest run --config vitest.unit.config.js
```

Expected: 全部 PASS。

- [ ] **Step 3: 输出远程迁移命令（交由用户择机执行，部署 worker 前必须先跑）**

```bash
cd mail-worker
npx wrangler d1 execute cloudmail --remote --command "ALTER TABLE account_member ADD COLUMN view_sort INTEGER NOT NULL DEFAULT 0"
npx wrangler d1 execute cloudmail --remote --command "ALTER TABLE account_member ADD COLUMN view_group INTEGER NOT NULL DEFAULT 0"
npx wrangler d1 execute cloudmail --remote --command "CREATE TABLE account_group (group_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)"
```

提醒用户：远程迁移在前、`wrangler deploy` 在后（沿用既有部署流程，用户手动执行）。

- [ ] **Step 4: Commit（若有残余改动则提交，否则跳过）**

---

## 手工验收清单（实现完成后逐项勾选）

- [ ] 主邮箱永远第一，无下拉删除项，不可拖动
- [ ] 组内/跨组/组间拖动均生效且刷新后保持
- [ ] 折叠状态刷新保持；折叠组不可作为拖入目标
- [ ] 旧用户（无视图数据）初始顺序与改造前一致
- [ ] 普通成员删除共享邮箱：自己列表消失、其他成员无感
- [ ] 最后一个成员删除：邮箱彻底消失、邮件可在重建同地址时被认领
- [ ] 保存失败（断网）回滚并提示
- [ ] 写信页发件人选择正常（全量账户）
- [ ] 移动端长按拖动正常、与列表滚动不冲突
