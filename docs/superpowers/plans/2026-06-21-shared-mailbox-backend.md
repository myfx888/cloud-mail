# 共享邮箱 — 后端实现计划（Backend）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同一个邮箱可被多个用户共用（共享收件箱：单份邮件、已读/删除/星标全员同步），新增 `mailbox:share` 权限开关，管理端可查看/指派/踢除成员。

**Architecture:** `account` 升级为「邮箱」概念，新增 `account_member` 关系表与 `account_member_signature` 个人签名表；访问控制从 `userId===owner` 改为「成员身份」；邮件列表去掉 `userId` 维度、按 `accountId` + 成员身份可见；`star` 改为按邮件存储以共享星标。

**Tech Stack:** Cloudflare Workers + Hono + Drizzle ORM (D1) + KV。本项目**无自动化测试**（`vitest` 已装但无测试文件、`npm test` 实为 deploy），验证以 `wrangler dev` + 接口实测 + `wrangler d1 execute` 查库为准。

**Spec:** `docs/superpowers/specs/2026-06-21-shared-mailbox-design.md`

**前置约定**
- 所有「成员身份」校验统一走新增的 `assertMember(c, accountId, userId)`。
- 「creator」= `account.userId`（创建者），仅作归属；访问控制一律用 `account_member`。
- 邮箱级设置（allReceive/置顶/改名/SMTP）仅 creator 或 admin 可改；签名全员可改。

---

## Phase 1 — 数据模型与迁移

### Task 1: 新增实体 `account_member`

**Files:**
- Create: `mail-worker/src/entity/account-member.js`

- [ ] **Step 1: 创建实体文件**

