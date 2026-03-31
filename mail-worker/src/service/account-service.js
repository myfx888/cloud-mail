import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import userService from './user-service';
import emailService from './email-service';
import orm from '../entity/orm';
import account from '../entity/account';
import { and, asc, eq, gt, inArray, count, sql, ne, or, lt, desc } from 'drizzle-orm';
import {accountConst, isDel, settingConst} from '../const/entity-const';
import settingService from './setting-service';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import { t } from '../i18n/i18n';
import verifyRecordService from './verify-record-service';
import mailcowService from './mailcow-service';

const accountService = {

	getDefaultSmtpServer(settings) {
		const smtpServers = Array.isArray(settings?.smtpServers) ? settings.smtpServers : [];
		if (!smtpServers.length) return null;
		return smtpServers.find(item => item?.isDefault) || smtpServers[0];
	},

	async applyMailcowSmtpConfig(c, accountId, mailcowAccount) {
		await this.updateSmtpConfig(c, accountId, {
			smtpOverride: 1,
			smtpHost: mailcowAccount.smtpHost,
			smtpPort: mailcowAccount.smtpPort,
			smtpUser: mailcowAccount.smtpUser,
			smtpPassword: mailcowAccount.password,
			smtpSecure: mailcowAccount.smtpSecure,
			smtpAuthType: mailcowAccount.smtpAuthType || 'plain',
			mailcowServerId: mailcowAccount.mailcowServerId || ''
		});
	},

	async provisionMailcowForAccount(c, accountRow, settings) {
		const targetServer = await mailcowService.getServerById(c, accountRow.mailcowServerId || '');
		const exists = await mailcowService.accountExists(c, accountRow.email, targetServer);

		if (exists) {
			const smtpConfig = await mailcowService.getSmtpConfig(c, targetServer);
			const resolvedPassword = await mailcowService.resolvePassword(c);
			const existedAccount = {
				email: accountRow.email,
				password: resolvedPassword,
				smtpHost: smtpConfig.smtpHost,
				smtpPort: smtpConfig.smtpPort,
				smtpSecure: smtpConfig.smtpSecure,
				smtpAuthType: smtpConfig.smtpAuthType,
				smtpUser: accountRow.email,
				mailcowServerId: targetServer?.id || ''
			};
			await this.applyMailcowSmtpConfig(c, accountRow.accountId, existedAccount);
			return {
				mailcowStatus: 'exists_as_success',
				mailcowAccount: existedAccount
			};
		}

		const mailcowAccount = await mailcowService.createAccount(c, accountRow.email, '', targetServer);
		await this.applyMailcowSmtpConfig(c, accountRow.accountId, mailcowAccount);
		return {
			mailcowStatus: 'success',
			mailcowAccount
		};
	},

	async add(c, params, userId) {

		const { addEmailVerify , addEmail, manyEmail, addVerifyCount, minEmailPrefix, emailPrefixFilter } = await settingService.query(c);

		let { email, token } = params;


		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			throw new BizError(t('addAccountDisabled'));
		}


		if (!email) {
			throw new BizError(t('emptyEmail'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notExistDomain'));
		}

		if (emailUtils.getName(email).length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix } ));
		}

		if (emailPrefixFilter.some(content => emailUtils.getName(email).includes(content))) {
			throw new BizError(t('banEmailPrefix'));
		}

		let accountRow = await this.selectByEmailIncludeDel(c, email);

		if (accountRow && accountRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelAccount'));
		}

		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		if (userRow.email !== c.env.admin) {

			if (roleRow.accountCount > 0) {
				const userAccountCount = await accountService.countUserAccount(c, userId)
				if(userAccountCount >= roleRow.accountCount) throw new BizError(t('accountLimit'), 403);
			}

			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
				throw new BizError(t('noDomainPermAdd'),403)
			}

		}

		let addVerifyOpen = false

		if (addEmailVerify === settingConst.addEmailVerify.OPEN) {
			addVerifyOpen = true
			await turnstileService.verify(c, token);
		}

		if (addEmailVerify === settingConst.addEmailVerify.COUNT) {
			addVerifyOpen = await verifyRecordService.isOpenAddVerify(c, addVerifyCount);
			if (addVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}


		accountRow = await orm(c).insert(account).values({ email: email, userId: userId, name: emailUtils.getName(email) }).returning().get();

		// 集成 mailcow 功能
		const settings = await settingService.query(c);
		const defaultSmtpServer = this.getDefaultSmtpServer(settings);
		if (defaultSmtpServer?.id) {
			await orm(c).update(account).set({ smtpServerId: String(defaultSmtpServer.id) }).where(eq(account.accountId, accountRow.accountId)).run();
			accountRow.smtpServerId = String(defaultSmtpServer.id);
		}

		let targetMailcowServer = null;
		try {
			targetMailcowServer = await mailcowService.getDefaultServer(c);
		} catch (_) {
			targetMailcowServer = null;
		}
		if (targetMailcowServer?.id) {
			await orm(c).update(account).set({ mailcowServerId: String(targetMailcowServer.id) }).where(eq(account.accountId, accountRow.accountId)).run();
			accountRow.mailcowServerId = String(targetMailcowServer.id);
		}

		if (settings.mailcowEnabled) {
			try {
				const provisionResult = await this.provisionMailcowForAccount(c, accountRow, settings);
				accountRow.mailcowAccount = provisionResult.mailcowAccount;
				accountRow.mailcowStatus = provisionResult.mailcowStatus;
			} catch (error) {
				console.error('mailcow account creation failed:', error);
				if (Number(settings.mailcowCreateStrict || 0) === 1) {
					await orm(c).delete(account).where(eq(account.accountId, accountRow.accountId)).run();
					throw error;
				}
				accountRow.mailcowStatus = 'failed';
				accountRow.mailcowError = error.message;
			}
		}

		if (addEmailVerify === settingConst.addEmailVerify.COUNT && !addVerifyOpen) {
			const row = await verifyRecordService.increaseAddCount(c);
			addVerifyOpen = row.count >= addVerifyCount
		}

		accountRow.addVerifyOpen = addVerifyOpen
		return accountRow;
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(account).where(sql`${account.email} COLLATE NOCASE = ${email}`).get();
	},

	list(c, params, userId) {

		let { accountId, size, lastSort } = params;

		accountId = Number(accountId);
		size = Number(size);
		lastSort = Number(lastSort);

		if (size > 30) {
			size = 30;
		}

		if (!accountId) {
			accountId = 0;
		}

		if(Number.isNaN(lastSort)) {
			lastSort = 9999999999;
		}

		return orm(c).select().from(account).where(
			and(
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL),
					or(
						lt(account.sort, lastSort),
						and(
							eq(account.sort, lastSort),
							gt(account.accountId, accountId)
						)
					))
				)
			.orderBy(desc(account.sort), asc(account.accountId))
			.limit(size)
			.all();
	},

	async delete(c, params, userId) {

		let { accountId } = params;

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectById(c, accountId);

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		if (accountRow.userId !== user.userId) {
			throw new BizError(t('noUserAccount'));
		}

		await orm(c).update(account).set({ isDel: isDel.DELETE }).where(
			and(eq(account.userId, userId),
				eq(account.accountId, accountId)))
			.run();
	},

	selectById(c, accountId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		await orm(c).insert(account).values({ ...params }).returning();
	},

	async insertList(c, list) {
		await orm(c).insert(account).values(list).run();
	},

	async physicsDeleteByUserIds(c, userIds) {
		await emailService.physicsDeleteUserIds(c, userIds);
		await orm(c).delete(account).where(inArray(account.userId,userIds)).run();
	},

	async selectUserAccountCountList(c, userIds, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: account.userId,
				count: count(account.accountId)
			})
			.from(account)
			.where(and(
				inArray(account.userId, userIds),
				eq(account.isDel, del)
			))
			.groupBy(account.userId)
		return result;
	},

	async countUserAccount(c, userId) {
		const { num } = await orm(c).select({num: count()}).from(account).where(and(eq(account.userId, userId),eq(account.isDel, isDel.NORMAL))).get();
		return num;
	},

	async countByMailcowServerId(c, mailcowServerId) {
		const { num } = await orm(c)
			.select({ num: count() })
			.from(account)
			.where(and(
				eq(account.mailcowServerId, String(mailcowServerId || '')),
				eq(account.isDel, isDel.NORMAL)
			))
			.get();
		return Number(num || 0);
	},

	async restoreByEmail(c, email) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.email, email)).run();
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.userId, userId)).run();
	},

	async setName(c, params, userId) {
		const { name, accountId } = params
		if (name.length > 30) {
			throw new BizError(t('usernameLengthLimit'));
		}
		await orm(c).update(account).set({name}).where(and(eq(account.userId, userId),eq(account.accountId, accountId))).run();
	},

	async allAccount(c, params) {

		let { userId, num, size } = params

		userId = Number(userId)

		num = Number(num)
		size = Number(size)

		if (size > 30) {
			size = 30;
		}

		num = (num - 1) * size;

		const userRow = await userService.selectById(c, userId);

		const list = await orm(c).select().from(account).where(and(eq(account.userId, userId),ne(account.email,userRow.email))).limit(size).offset(num);
		const { total } = await orm(c).select({ total: count() }).from(account).where(eq(account.userId, userId)).get();

		return { list, total }
	},

	async physicsDelete(c, params) {
		const { accountId } = params
		await emailService.physicsDeleteByAccountId(c, accountId)
		await orm(c).delete(account).where(eq(account.accountId, accountId)).run();
	},

	async setAllReceive(c, params, userId) {
		let a = null
		const { accountId } = params;
		const accountRow = await this.selectById(c, accountId);
		if (accountRow.userId !== userId) {
			return;
		}
		await orm(c).update(account).set({ allReceive: accountConst.allReceive.CLOSE }).where(eq(account.userId, userId)).run();
		await orm(c).update(account).set({ allReceive: accountRow.allReceive ? 0 : 1 }).where(eq(account.accountId, accountId)).run();
	},

	async setAsTop(c, params, userId) {
		const { accountId } = params;
		console.log(accountId);
		const userRow = await userService.selectById(c, userId);
		const mainAccountRow = await accountService.selectByEmailIncludeDel(c, userRow.email);
		let mainSort = mainAccountRow.sort === 0 ? 2 : mainAccountRow.sort + 1;
		await orm(c).update(account).set({ sort: mainSort }).where(eq(account.email, userRow.email )).run();
		await orm(c).update(account).set({ sort: mainSort - 1 }).where(and(eq(account.accountId, accountId),eq(account.userId,userId))).run();
	},

	async updateSmtpConfig(c, accountId, config) {
		const updateData = {
			smtpOverride: config.smtpOverride,
			smtpHost: config.smtpHost,
			smtpPort: config.smtpPort,
			smtpUser: config.smtpUser,
			smtpSecure: config.smtpSecure,
			smtpAuthType: config.smtpAuthType || 'plain'
		};

		if (config.smtpServerId !== undefined) {
			updateData.smtpServerId = config.smtpServerId;
		}
		if (config.mailcowServerId !== undefined) {
			updateData.mailcowServerId = config.mailcowServerId;
		}
		
		// 只有提供密码时才更新
		if (config.smtpPassword) {
			updateData.smtpPassword = config.smtpPassword;
		}
		
		await orm(c).update(account).set(updateData).where(eq(account.accountId, accountId)).run();
	},

	async retryMailcow(c, accountId, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}

		const settings = await settingService.query(c);
		if (!settings.mailcowEnabled) {
			throw new BizError('mailcow is disabled');
		}

		const provisionResult = await this.provisionMailcowForAccount(c, accountRow, settings);
		return {
			accountId,
			mailcowStatus: provisionResult.mailcowStatus,
			mailcowAccount: provisionResult.mailcowAccount
		};
	},

	async switchSmtpServer(c, accountId, smtpServerId, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}

		const settings = await settingService.query(c);
		const smtpServers = Array.isArray(settings.smtpServers) ? settings.smtpServers : [];
		const targetServer = smtpServers.find(item => String(item.id) === String(smtpServerId));
		if (!targetServer) {
			throw new BizError('smtp server not found');
		}

		await this.updateSmtpConfig(c, accountId, {
			smtpOverride: 1,
			smtpHost: targetServer.smtpHost,
			smtpPort: Number(targetServer.smtpPort || 587),
			smtpUser: targetServer.smtpUser || accountRow.email,
			smtpSecure: Number(targetServer.smtpSecure ?? 0),
			smtpAuthType: targetServer.smtpAuthType || 'plain',
			smtpServerId: String(targetServer.id)
		});

		return {
			accountId,
			smtpServerId: String(targetServer.id)
		};
	},

	// 签名管理相关方法
	async getSignatures(c, accountId, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
		
		try {
			return JSON.parse(accountRow.signatures || '[]');
		} catch (e) {
			return [];
		}
	},

	async addSignature(c, accountId, signatureData, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
		
		const signatures = JSON.parse(accountRow.signatures || '[]');
		
		// 生成唯一ID
		const signatureId = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		const newSignature = {
			id: signatureId,
			name: signatureData.name || '新签名',
			content: signatureData.content || '',
			isDefault: signatureData.isDefault || false
		};
		
		// 如果设置为默认，将其他签名的默认标志设为false
		if (newSignature.isDefault) {
			signatures.forEach(sig => {
				sig.isDefault = false;
			});
		}
		
		signatures.push(newSignature);
		
		await orm(c).update(account)
			.set({ signatures: JSON.stringify(signatures) })
			.where(eq(account.accountId, accountId))
			.run();
		
		return newSignature;
	},

	async updateSignature(c, accountId, signatureId, signatureData, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
		
		const signatures = JSON.parse(accountRow.signatures || '[]');
		const signatureIndex = signatures.findIndex(sig => sig.id === signatureId);
		
		if (signatureIndex === -1) {
			throw new BizError(t('signatureNotExist'));
		}
		
		// 如果设置为默认，将其他签名的默认标志设为false
		if (signatureData.isDefault) {
			signatures.forEach(sig => {
				sig.isDefault = false;
			});
		}
		
		// 更新签名
		signatures[signatureIndex] = {
			...signatures[signatureIndex],
			name: signatureData.name || signatures[signatureIndex].name,
			content: signatureData.content || signatures[signatureIndex].content,
			isDefault: signatureData.isDefault !== undefined ? signatureData.isDefault : signatures[signatureIndex].isDefault
		};
		
		await orm(c).update(account)
			.set({ signatures: JSON.stringify(signatures) })
			.where(eq(account.accountId, accountId))
			.run();
		
		return signatures[signatureIndex];
	},

	async deleteSignature(c, accountId, signatureId, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
		
		const signatures = JSON.parse(accountRow.signatures || '[]');
		const signatureIndex = signatures.findIndex(sig => sig.id === signatureId);
		
		if (signatureIndex === -1) {
			throw new BizError(t('signatureNotExist'));
		}
		
		// 删除签名
		signatures.splice(signatureIndex, 1);
		
		// 如果删除的是默认签名，将第一个签名设为默认
		if (signatures.length > 0 && !signatures.some(sig => sig.isDefault)) {
			signatures[0].isDefault = true;
		}
		
		await orm(c).update(account)
			.set({ signatures: JSON.stringify(signatures) })
			.where(eq(account.accountId, accountId))
			.run();
	},

	async setDefaultSignature(c, accountId, signatureId, userId) {
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		if (accountRow.userId !== userId) {
			throw new BizError(t('noUserAccount'));
		}
		
		const signatures = JSON.parse(accountRow.signatures || '[]');
		const signatureIndex = signatures.findIndex(sig => sig.id === signatureId);
		
		if (signatureIndex === -1) {
			throw new BizError(t('signatureNotExist'));
		}
		
		// 将所有签名的默认标志设为false，然后将指定签名设为默认
		signatures.forEach(sig => {
			sig.isDefault = false;
		});
		signatures[signatureIndex].isDefault = true;
		
		await orm(c).update(account)
			.set({ signatures: JSON.stringify(signatures) })
			.where(eq(account.accountId, accountId))
			.run();
	},

	async migrateAccounts(c, sourceServerId, targetServerId) {
        try {
            const sourceServer = await mailcowService.getServerById(c, sourceServerId);
            const targetServer = await mailcowService.getServerById(c, targetServerId);
            
            console.log(`Migrating accounts from server ${sourceServer.apiUrl} to ${targetServer.apiUrl}`);
            
            // Fetch all accounts from source server
            const accounts = await mailcowService.callApi(c, 'get/mailbox/all', 'GET', null, sourceServer);
            
            if (!Array.isArray(accounts)) {
                throw new BizError(t('mailcowAccountQueryFailed'));
            }
            
            console.log(`Found ${accounts.length} accounts to migrate.`);
            
            // Iterate through accounts and create them on the target server
            for (const account of accounts) {
                const email = account.username;
                console.log(`Migrating account: ${email}`);
                
                // Generate a temporary password or use a placeholder if needed
                const tempPassword = await mailcowService.resolvePassword(c);
                
                // Prepare data for creating account on target server
                const data = {
                    local_part: email.split('@')[0],
                    domain: email.split('@')[1],
                    password: tempPassword,
                    password2: tempPassword,
                    name: account.name || email,
                    quota: account.quota || 3072,
                    active: account.active || 1,
                    force_pw_update: account.force_pw_update || 0,
                    tls_enforce_in: account.tls_enforce_in || 0,
                    tls_enforce_out: account.tls_enforce_out || 0,
                    sogo_access: account.sogo_access || 1,
                    imap_access: account.imap_access || 1,
                    smtp_access: account.smtp_access || 1,
                    pop3_access: account.pop3_access || 1,
                    quarantine_access: account.quarantine_access || 0,
                    caldav_access: account.caldav_access || 1,
                    carddav_access: account.carddav_access || 1
                };
                
                // Create account on target server
                const result = await mailcowService.callApi(c, 'add/mailbox', 'POST', data, targetServer);
                
                if (!result || (Array.isArray(result) && result.length === 0) || (typeof result === 'object' && result !== null && Object.keys(result).length === 0)) {
                    console.log(`Failed to migrate account ${email} to target server, empty response received.`);
                    continue;
                }
                
                console.log(`Successfully migrated account ${email} to target server.`);
                
                // Optionally delete account from source server after successful migration
                // await mailcowService.deleteAccount(c, email, sourceServer);
            }
            
            return {
                success: true,
                message: `Successfully migrated ${accounts.length} accounts from server ${sourceServer.apiUrl} to ${targetServer.apiUrl}.`
            };
        } catch (error) {
            throw new BizError(`Failed to migrate accounts: ${error.message}`);
        }
    },

};

export default accountService;
