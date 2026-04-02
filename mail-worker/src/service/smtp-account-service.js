import { eq, and, desc } from 'drizzle-orm';
import smtpAccount from '../entity/smtp-account';
import orm from '../entity/orm';
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
			await orm(c).update(smtpAccount)
				.set({ isDefault: 0 })
				.where(eq(smtpAccount.accountId, accountId));
		}

		// 创建SMTP账户
		const result = await orm(c).insert(smtpAccount).values({
			accountId,
			name: smtpAccountData.name,
			host: smtpAccountData.host,
			port: smtpAccountData.port,
			user: smtpAccountData.user,
			password: smtpAccountData.password,
			secure: smtpAccountData.secure ?? 0,
			authType: smtpAccountData.authType || 'plain',
			isDefault: smtpAccountData.isDefault ? 1 : 0,
			mailcowServerId: smtpAccountData.mailcowServerId || '',
			status: 1
		}).returning().get();

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
		const existingAccount = await orm(c).select().from(smtpAccount).where(
			and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		).get();

		if (!existingAccount) {
			throw new BizError(t('smtpAccountNotFound'));
		}

		// 如果设置为默认，先将其他账户设为非默认
		if (smtpAccountData.isDefault) {
			await orm(c).update(smtpAccount)
				.set({ isDefault: 0 })
				.where(eq(smtpAccount.accountId, accountId));
		}

		// 更新SMTP账户
		const result = await orm(c).update(smtpAccount)
			.set({
				name: smtpAccountData.name,
				host: smtpAccountData.host,
				port: smtpAccountData.port,
				user: smtpAccountData.user,
				password: smtpAccountData.password,
				secure: smtpAccountData.secure ?? 0,
				authType: smtpAccountData.authType || 'plain',
				isDefault: smtpAccountData.isDefault ? 1 : 0,
				mailcowServerId: smtpAccountData.mailcowServerId || '',
				updateTime: new Date().toISOString()
			})
			.where(and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			))
			.returning().get();

		return result;
	},

	/**
	 * 删除SMTP账户
	 */
	async delete(c, smtpAccountId, accountId, isAdmin = false) {
		// 检查账户是否存在且属于该用户
		const existingAccount = await orm(c).select().from(smtpAccount).where(
			and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		).get();

		if (!existingAccount) {
			throw new BizError(t('smtpAccountNotFound'));
		}

		// 如果是默认账户，非管理员不允许删除
		if (existingAccount.isDefault && !isAdmin) {
			throw new BizError(t('defaultSmtpAccountCannotDelete'));
		}

		// 删除SMTP账户
		await orm(c).delete(smtpAccount)
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
		const accounts = await orm(c).select().from(smtpAccount).where(
			eq(smtpAccount.accountId, accountId)
		).orderBy(
			desc(smtpAccount.isDefault),
			smtpAccount.createTime
		).all();

		// 移除密码信息
		return accounts.map(account => ({
			...account,
			password: ''
		}));
	},

	/**
	 * 按 mailcowServerId 查找SMTP账户
	 */
	async findByMailcowServer(c, accountId, mailcowServerId) {
		if (!mailcowServerId) return null;
		return await orm(c).select().from(smtpAccount).where(
			and(
				eq(smtpAccount.accountId, accountId),
				eq(smtpAccount.mailcowServerId, mailcowServerId)
			)
		).get();
	},

	/**
	 * 获取默认SMTP账户
	 */
	async getDefault(c, accountId) {
		return await orm(c).select().from(smtpAccount).where(
			and(
				eq(smtpAccount.accountId, accountId),
				eq(smtpAccount.isDefault, 1),
				eq(smtpAccount.status, 1)
			)
		).get();
	},

	/**
	 * 获取指定SMTP账户
	 */
	async getById(c, smtpAccountId, accountId) {
		const account = await orm(c).select().from(smtpAccount).where(
			and(
				eq(smtpAccount.smtpAccountId, smtpAccountId),
				eq(smtpAccount.accountId, accountId)
			)
		).get();

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
			secure: smtpAccountData.secure ?? 0,
			authType: smtpAccountData.authType || 'plain'
		});
	}
};

export default smtpAccountService;