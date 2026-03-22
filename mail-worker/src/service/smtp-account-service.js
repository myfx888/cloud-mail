import { eq, and } from 'drizzle-orm';
import smtpAccount from '../entity/smtp-account';
import { db } from '../db/db';
import smtpService from './smtp-service';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

const smtpAccountService = {
	/**
	 * 创建SMTP账户
	 */
	async create(c, accountId, smtpAccountData) {
		// 验证SMTP配置
		smtpService.validateSmtpConfig({
			host: smtpAccountData.host,
			port: smtpAccountData.port,
			user: smtpAccountData.user,
			password: smtpAccountData.password
		});

		// 如果设置为默认，先将其他账户设为非默认
		if (smtpAccountData.isDefault) {
			await db(c).update(smtpAccount)
				.set({ isDefault: 0 })
				.where(eq(smtpAccount.accountId, accountId));
		}

		// 创建SMTP账户
		const [result] = await db(c).insert(smtpAccount).values({
			accountId,
			name: smtpAccountData.name,
			host: smtpAccountData.host,
			port: smtpAccountData.port,
			user: smtpAccountData.user,
			password: smtpAccountData.password,
			secure: smtpAccountData.secure || 1,
			authType: smtpAccountData.authType || 'plain',
			isDefault: smtpAccountData.isDefault ? 1 : 0,
			status: 1
		}).returning();

		return result;
	},

	/**
	 * 更新SMTP账户
	 */
	async update(c, smtpAccountId, accountId, smtpAccountData) {
		// 验证SMTP配置
		smtpService.validateSmtpConfig({
			host: smtpAccountData.host,
			port: smtpAccountData.port,
			user: smtpAccountData.user,
			password: smtpAccountData.password
		});

		// 检查账户是否存在且属于该用户
		const existingAccount = await db(c).query.smtpAccount.findFirst({
			where: and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		});

		if (!existingAccount) {
			throw new BizError(t('smtpAccountNotFound'));
		}

		// 如果设置为默认，先将其他账户设为非默认
		if (smtpAccountData.isDefault) {
			await db(c).update(smtpAccount)
				.set({ isDefault: 0 })
				.where(eq(smtpAccount.accountId, accountId));
		}

		// 更新SMTP账户
		const [result] = await db(c).update(smtpAccount)
			.set({
				name: smtpAccountData.name,
				host: smtpAccountData.host,
				port: smtpAccountData.port,
				user: smtpAccountData.user,
				password: smtpAccountData.password,
				secure: smtpAccountData.secure || 1,
				authType: smtpAccountData.authType || 'plain',
				isDefault: smtpAccountData.isDefault ? 1 : 0,
				updateTime: new Date().toISOString()
			})
			.where(and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			))
			.returning();

		return result;
	},

	/**
	 * 删除SMTP账户
	 */
	async delete(c, smtpAccountId, accountId) {
		// 检查账户是否存在且属于该用户
		const existingAccount = await db(c).query.smtpAccount.findFirst({
			where: and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		});

		if (!existingAccount) {
			throw new BizError(t('smtpAccountNotFound'));
		}

		// 如果是默认账户，不允许删除
		if (existingAccount.isDefault) {
			throw new BizError(t('defaultSmtpAccountCannotDelete'));
		}

		// 删除SMTP账户
		await db(c).delete(smtpAccount)
			.where(and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			));

		return { success: true };
	},

	/**
	 * 获取SMTP账户列表
	 */
	async list(c, accountId) {
		const accounts = await db(c).query.smtpAccount.findMany({
			where: eq(smtpAccount.accountId, accountId),
			orderBy: (smtpAccount, { desc }) => [
				desc(smtpAccount.isDefault),
				smtpAccount.createTime
			]
		});

		// 移除密码信息
		return accounts.map(account => ({
			...account,
			password: ''
		}));
	},

	/**
	 * 获取默认SMTP账户
	 */
	async getDefault(c, accountId) {
		return await db(c).query.smtpAccount.findFirst({
			where: and(
				eq(smtpAccount.accountId, accountId),
				eq(smtpAccount.isDefault, 1),
				eq(smtpAccount.status, 1)
			)
		});
	},

	/**
	 * 获取指定SMTP账户
	 */
	async getById(c, smtpAccountId, accountId) {
		const account = await db(c).query.smtpAccount.findFirst({
			where: and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		});

		if (!account) {
			throw new BizError(t('smtpAccountNotFound'));
		}

		// 移除密码信息
		return {
			...account,
			password: ''
		};
	},

	/**
	 * 验证SMTP账户配置
	 */
	async verify(c, smtpAccountData) {
		return await smtpService.verify(c, {
			host: smtpAccountData.host,
			port: smtpAccountData.port,
			user: smtpAccountData.user,
			password: smtpAccountData.password,
			secure: smtpAccountData.secure || 1,
			authType: smtpAccountData.authType || 'plain'
		});
	}
};

export default smtpAccountService;