```js
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountMember = sqliteTable('account_member', {
	memberId: integer('member_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	role: integer('role').default(0).notNull(),
	lastSigScope: text('last_sig_scope').default('').notNull(),
	lastSigId: text('last_sig_id').default('').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
export default accountMember;
```

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/entity/account-member.js
git commit -m "feat(shared-mailbox): add account_member entity"
```

### Task 2: 新增实体 `account_member_signature`

**Files:**
- Create: `mail-worker/src/entity/account-member-signature.js`

- [ ] **Step 1: 创建实体文件**

```js
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountMemberSignature = sqliteTable('account_member_signature', {
	sigId: integer('sig_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	sigUid: text('sig_uid').notNull(),
	name: text('name').notNull().default(''),
	content: text('content').notNull().default(''),
	isDefault: integer('is_default').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
export default accountMemberSignature;
```

- [ ] **Step 2: 提交**

```bash
git add mail-worker/src/entity/account-member-signature.js
git commit -m "feat(shared-mailbox): add account_member_signature entity"
```

### Task 3: 迁移 `v4_3DB`（建表 + 回填成员 + star 改造 + 权限播种）

**Files:**
- Modify: `mail-worker/src/init/init.js`（在 `v4_2DB` 调用后追加 `v4_3DB`，并新增方法）

- [ ] **Step 1: 在 `init` 方法调用链追加 `v4_3DB`**

定位 `mail-worker/src/init/init.js` 中 `await this.v4_2DB(c);`（约第 51 行），其后追加：

```js
		await this.v4_2DB(c);
		await this.v4_3DB(c);
```

- [ ] **Step 2: 新增 `v4_3DB` 方法**（放在 `v4_2DB` 方法定义之后、`settingService.refresh(c)` 之前的类方法区）

```js
	async v4_3DB(c) {
		try {
			// 1. 成员关系表
			await c.env.db.prepare(
				`CREATE TABLE IF NOT EXISTS account_member (
					member_id INTEGER PRIMARY KEY AUTOINCREMENT,
					account_id INTEGER NOT NULL,
					user_id INTEGER NOT NULL,
					role INTEGER NOT NULL DEFAULT 0,
					last_sig_scope TEXT NOT NULL DEFAULT '',
					last_sig_id TEXT NOT NULL DEFAULT '',
					create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);`
			).run();
			await c.env.db.prepare(
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_member_unique ON account_member(account_id, user_id);`
			).run();

			// 2. 个人签名表
			await c.env.db.prepare(
				`CREATE TABLE IF NOT EXISTS account_member_signature (
					sig_id INTEGER PRIMARY KEY AUTOINCREMENT,
					account_id INTEGER NOT NULL,
					user_id INTEGER NOT NULL,
					sig_uid TEXT NOT NULL,
					name TEXT NOT NULL DEFAULT '',
					content TEXT NOT NULL DEFAULT '',
					is_default INTEGER NOT NULL DEFAULT 0,
					create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
				);`
			).run();
			await c.env.db.prepare(
				`CREATE INDEX IF NOT EXISTS idx_ams_lookup ON account_member_signature(account_id, user_id);`
			).run();

			// 3. 回填：现有 account 的 owner 成为单成员邮箱
			await c.env.db.prepare(
				`INSERT OR IGNORE INTO account_member(account_id, user_id)
				 SELECT account_id, user_id FROM account WHERE is_del = 0;`
			).run();

			// 4. star 改为按邮件共享：去重后加唯一索引
			try {
				await c.env.db.prepare(
					`DELETE FROM star WHERE rowid NOT IN (SELECT MIN(rowid) FROM star GROUP BY email_id);`
				).run();
			} catch (e) { console.warn('v4_3DB star dedupe skipped:', e.message); }
			await c.env.db.prepare(
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_star_email ON star(email_id);`
			).run();

			// 5. 权限播种：在「邮件账户」根下加 mailbox:share（默认不给任何角色，需管理员勾选）
			let rootRow = await c.env.db.prepare(
				`SELECT perm_id AS permId FROM perm WHERE pid = 0 AND name = '邮件账户' LIMIT 1`
			).first();
			if (rootRow?.permId) {
				const exist = await c.env.db.prepare(
					`SELECT perm_id FROM perm WHERE perm_key = 'mailbox:share' LIMIT 1`
				).first();
				if (!exist) {
					const maxSortRow = await c.env.db.prepare(
						`SELECT MAX(sort) AS ms FROM perm WHERE pid = ?`
					).bind(rootRow.permId).first();
					const sort = (maxSortRow?.ms ?? -1) + 1;
					await c.env.db.prepare(
						`INSERT INTO perm (name, perm_key, pid, type, sort) VALUES ('共享邮箱', 'mailbox:share', ?, 2, ?)`
					).bind(rootRow.permId, sort).run();
				}
			}
		} catch (e) {
			console.warn('v4_3DB 迁移失败：', e.message);
		}
	},
```

- [ ] **Step 3: 触发迁移并验证**

Run（dev 环境，替换为你的 wrangler dev 配置）:
```bash
cd mail-worker && npm run dev
```
另起终端调用 init（用管理员 token）:
```bash
curl "http://localhost:8787/init"
```
查库确认:
```bash
npx wrangler d1 execute <DB_NAME> --local --command "SELECT name,perm_key FROM perm WHERE perm_key='mailbox:share';"
npx wrangler d1 execute <DB_NAME> --local --command "SELECT COUNT(*) AS n FROM account_member;"
```
Expected: `mailbox:share` 行存在；`account_member` 行数 = 现有未删账号数。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/init/init.js
git commit -m "feat(shared-mailbox): v4_3DB migration — tables, member backfill, star shared index, perm seed"
```

### Task 4: i18n 权限与文案

**Files:**
- Modify: `mail-worker/src/i18n/zh.js`、`mail-worker/src/i18n/en.js`

- [ ] **Step 1: zh.js `perms` 对象内追加（在 `'发件重置': '发件重置'` 前）**

```js
		"共享邮箱": "共享邮箱",
		'发件重置': '发件重置'
```

并在文件顶部业务文案区追加（与其它 BizError 文案并列）:
```js
	mailboxNotShareable: '主邮箱（登录身份）不可共享',
	mailboxShareNoPerm: '无共享邮箱权限',
	alreadyMember: '已是该邮箱成员',
	lastMemberCannotLeave: '至少保留一名成员（所有者）',
	cannotKickCreator: '不能移除邮箱所有者',
```

- [ ] **Step 2: en.js 对应追加**（perms 与业务文案英文版）

```js
		"共享邮箱": "Shared Mailbox",
```
```js
	mailboxNotShareable: 'Primary mailbox (login identity) cannot be shared',
	mailboxShareNoPerm: 'No permission to use shared mailbox',
	alreadyMember: 'Already a member of this mailbox',
	lastMemberCannotLeave: 'At least one member (owner) must remain',
	cannotKickCreator: 'Cannot remove the mailbox owner',
```

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js
git commit -m "feat(shared-mailbox): i18n for mailbox:share perm and errors"
```

---

## Phase 2 — 权限映射

### Task 5: `security.js` 路径鉴权映射

**Files:**
- Modify: `mail-worker/src/security/security.js`

- [ ] **Step 1: `requirePerms` 数组追加共享相关路径**

在 `requirePerms`（约第 24 行）追加:
```js
	'/mailbox/',          // 成员查看/退出
	'/email/restore',     // （回收站复用，预先加入不影响）
```

- [ ] **Step 2: `premKey` 映射追加**

在 `premKey` 对象内追加:
```js
	'mailbox:share': ['/account/add', '/mailbox/'],
```
说明：`/account/add` 同时挂在 `account:add` 与 `mailbox:share` 下——拥有任一权限即可到达端点，具体走新建还是共享分支由 service 内 `mailbox:share` 校验决定（Task 7）。

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/security/security.js
git commit -m "feat(shared-mailbox): wire mailbox:share into security path mapping"
```

---

## Phase 3 — 成员服务与核心 helper

### Task 6: 新增 `member-service.js`（成员身份与关系操作）

**Files:**
- Create: `mail-worker/src/service/member-service.js`

集中成员相关逻辑，避免 `account-service.js` 进一步膨胀（已 839 行）。

- [ ] **Step 1: 创建 service**

```js
import orm from '../entity/orm';
import accountMember from '../entity/account-member';
import accountMemberSignature from '../entity/account-member-signature';
import account from '../entity/account';
import user from '../entity/user';
import { and, eq, inArray, count } from 'drizzle-orm';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { isDel } from '../const/entity-const';
import permService from './perm-service';
import userService from './user-service';

const memberService = {

	// 是否为成员
	isMember(c, accountId, userId) {
		return orm(c).select().from(accountMember)
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).get();
	},

	// 成员身份校验：非成员抛错
	async assertMember(c, accountId, userId) {
		const row = await this.isMember(c, accountId, userId);
		if (!row) throw new BizError(t('noUserAccount'));
		return row;
	},

	// 是否为 creator
	async isCreator(c, accountId, userId) {
		const row = await orm(c).select({ userId: account.userId }).from(account)
			.where(eq(account.accountId, accountId)).get();
		return row?.userId === userId;
	},

	// 用户可见的全部 accountId（拥有的 + 共享的）
	async getVisibleAccountIds(c, userId) {
		const rows = await orm(c).select({ accountId: accountMember.accountId }).from(accountMember)
			.where(eq(accountMember.userId, userId)).all();
		return rows.map(r => r.accountId);
	},

	// 该用户已加入的邮箱数（配额）
	async countUserMailboxes(c, userId) {
		const { num } = await orm(c).select({ num: count() }).from(accountMember)
			.where(eq(accountMember.userId, userId)).get();
		return num;
	},

	// 是否拥有某 permKey
	async hasPerm(c, userId, permKey) {
		const keys = await permService.userPermKeys(c, userId);
		return keys.includes(permKey);
	},

	// 列出某邮箱成员（含 creator 标记 + 用户登录邮箱）
	async listMembers(c, accountId) {
		const rows = await orm(c).select({
			memberId: accountMember.memberId,
			userId: accountMember.userId,
			isCreator: sql`${account.userId} = ${accountMember.userId}`.as('isCreator'),
			userEmail: user.email,
			createTime: accountMember.createTime
		}).from(accountMember)
			.innerJoin(account, eq(account.accountId, accountMember.accountId))
			.leftJoin(user, eq(user.userId, accountMember.userId))
			.where(eq(accountMember.accountId, accountId)).all();
		return rows;
	},

	// 加入（create-or-share 的共享分支）
	async join(c, accountId, userId, isAdmin = false) {
		// 主邮箱（登录身份）不可共享：目标邮箱 email 若是某用户登录邮箱则禁止
		const accountRow = await orm(c).select().from(account).where(eq(account.accountId, accountId)).get();
		if (!accountRow) throw new BizError(t('accountNotExist'));

		const loginOwner = await orm(c).select({ userId: user.userId }).from(user)
			.where(and(eq(user.email, accountRow.email), eq(user.isDel, isDel.NORMAL))).get();
		if (loginOwner && loginOwner.userId !== userId) {
			throw new BizError(t('mailboxNotShareable'));
		}

		if (!isAdmin && !(await this.hasPerm(c, userId, 'mailbox:share'))) {
			throw new BizError(t('mailboxShareNoPerm'));
		}

		if (await this.isMember(c, accountId, userId)) {
			throw new BizError(t('alreadyMember'));
		}

		await orm(c).insert(accountMember).values({ accountId, userId }).run();
		return accountRow;
	},

	// 退出 / 踢除（保留个人签名，便于恢复）
	async leave(c, accountId, userId, isAdmin = false) {
		const target = await this.isMember(c, accountId, userId);
		if (!target) return;

		if (await this.isCreator(c, accountId, userId)) {
			throw new BizError(t('cannotKickCreator'));
		}
		const total = await orm(c).select({ num: count() }).from(accountMember)
			.where(eq(accountMember.accountId, accountId)).get();
		if (Number(total?.num || 0) <= 1) {
			throw new BizError(t('lastMemberCannotLeave'));
		}

		await orm(c).delete(accountMember)
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).run();
		// 个人签名保留（不删 account_member_signature）
	},

	// 记忆上次签名选择
	async setLastSignature(c, accountId, userId, scope, sigId) {
		await orm(c).update(accountMember).set({ lastSigScope: scope, lastSigId: sigId })
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).run();
	}
};

import { sql } from 'drizzle-orm';
export default memberService;
```

> 注：`sql` import 置于文件底部仅为集中说明；实现时请与其他 drizzle import 合并到文件顶部。

- [ ] **Step 2: 修正 import 位置**

把 `import { sql } from 'drizzle-orm';` 移到文件顶部与其它 import 合并，删除底部那行。

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/member-service.js
git commit -m "feat(shared-mailbox): add member-service (membership, join/leave, quota, sig memory)"
```

---

## Phase 4 — account-service 改造

### Task 7: `add` 改造为 create-or-share

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（`add` 方法，约第 98-219 行）

- [ ] **Step 1: 顶部引入 member-service**

在 `account-service.js` 顶部 import 区追加:
```js
import memberService from './member-service';
```

- [ ] **Step 2: 在 `add` 内插入共享分支**

定位 `add` 方法中：
```js
		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}
```
替换为:
```js
		if (accountRow) {
			// 邮箱已存在 → create-or-share 的「共享」分支
			return await memberService.join(c, accountRow.accountId, userId);
		}
```

- [ ] **Step 3: 新建分支中回填 creator 为成员**

定位新建语句（约第 172 行）:
```js
		accountRow = await orm(c).insert(account).values({ email: email, userId: userId, name: emailUtils.getName(email) }).returning().get();
```
在其后追加（mailcow 配置之前）:
```js
		await orm(c).insert(accountMember).values({ accountId: accountRow.accountId, userId }).run();
```
并在顶部 import 区追加:
```js
import accountMember from '../entity/account-member';
```

- [ ] **Step 4: 验证 create-or-share**

```bash
cd mail-worker && npm run dev
```
1. 用拥有 `mailbox:share` 的用户 A 调 `POST /account/add {email:"sales@test.com"}` → 新建，A 成为 creator+成员。
2. 用同样有权限的用户 B 再次 `POST /account/add {email:"sales@test.com"}` → 返回该账号（共享），B 写入 `account_member`。
3. 用**无** `mailbox:share` 的用户 C 添加已存在邮箱 → 返回 `mailboxShareNoPerm` 错误。
查库:
```bash
npx wrangler d1 execute <DB> --local --command "SELECT * FROM account_member WHERE account_id=(SELECT account_id FROM account WHERE email='sales@test.com');"
```

- [ ] **Step 5: 提交**

```bash
git add mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): create-or-share in account add; creator seeded as member"
```

### Task 8: `list` 与 `countUserAccount` 改为成员维度

**Files:**
- Modify: `mail-worker/src/service/account-service.js`

- [ ] **Step 1: 改写 `list`（约第 225 行）**

将 `where(... eq(account.userId, userId) ...)` 改为通过 `account_member` 关联。整体替换 `list` 方法体为:
```js
	list(c, params, userId) {
		let { accountId, size, lastSort } = params;
		accountId = Number(accountId);
		size = Number(size);
		lastSort = Number(lastSort);
		if (size > 30) size = 30;
		if (!accountId) accountId = 0;
		if (Number.isNaN(lastSort)) lastSort = 9999999999;

		return orm(c).select({ account: account })
			.from(account)
			.innerJoin(accountMember, eq(accountMember.accountId, account.accountId))
			.where(
				and(
					eq(accountMember.userId, userId),
					eq(account.isDel, isDel.NORMAL),
					or(
						lt(account.sort, lastSort),
						and(eq(account.sort, lastSort), gt(account.accountId, accountId))
					)
				)
			)
			.orderBy(desc(account.sort), asc(account.accountId))
			.limit(size)
			.all()
			.map(row => row.account);
	},
```

- [ ] **Step 2: 改写 `countUserAccount`（约第 365 行）**

```js
	async countUserAccount(c, userId) {
		return await memberService.countUserMailboxes(c, userId);
	},
```

- [ ] **Step 3: 验证**

B 登录后 `GET /account/list` → 返回列表包含其 creator 邮箱 + 共享的 `sales@test.com`。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): account list & quota by membership"
```

### Task 9: 邮箱级操作权属校验收紧为「成员 + creator/admin」

**Files:**
- Modify: `mail-worker/src/service/account-service.js`

对 `setName`、`setAllReceive`、`setAsTop`、`delete`、`retryMailcow`、`switchSmtpServer`、`provisionSmtpByMailcowServer`：把 `if (accountRow.userId !== userId) throw` 改为「非成员或非 creator 且非 admin 抛错」。

- [ ] **Step 1: 新增 helper**

在 `accountService` 对象内新增:
```js
	async assertCanManage(c, accountId, userId, isAdmin = false) {
		await memberService.assertMember(c, accountId, userId);
		if (isAdmin) return;
		if (!(await memberService.isCreator(c, accountId, userId))) {
			throw new BizError(t('noUserAccount'));
		}
	},
```

- [ ] **Step 2: 替换各方法内的 owner 校验**

以 `setName`（约第 390 行）为例，将:
```js
		await orm(c).update(account).set({name}).where(and(eq(account.userId, userId),eq(account.accountId, accountId))).run();
```
前插入:
```js
		await this.assertCanManage(c, accountId, userId);
```
并把 update 的 where 改为按 `accountId`（去掉 `userId`）:
```js
		await orm(c).update(account).set({name}).where(eq(account.accountId, accountId)).run();
```
对 `setAllReceive`、`setAsTop`、`delete`、`retryMailcow`、`switchSmtpServer`、`provisionSmtpByMailcowServer` 做同样替换：
- 方法开头 `if (accountRow.userId !== userId) throw ...` → `await this.assertCanManage(c, accountId, userId, isAdmin)`（admin 入口传 true）。
- 其后按 `accountId` 更新（去掉 where 中的 `userId` 约束）。

> `delete`（软删邮箱）保持「仅 creator/admin」语义；`setAsTop` 内涉及 `userRow.email` 主邮箱排序逻辑保留。

- [ ] **Step 3: 验证**

成员 B（非 creator）调 `PUT /account/setName` 改共享邮箱名 → 403；creator A 可改。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): mailbox-level settings restricted to creator/admin via assertCanManage"
```

---

## Phase 5 — 签名

### Task 10: 共享签名权属校验改成员

**Files:**
- Modify: `mail-worker/src/service/account-service.js`（`getSignatures`/`addSignature`/`updateSignature`/`deleteSignature`/`setDefaultSignature`，约第 568-717 行）

- [ ] **Step 1: 把每个签名方法内的**

```js
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
```
替换为:
```js
		await memberService.assertMember(c, accountId, userId);
