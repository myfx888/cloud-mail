import orm from '../entity/orm';
import { backupTask } from '../entity/backup-task';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { email } from '../entity/email';
import user from '../entity/user';
import accountEntity from '../entity/account';
import r2Service from './r2-service';
import emailService from './email-service';
import settingService from './setting-service';
import attService from './att-service';
import mboxUtils from '../utils/mbox-utils';
import tarUtils from '../utils/tar-utils';
import { sanitizeUsers, sanitizeAccounts } from '../utils/backup-utils';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { v4 as uuidv4 } from 'uuid';

const backupService = {

	BACKUP_PREFIX: 'backup/',
	STORE_PREFIX: 'restore/',
	BACKUP_BATCH: 20,
	IMPORT_BATCH: 20,

	async createTask(c, type, params, sourceKeys = []) {
		return await orm(c).insert(backupTask).values({
			type,
			status: 'pending',
			sourceKeys: JSON.stringify(sourceKeys),
			params: JSON.stringify(params || {})
		}).returning().get();
	},

	async getTask(c, taskId) {
		return orm(c).select().from(backupTask).where(eq(backupTask.taskId, taskId)).get();
	},

	async listTasks(c, type) {
		return orm(c).select().from(backupTask).where(eq(backupTask.type, type)).orderBy(desc(backupTask.taskId)).limit(50).all();
	},

	async patchTask(c, taskId, patch) {
		await orm(c).update(backupTask).set({ ...patch, updateTime: new Date().toISOString() }).where(eq(backupTask.taskId, taskId)).run();
	},

	async pushDetail(c, taskId, entry) {
		const task = await this.getTask(c, taskId);
		if (!task) return;
		let log = [];
		try { log = JSON.parse(task.detailLog || '[]'); } catch (_) {}
		log.push(entry);
		if (log.length > 100) log = log.slice(-100);
		await this.patchTask(c, taskId, { detailLog: JSON.stringify(log) });
	},

	async cancelTask(c, taskId) {
		await this.patchTask(c, taskId, { status: 'cancelled' });
	},

	async dumpConfig(c, includeSecrets) {
		const users = await orm(c).select().from(user).all();
		const accounts = await orm(c).select().from(accountEntity).all();
		return {
			users: sanitizeUsers(users, includeSecrets),
			accounts: sanitizeAccounts(accounts, includeSecrets),
			includeSecrets,
			dumpedAt: new Date().toISOString()
		};
	},

	async restoreConfig(c, config) {
		let insertedUsers = 0, insertedAccounts = 0, skippedUsers = 0, skippedAccounts = 0;
		for (const u of config.users || []) {
			const exists = await orm(c).select({ id: user.userId }).from(user).where(sql`${user.email} COLLATE NOCASE = ${u.email}`).get();
			if (exists) { skippedUsers++; continue; }
			await orm(c).insert(user).values(u).run();
			insertedUsers++;
		}
		for (const a of config.accounts || []) {
			const exists = await orm(c).select({ id: accountEntity.accountId }).from(accountEntity).where(sql`${accountEntity.email} COLLATE NOCASE = ${a.email}`).get();
			if (exists) { skippedAccounts++; continue; }
			await orm(c).insert(accountEntity).values(a).run();
			insertedAccounts++;
		}
		return { insertedUsers, skippedUsers, insertedAccounts, skippedAccounts };
	}
};

export default backupService;
