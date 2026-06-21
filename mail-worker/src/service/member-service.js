import orm from '../entity/orm';
import accountMember from '../entity/account-member';
import account from '../entity/account';
import user from '../entity/user';
import { and, eq, count, sql } from 'drizzle-orm';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { isDel } from '../const/entity-const';
import permService from './perm-service';

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

	async countUserMailboxes(c, userId) {
		const { num } = await orm(c).select({ num: count() }).from(accountMember)
			.where(eq(accountMember.userId, userId)).get();
		return num;
	},

	async hasPerm(c, userId, permKey) {
		const keys = await permService.userPermKeys(c, userId);
		return keys.includes(permKey);
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