```
（签名全员可改，故用 `assertMember` 而非 `assertCanManage`。）

- [ ] **Step 2: 验证**

成员 B `GET/POST /account/:id/signatures` 共享签名 → 成功；非成员 → 403。

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): shared signatures editable by any member"
```

### Task 11: 个人签名 CRUD

**Files:**
- Modify: `mail-worker/src/service/account-service.js`、`mail-worker/src/entity/account-member-signature.js`（已建）

- [ ] **Step 1: 顶部引入实体**

```js
import accountMemberSignature from '../entity/account-member-signature';
```

- [ ] **Step 2: 新增个人签名方法**（追加到 `accountService` 对象内）

```js
	async getPersonalSignatures(c, accountId, userId) {
		await memberService.assertMember(c, accountId, userId);
		return await orm(c).select().from(accountMemberSignature)
			.where(and(eq(accountMemberSignature.accountId, accountId), eq(accountMemberSignature.userId, userId))).all();
	},

	async addPersonalSignature(c, accountId, data, userId) {
		await memberService.assertMember(c, accountId, userId);
		const list = await orm(c).select().from(accountMemberSignature)
			.where(and(eq(accountMemberSignature.accountId, accountId), eq(accountMemberSignature.userId, userId))).all();
		const sigUid = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		if (data.isDefault) {
			await orm(c).update(accountMemberSignature).set({ isDefault: 0 })
				.where(and(eq(accountMemberSignature.accountId, accountId), eq(accountMemberSignature.userId, userId))).run();
		}
		const row = await orm(c).insert(accountMemberSignature).values({
			accountId, userId, sigUid, name: data.name || '新签名', content: data.content || '', isDefault: data.isDefault ? 1 : 0
		}).returning().get();
		return { id: row.sigUid, name: row.name, content: row.content, isDefault: row.isDefault };
	},

	async updatePersonalSignature(c, accountId, sigUid, data, userId) {
		await memberService.assertMember(c, accountId, userId);
		if (data.isDefault) {
			await orm(c).update(accountMemberSignature).set({ isDefault: 0 })
				.where(and(eq(accountMemberSignature.accountId, accountId), eq(accountMemberSignature.userId, userId))).run();
		}
		await orm(c).update(accountMemberSignature).set({
			name: data.name, content: data.content,
			isDefault: data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : undefined
		}).where(and(
			eq(accountMemberSignature.accountId, accountId),
			eq(accountMemberSignature.userId, userId),
			eq(accountMemberSignature.sigUid, sigUid)
		)).run();
	},

	async deletePersonalSignature(c, accountId, sigUid, userId) {
		await memberService.assertMember(c, accountId, userId);
		await orm(c).delete(accountMemberSignature).where(and(
			eq(accountMemberSignature.accountId, accountId),
			eq(accountMemberSignature.userId, userId),
			eq(accountMemberSignature.sigUid, sigUid)
		)).run();
	},

	async setDefaultPersonalSignature(c, accountId, sigUid, userId) {
		await memberService.assertMember(c, accountId, userId);
		await orm(c).update(accountMemberSignature).set({ isDefault: 0 })
			.where(and(eq(accountMemberSignature.accountId, accountId), eq(accountMemberSignature.userId, userId))).run();
		await orm(c).update(accountMemberSignature).set({ isDefault: 1 }).where(and(
			eq(accountMemberSignature.accountId, accountId),
			eq(accountMemberSignature.userId, userId),
			eq(accountMemberSignature.sigUid, sigUid)
		)).run();
	},

	// 解析发送签名：上次选择 > 共享默认 > 无
	async resolveSignature(c, accountId, userId) {
		const member = await memberService.assertMember(c, accountId, userId);
		if (member.lastSigId) {
			if (member.lastSigScope === 'shared') {
				const shared = JSON.parse((await this.selectById(c, accountId)).signatures || '[]');
				const hit = shared.find(s => s.id === member.lastSigId);
				if (hit) return { scope: 'shared', signature: hit };
			} else if (member.lastSigScope === 'personal') {
				const row = await orm(c).select().from(accountMemberSignature).where(and(
					eq(accountMemberSignature.accountId, accountId),
					eq(accountMemberSignature.userId, userId),
					eq(accountMemberSignature.sigUid, member.lastSigId)
				)).get();
				if (row) return { scope: 'personal', signature: { id: row.sigUid, name: row.name, content: row.content, isDefault: row.isDefault } };
			}
		}
		// 兜底：共享默认
		const shared = JSON.parse((await this.selectById(c, accountId)).signatures || '[]');
		const def = shared.find(s => s.isDefault) || null;
		return def ? { scope: 'shared', signature: def } : { scope: null, signature: null };
	},
```

