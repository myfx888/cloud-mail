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
import { parseEmailRaw } from '../utils/eml-utils';
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
	},

	async processBackupBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') {
			await this.patchTask(c, taskId, { status: 'processing' });
			const total = await this._countEmails(c);
			await this.patchTask(c, taskId, { total });
		}
		const refreshed = await this.getTask(c, taskId);
		const rows = await this._selectEmailBatch(c, refreshed.cursor, this.BACKUP_BATCH);
		if (rows.length === 0) {
			await this.finalizeBackup(c, taskId);
			return await this.getTask(c, taskId);
		}
		let mboxChunk = '';
		let lastId = refreshed.cursor;
		for (const row of rows) {
			try {
				const attList = await attService.selectByEmailIds(c, [row.emailId]);
				const eml = await emailService.generateEml(row, attList, c);
				mboxChunk = mboxUtils.appendEntry(mboxChunk, eml);
				lastId = row.emailId;
			} catch (e) {
				await this.pushDetail(c, taskId, { emailId: row.emailId, reason: e.message });
			}
		}
		const key = this.BACKUP_PREFIX + taskId + '/emails.mbox';
		const existing = await r2Service.getObj(c, key);
		const prevText = existing ? await existing.text() : '';
		await r2Service.putObj(c, key, prevText + mboxChunk, { contentType: 'application/mbox' });
		await this.patchTask(c, taskId, {
			cursor: lastId,
			processed: refreshed.processed + rows.length
		});
		return await this.getTask(c, taskId);
	},

	async finalizeBackup(c, taskId) {
		const task = await this.getTask(c, taskId);
		const params = JSON.parse(task.params || '{}');
		const config = params.includeConfig ? await this.dumpConfig(c, !!params.includeSecrets) : null;
		const manifest = {
			version: 1,
			createdAt: new Date().toISOString(),
			emailCount: task.processed,
			includeConfig: !!params.includeConfig,
			includeSecrets: !!params.includeSecrets,
			sensitivity: params.includeSecrets ? 'confidential' : 'normal'
		};
		await r2Service.putObj(c, this.BACKUP_PREFIX + taskId + '/manifest.json', JSON.stringify(manifest, null, 2), { contentType: 'application/json' });
		if (config) {
			await r2Service.putObj(c, this.BACKUP_PREFIX + taskId + '/config.json', JSON.stringify(config, null, 2), { contentType: 'application/json' });
		}
		await this.patchTask(c, taskId, { status: 'completed', resultKey: this.BACKUP_PREFIX + taskId + '/', updateTime: new Date().toISOString() });
	},

	async _countEmails(c) {
		const r = await orm(c).select({ n: sql`COUNT(*)` }).from(email).get();
		return Number(r?.n || 0);
	},

	async _selectEmailBatch(c, cursor, size) {
		return orm(c).select().from(email).where(sql`${email.emailId} > ${cursor}`).orderBy(asc(email.emailId)).limit(size).all();
	},

	async listBackups(c) {
		return this.listTasks(c, 'backup');
	},

	async getBackupTar(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || !task.resultKey) throw new BizError(t('notExistEmail'));
		const prefix = task.resultKey;
		const entries = [];
		for (const name of ['manifest.json', 'emails.mbox', 'config.json']) {
			const obj = await r2Service.getObj(c, prefix + name);
			if (obj) entries.push({ name, data: await obj.text() });
		}
		if (entries.length === 0) throw new BizError('backup empty');
		return tarUtils.pack(entries);
	},

	async deleteBackup(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (task && task.resultKey) {
			for (const name of ['manifest.json', 'emails.mbox', 'config.json']) {
				try { await r2Service.delete(c, task.resultKey + name); } catch (_) {}
			}
		}
		await orm(c).delete(backupTask).where(eq(backupTask.taskId, taskId)).run();
	},

	async uploadFiles(c, files) {
		const keys = [];
		for (const f of files) {
			const key = this.STORE_PREFIX + uuidv4().replace(/-/g, '') + '/' + encodeURIComponent(f.filename || 'file');
			const body = f.content instanceof Uint8Array ? f.content : new TextEncoder().encode(f.content);
			await r2Service.putObj(c, key, body, { contentType: 'application/octet-stream' });
			keys.push(key);
		}
		return keys;
	},

	async createRestoreTask(c, sourceKeys, mode, dedup) {
		return this.createTask(c, mode === 'restore' ? 'restore' : 'import', { mode, dedup: dedup || 'skip' }, sourceKeys);
	},

	async processImportBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') await this.patchTask(c, taskId, { status: 'processing' });
		const cur = await this.getTask(c, taskId);
		const sourceKeys = JSON.parse(cur.sourceKeys || '[]');
		if (cur.fileIndex >= sourceKeys.length) {
			await this.patchTask(c, taskId, { status: 'completed' });
			return await this.getTask(c, taskId);
		}
		const key = sourceKeys[cur.fileIndex];
		const obj = await r2Service.getObj(c, key);
		if (!obj) {
			await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
			return await this.getTask(c, taskId);
		}
		const ab = await obj.arrayBuffer();
		const bytes = new Uint8Array(ab);

		const isTar = bytes.length > 265 && new TextDecoder().decode(bytes.slice(257, 262)) === 'ustar';
		if (isTar) {
			const entries = tarUtils.unpack(bytes);
			if (entries['config.json']) {
				try { await this.restoreConfig(c, JSON.parse(entries['config.json'])); }
				catch (e) { await this.pushDetail(c, taskId, { file: key, reason: 'config: ' + e.message }); }
			}
			if (entries['emails.mbox']) {
				const mboxKey = this.STORE_PREFIX + taskId + '/extracted-emails.mbox';
				await r2Service.putObj(c, mboxKey, entries['emails.mbox'], { contentType: 'application/mbox' });
				sourceKeys[cur.fileIndex] = mboxKey;
				await this.patchTask(c, taskId, { sourceKeys: JSON.stringify(sourceKeys) });
			} else {
				await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
			}
			return await this.getTask(c, taskId);
		}

		const text = new TextDecoder().decode(bytes);
		const { r2Domain } = await settingService.query(c);

		let isBackupConfig = false;
		if (cur.cursor === 0) {
			const trimmed = text.trim();
			if (trimmed.startsWith('{') && trimmed.includes('"users"') && trimmed.includes('"accounts"')) {
				isBackupConfig = true;
			}
		}
		if (isBackupConfig) {
			try {
				await this.restoreConfig(c, JSON.parse(text));
			} catch (e) {
				await this.pushDetail(c, taskId, { file: key, reason: 'config restore: ' + e.message });
			}
			await this.patchTask(c, taskId, { cursor: 1 });
			return await this.getTask(c, taskId);
		}

		let messages = [];
		let nextCursor = 0;
		let advanceFile = false;

		if (text.includes('\nFrom ') || text.startsWith('From ')) {
			const r = mboxUtils.splitNextBatch(text, cur.cursor, this.IMPORT_BATCH);
			messages = r.messages;
			nextCursor = r.nextCursor;
			advanceFile = r.done;
		} else {
			messages = [text];
			advanceFile = true;
		}

		let processed = cur.processed, skipped = cur.skipped, failed = cur.failed;
		for (const raw of messages) {
			try {
				const parsed = await parseEmailRaw(raw);
				const res = await emailService.importSingleEmail(c, parsed, { r2Domain });
				if (res.action === 'skipped') skipped++; else processed++;
			} catch (e) {
				failed++;
				await this.pushDetail(c, taskId, { file: key, reason: e.message });
			}
		}

		const patch = { processed, skipped, failed };
		if (advanceFile) {
			patch.fileIndex = cur.fileIndex + 1;
			patch.cursor = 0;
		} else {
			patch.cursor = nextCursor;
		}
		await this.patchTask(c, taskId, patch);
		return await this.getTask(c, taskId);
	}
};

export default backupService;
