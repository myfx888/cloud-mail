import orm from '../entity/orm';
import accountMember from '../entity/account-member';
import account from '../entity/account';
import user from '../entity/user';
import { and, eq, count, sql } from 'drizzle-orm';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { isDel } from '../const/entity-const';
import permService from './perm-service';
import userContext from '../security/user-context';

const memberService = {

	isMember(c, accountId, userId) {
		return orm(c).select().from(accountMember)
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).get();
	},

	async assertMember(c, accountId, userId) {
		const row = await this.isMember(c, accountId, userId);
		if (!row) throw new BizError(t('noUserAccount'));
		return row;
	},

	async isCreator(c, accountId, userId) {
		const row = await orm(c).select({ userId: account.userId }).from(account)
			.where(eq(account.accountId, accountId)).get();
		return row?.userId === userId;
	},

	async getVisibleAccountIds(c, userId) {
		const rows = await orm(c).select({ accountId: accountMember.accountId }).from(accountMember)
			.where(eq(accountMember.userId, userId)).all();
		return rows.map(r => r.accountId);
	},

	// allReceive 聚合视图专用：只返回该用户作为「创建者」的邮箱（account.userId），
	// 不含仅以「成员」身份加入的共享邮箱。否则管理员加入大量共享邮箱后开启聚合，
	// 会看到别人邮箱地址的邮件。
	async getOwnedAccountIds(c, userId) {
		const rows = await orm(c).select({ accountId: account.accountId }).from(account)
			.where(and(eq(account.userId, userId), eq(account.isDel, isDel.NORMAL))).all();
		return rows.map(r => r.accountId);
	},

	async countUserMailboxes(c, userId) {
		const { num } = await orm(c).select({ num: count() }).from(accountMember)
			.where(eq(accountMember.userId, userId)).get();
		return num;
	},

	async hasPerm(c, userId, permKey) {
		// admin 全权：与 security.js 中间件豁免、loginUserInfo 返回 ['*'] 保持一致
		if (userContext.isAdmin(c)) {
			return true;
		}
		const keys = await permService.userPermKeys(c, userId);
		return keys.includes(permKey);
	},

	// 配置类接口（SMTP 等）的访问校验：admin、邮箱创建者、共享成员三者之一放行
	async canAccessAccount(c, accountId, userId, isAdmin = false) {
		if (isAdmin) return true;
		if (await this.isCreator(c, accountId, userId)) return true;
		return !!(await this.isMember(c, accountId, userId));
	},

	async listMembers(c, accountId) {
		return await orm(c).select({
			memberId: accountMember.memberId,
			userId: accountMember.userId,
			isCreator: sql`${account.userId} = ${accountMember.userId}`.as('isCreator'),
			userEmail: user.email,
			createTime: accountMember.createTime
		}).from(accountMember)
			.innerJoin(account, eq(account.accountId, accountMember.accountId))
			.leftJoin(user, eq(user.userId, accountMember.userId))
			.where(eq(accountMember.accountId, accountId)).all();
	},

	async join(c, accountId, userId, isAdmin = false) {
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

	async leave(c, accountId, userId) {
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
	},

	async setLastSignature(c, accountId, userId, scope, sigId) {
		await orm(c).update(accountMember).set({ lastSigScope: scope || '', lastSigId: sigId || '' })
			.where(and(eq(accountMember.accountId, accountId), eq(accountMember.userId, userId))).run();
	}
};

export default memberService;