- [ ] **Step 3: 提交**

```bash
git add mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): personal signatures CRUD + resolve (last-choice > shared default)"
```

---

## Phase 6 — 邮件与星标可见性

### Task 12: `email.list` 去掉 userId 维度

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（`list`，约第 29-142 行）

- [ ] **Step 1: 引入 member-service**

顶部 import 区追加:
```js
import memberService from './member-service';
```

- [ ] **Step 2: 进入前校验成员**

在 `list` 方法 `if (isNaN(allReceive)) {...}` 之后追加:
```js
		// 共享邮箱：访问控制按成员身份
		if (!allReceive) {
			await memberService.assertMember(c, accountId, userId);
		}
```

- [ ] **Step 3: 去掉 where 中的 `eq(email.userId, userId)`**

`list` 内有三处 `and(... eq(email.userId, userId) ...)`（listQuery / totalQuery / latestEmailQuery）。删除每处的 `eq(email.userId, userId),` 一行，保留 `eq(email.accountId, accountId)`。

- [ ] **Step 4: star join 去掉 userId**

把:
```js
.leftJoin(star, and(eq(star.emailId, email.emailId), eq(star.userId, userId)))
```
改为:
```js
.leftJoin(star, eq(star.emailId, email.emailId))
```

- [ ] **Step 5: allReceive 模式按可见邮箱**

把 listQuery/totalQuery/latestEmailQuery 中 `allReceive ? eq(1,1) : eq(email.accountId, accountId)` 的 `eq(1,1)` 分支改为:
```js
allReceive ? inArray(email.accountId, await memberService.getVisibleAccountIds(c, userId)) : eq(email.accountId, accountId)
```
（三处同步修改；若 `inArray` 未导入则在顶部 drizzle import 补 `inArray`。）

- [ ] **Step 6: 验证**

A、B 共享 `sales@`。给 `sales@` 发一封邮件 → A、B 各自 `GET /email/list?accountId=<sales>` 均能看到该邮件（单份）。非成员 C 调 → 403。

- [ ] **Step 7: 提交**

```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat(shared-mailbox): email list by accountId + membership; shared star join"
```

### Task 13: 读 / 删 改为成员级、按 accountId

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（`delete` 约第 144、`read` 约第 914）

- [ ] **Step 1: `delete` 改写**

```js
	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(inArray(email.emailId, emailIdList), inArray(email.accountId, visible))
		).run();
	},
```

- [ ] **Step 2: `read` 改写**

```js
	async read(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(
			and(inArray(email.emailId, emailIdList), inArray(email.accountId, visible))
		).run();
	}
```

- [ ] **Step 3: 验证共享状态同步**

A 标记已读 / 删除 → B 列表中该邮件同步为已读 / 进入回收站（`isDel=1`）。

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat(shared-mailbox): read/delete by membership + accountId (shared state)"
```

### Task 14: star 改为按邮件共享

**Files:**
- Modify: `mail-worker/src/service/star-service.js`

- [ ] **Step 1: 引入 member-service**

```js
import memberService from './member-service';
```

- [ ] **Step 2: `add` 去掉 userId 校验与字段**

将 `add` 改为:
```js
	async add(c, params, userId) {
		const { emailId } = params;
		const emailRow = await emailService.selectById(c, emailId);
		if (!emailRow) throw new BizError(t('starNotExistEmail'));
		await memberService.assertMember(c, emailRow.accountId, userId);
		const exist = await orm(c).select().from(star).where(eq(star.emailId, emailId)).get();
		if (exist) return;
		await orm(c).insert(star).values({ userId, emailId }).run();
	},
```

- [ ] **Step 3: `cancel` 按 emailId**

```js
	async cancel(c, params, userId) {
		const { emailId } = params;
		const emailRow = await emailService.selectById(c, emailId);
		if (emailRow) await memberService.assertMember(c, emailRow.accountId, userId);
		await orm(c).delete(star).where(eq(star.emailId, emailId)).run();
	},
```

- [ ] **Step 4: `list` 按可见邮箱**

```js
	async list(c, params, userId) {
		let { emailId, size } = params;
		emailId = Number(emailId); size = Number(size);
		if (!emailId) emailId = 9999999999;
		const visible = await memberService.getVisibleAccountIds(c, userId);
		const list = await orm(c).select({ isStar: sql`1`.as('isStar'), starId: star.starId, ...email })
			.from(star).leftJoin(email, eq(email.emailId, star.emailId))
			.where(and(inArray(email.accountId, visible), eq(email.isDel, isDel.NORMAL), lt(star.emailId, emailId)))
			.orderBy(desc(star.emailId)).limit(size).all();
		const emailIds = list.map(item => item.emailId);
		const attsList = await attService.selectByEmailIds(c, emailIds);
		list.forEach(row => { row.attList = attsList.filter(a => a.emailId === row.emailId); });
		return { list };
	},
```

- [ ] **Step 5: 验证**

A 星标 → B `GET /star/list` 也看到该星标邮件。

- [ ] **Step 6: 提交**

```bash
git add mail-worker/src/service/star-service.js
git commit -m "feat(shared-mailbox): star shared per-email across members"
```

---

## Phase 7 — API 层

### Task 15: 用户端成员与个人签名接口

**Files:**
- Modify: `mail-worker/src/api/account-api.js`

- [ ] **Step 1: 引入**

```js
import memberService from '../service/member-service';
```

- [ ] **Step 2: 追加成员接口**

```js
app.get('/mailbox/:accountId/members', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const userId = userContext.getUserId(c);
	await memberService.assertMember(c, accountId, userId);
	return c.json(result.ok(await memberService.listMembers(c, accountId)));
});

app.post('/mailbox/:accountId/leave', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	await memberService.leave(c, accountId, userContext.getUserId(c));
	return c.json(result.ok());
});

// 记忆上次签名选择
app.put('/mailbox/:accountId/signature-choice', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const { scope, sigId } = await c.req.json();
	await memberService.setLastSignature(c, accountId, userContext.getUserId(c), scope, sigId);
	return c.json(result.ok());
});
```

- [ ] **Step 3: 追加个人签名接口**

```js
app.get('/account/:accountId/signatures/personal', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const list = await accountService.getPersonalSignatures(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.post('/account/:accountId/signatures/personal', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const sig = await accountService.addPersonalSignature(c, accountId, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(sig));
});

app.put('/account/:accountId/signatures/personal/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const sig = await accountService.updatePersonalSignature(c, accountId, c.req.param('signatureId'), await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(sig));
});

app.delete('/account/:accountId/signatures/personal/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	await accountService.deletePersonalSignature(c, accountId, c.req.param('signatureId'), userContext.getUserId(c));
	return c.json(result.ok());
});
```

- [ ] **Step 4: 提交**

```bash
git add mail-worker/src/api/account-api.js
git commit -m "feat(shared-mailbox): member list/leave, sig-choice, personal signature endpoints"
```

### Task 16: 管理端成员管理接口

**Files:**
- Modify: `mail-worker/src/api/admin-api.js`

- [ ] **Step 1: 引入**

```js
import memberService from '../service/member-service';
import userService from '../service/user-service';
```

- [ ] **Step 2: 追加管理端接口**

```js
app.get('/admin/mailbox/:accountId/members', async (c) => {
	if (!userContext.isAdmin(c)) throw new BizError(t('unauthorized'), 403);
	const accountId = parseInt(c.req.param('accountId'));
	return c.json(result.ok(await memberService.listMembers(c, accountId)));
});

app.post('/admin/mailbox/:accountId/members', async (c) => {
	if (!userContext.isAdmin(c)) throw new BizError(t('unauthorized'), 403);
	const accountId = parseInt(c.req.param('accountId'));
	const { userId } = await c.req.json();
	await memberService.join(c, accountId, Number(userId), true);
	return c.json(result.ok());
});

app.delete('/admin/mailbox/:accountId/members/:userId', async (c) => {
	if (!userContext.isAdmin(c)) throw new BizError(t('unauthorized'), 403);
	const accountId = parseInt(c.req.param('accountId'));
	const userId = parseInt(c.req.param('userId'));
	await memberService.leave(c, accountId, userId, true);
	return c.json(result.ok());
});
```

- [ ] **Step 3: `adminListAccounts` 增加「成员数」列**

在 `account-service.js` 的 `adminListAccounts` select 中追加子查询字段:
```js
memberCount: sql`(SELECT COUNT(*) FROM account_member WHERE account_member.account_id = ${account.accountId})`.as('memberCount'),
```

- [ ] **Step 4: 验证**

管理员 `GET /admin/mailbox/<id>/members`；`POST` 指派；`DELETE` 踢除（creator 踢除应返回 `cannotKickCreator`）。

- [ ] **Step 5: 提交**

```bash
git add mail-worker/src/api/admin-api.js mail-worker/src/service/account-service.js
git commit -m "feat(shared-mailbox): admin member management endpoints + memberCount column"
```

---

## Phase 8 — 验收

### Task 17: 端到端验收清单

**Files:** 无（手动验收）

- [ ] **Step 1: 权限生效**

无 `mailbox:share` 的用户添加已存在邮箱 → 报错；管理员在角色管理勾选 `共享邮箱` 后，该用户可共享。

- [ ] **Step 2: create-or-share**

新建邮箱 → creator 自动为成员；重复添加同邮箱 → 成为成员；`account_member` 与配额计数正确（加入 +1，退出 -1）。

- [ ] **Step 3: 共享收件箱**

A/B 共享邮箱：发往该邮箱的邮件双方可见（单份）；A 读/删/星标 → B 同步。

- [ ] **Step 4: 签名**

共享签名全员可改；个人签名仅本人可见；发送时按「上次选择 > 共享默认」解析；记忆跨会话生效。

- [ ] **Step 5: 管理端**

后台可见某邮箱成员列表与成员数；指派/踢除生效；creator 与最后一名成员受保护；主邮箱（登录身份）不可被他人共享。

- [ ] **Step 6: 回归**

个人邮箱（成员数 1）行为不变：列表、收发、读/删/星标、签名均正常。

---

## Self-Review（写计划后自检）

**Spec 覆盖**
- 数据结构（§3）：Task 1/2/3 ✓
- 权限 `mailbox:share` + 鉴权映射（§4.1/4.2）：Task 3/5 ✓
- 端点（§4.3）：Task 15/16 ✓
- `assertMember`（§4.4）：Task 6（member-service）✓
- 收件可见性（§5）：Task 12/13/14 ✓（`HandleOnSiteEmail` 无需改，已在 spec 注明）
- 邮箱级设置 creator/admin（§5.5）：Task 9 ✓
- 签名（§6）：Task 10/11 ✓
- 管理端（§7）：Task 16 ✓
- 迁移/边界/前端（§8）：迁移 Task 3；前端在独立计划；边界（主邮箱不可共享、creator 保护、个人签名保留）Task 6/11 ✓
- 回收站（另一份 spec）：本计划不含，独立计划处理。

**类型/命名一致性**
- `memberService.assertMember / isMember / isCreator / getVisibleAccountIds / countUserMailboxes / join / leave / setLastSignature / listMembers` 全程一致。
- `accountMember` / `accountMemberSignature` 实体命名一致。
- `assertCanManage` 在 Task 9 定义并被各设置方法调用 ✓。

**备注**
- `npm test` 非真实测试运行器；验证用 `wrangler dev` + `curl` + `wrangler d1 execute`。
- `<DB_NAME>` / `<DB>` / `<id>` 需替换为实际值。
