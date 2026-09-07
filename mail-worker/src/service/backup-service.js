import orm from '../entity/orm';
import { backupTask } from '../entity/backup-task';
import { eq, asc, desc, sql, lt } from 'drizzle-orm';
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

	// C3 白名单字段防权限提升（强制 type=1、清空 password/salt）；W2 逐行 try/catch + 剥离自增 id 维护映射
	async restoreConfig(c, config, taskId) {
		let insertedUsers = 0, insertedAccounts = 0, skippedUsers = 0, skippedAccounts = 0, failed = 0;
		const userIdMap = {}, accountIdMap = {};
		for (const u of config.users || []) {
			const exists = await orm(c).select({ id: user.userId }).from(user).where(sql`${user.email} COLLATE NOCASE = ${u.email}`).get();
			if (exists) { skippedUsers++; userIdMap[u.userId] = exists.id; continue; }
			try {
				const safe = {
					email: u.email,
					type: 1,
					password: '',
					salt: '',
					status: 0,
					createTime: u.createTime,
					isDel: 0
				};
				const row = await orm(c).insert(user).values(safe).returning().get();
				userIdMap[u.userId] = row.userId;
				insertedUsers++;
			} catch (e) {
				failed++;
				if (taskId) await this.pushDetail(c, taskId, { email: u.email, reason: 'user restore: ' + e.message });
			}
		}
		for (const a of config.accounts || []) {
			const mappedUserId = userIdMap[a.userId] || a.userId;
			const exists = await orm(c).select({ id: accountEntity.accountId }).from(accountEntity).where(sql`${accountEntity.email} COLLATE NOCASE = ${a.email}`).get();
			if (exists) { skippedAccounts++; accountIdMap[a.accountId] = exists.id; continue; }
			try {
				const safe = {
					email: a.email,
					name: a.name || '',
					status: a.status ?? 0,
					createTime: a.createTime,
					userId: mappedUserId,
					allReceive: a.allReceive ?? 0,
					sort: a.sort ?? 0,
					isDel: 0
				};
				const row = await orm(c).insert(accountEntity).values(safe).returning().get();
				accountIdMap[a.accountId] = row.accountId;
				insertedAccounts++;
			} catch (e) {
				failed++;
				if (taskId) await this.pushDetail(c, taskId, { email: a.email, reason: 'account restore: ' + e.message });
			}
		}
		return { insertedUsers, skippedUsers, insertedAccounts, skippedAccounts, failed };
	},

	// C4 分片写入（每批独立 part，避免读-改-写 O(n²)）；W4 一次性批量查附件
	async processBackupBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') {
			await this.patchTask(c, taskId, { status: 'processing' });
			await this.patchTask(c, taskId, { total: await this._countEmails(c) });
		}
		const cur = await this.getTask(c, taskId);
		const rows = await this._selectEmailBatch(c, cur.cursor, this.BACKUP_BATCH);
		if (rows.length === 0) {
			await this.finalizeBackup(c, taskId);
			return await this.getTask(c, taskId);
		}
		const emailIds = rows.map(r => r.emailId);
		const allAtt = await attService.selectByEmailIds(c, emailIds);
		const attMap = {};
		allAtt.forEach(a => { (attMap[a.emailId] = attMap[a.emailId] || []).push(a); });
		let mboxChunk = '';
		let lastId = cur.cursor;
		for (const row of rows) {
			try {
				const eml = await emailService.generateEml(row, attMap[row.emailId] || [], c);
				mboxChunk = mboxUtils.appendEntry(mboxChunk, eml);
				lastId = row.emailId;
			} catch (e) {
				await this.pushDetail(c, taskId, { emailId: row.emailId, reason: e.message });
			}
		}
		const partKey = `${this.BACKUP_PREFIX}${taskId}/part-${cur.processed}.mbox`;
		await r2Service.putObj(c, partKey, mboxChunk, { contentType: 'application/mbox' });
		await this.patchTask(c, taskId, { cursor: lastId, processed: cur.processed + rows.length });
		return await this.getTask(c, taskId);
	},

	async finalizeBackup(c, taskId) {
		const task = await this.getTask(c, taskId);
		const params = JSON.parse(task.params || '{}');
		let combined = '';
		for (let i = 0; i < task.processed; i += this.BACKUP_BATCH) {
			const partKey = `${this.BACKUP_PREFIX}${taskId}/part-${i}.mbox`;
			const obj = await r2Service.getObj(c, partKey);
			if (obj) {
				combined += await obj.text();
				try { await r2Service.delete(c, partKey); } catch (_) {}
			}
		}
		await r2Service.putObj(c, `${this.BACKUP_PREFIX}${taskId}/emails.mbox`, combined, { contentType: 'application/mbox' });
		const config = params.includeConfig ? await this.dumpConfig(c, !!params.includeSecrets) : null;
		const manifest = {
			version: 1,
			createdAt: new Date().toISOString(),
			emailCount: task.processed,
			includeConfig: !!params.includeConfig,
			includeSecrets: !!params.includeSecrets,
			sensitivity: params.includeSecrets ? 'confidential' : 'normal'
		};
		await r2Service.putObj(c, `${this.BACKUP_PREFIX}${taskId}/manifest.json`, JSON.stringify(manifest, null, 2), { contentType: 'application/json' });
		if (config) {
			await r2Service.putObj(c, `${this.BACKUP_PREFIX}${taskId}/config.json`, JSON.stringify(config, null, 2), { contentType: 'application/json' });
		}
		const expire = new Date(Date.now() + 30 * 86400000).toISOString();
		await this.patchTask(c, taskId, { status: 'completed', resultKey: `${this.BACKUP_PREFIX}${taskId}/`, expireTime: expire });
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

	// W1 校验 sourceKeys 必须位于 restore/ 前缀
	async createRestoreTask(c, sourceKeys, mode, dedup) {
		for (const k of sourceKeys || []) {
			if (!k.startsWith(this.STORE_PREFIX) || k.includes('..') || k.includes('\0')) {
				throw new BizError('invalid source key');
			}
		}
		return this.createTask(c, mode === 'restore' ? 'restore' : 'import', { mode, dedup: dedup || 'skip' }, sourceKeys);
	},

	async processImportBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') await this.patchTask(c, taskId, { status: 'processing' });
		const cur = await this.getTask(c, taskId);
		const sourceKeys = JSON.parse(cur.sourceKeys || '[]');
		if (cur.fileIndex >= sourceKeys.length) {
			await this._completeRestore(c, taskId, sourceKeys);
			return await this.getTask(c, taskId);
		}
		const key = sourceKeys[cur.fileIndex];
		const { r2Domain } = await settingService.query(c);

		// 读首块 512 字节检测类型（不全量读）
		const headObj = await r2Service.getObjRange(c, key, 0, 512);
		if (!headObj) {
			await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
			return await this.getTask(c, taskId);
		}
		const headBytes = new Uint8Array(await headObj.arrayBuffer());
		const headText = new TextDecoder().decode(headBytes);
		const isTar = headBytes.length > 265 && new TextDecoder().decode(headBytes.slice(257, 262)) === 'ustar';
		const isMbox = headText.startsWith('From ') || headText.includes('\nFrom ');
		const isConfig = cur.cursor === 0 && headText.trim().startsWith('{') && headText.includes('"users"');

		let processed = cur.processed, skipped = cur.skipped, failed = cur.failed;

		if (isTar) {
			const fullObj = await r2Service.getObj(c, key);
			const entries = tarUtils.unpack(new Uint8Array(await fullObj.arrayBuffer()));
			if (entries['config.json']) {
				try { await this.restoreConfig(c, JSON.parse(entries['config.json']), taskId); }
				catch (e) { await this.pushDetail(c, taskId, { file: key, reason: 'config: ' + e.message }); }
			}
			if (entries['emails.mbox']) {
				const mboxKey = this.STORE_PREFIX + taskId + '/extracted-emails.mbox';
				await r2Service.putObj(c, mboxKey, entries['emails.mbox'], { contentType: 'application/mbox' });
				sourceKeys[cur.fileIndex] = mboxKey;
				try { await r2Service.delete(c, key); } catch (_) {}
				await this.patchTask(c, taskId, { sourceKeys: JSON.stringify(sourceKeys), cursor: 0 });
			} else {
				try { await r2Service.delete(c, key); } catch (_) {}
				await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
			}
			return await this.getTask(c, taskId);
		}

		if (isConfig) {
			const fullObj = await r2Service.getObj(c, key);
			try { await this.restoreConfig(c, JSON.parse(await fullObj.text()), taskId); }
			catch (e) { await this.pushDetail(c, taskId, { file: key, reason: 'config restore: ' + e.message }); }
			await this.patchTask(c, taskId, { cursor: 1 });
			return await this.getTask(c, taskId);
		}

		if (isMbox) {
			// 流式：每次 range 读 4MB chunk，字节级切分，不全量入内存
			const READ_SIZE = 4 * 1024 * 1024;
			const rangeObj = await r2Service.getObjRange(c, key, cur.cursor, READ_SIZE);
			if (!rangeObj) {
				await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
				return await this.getTask(c, taskId);
			}
			const chunk = new Uint8Array(await rangeObj.arrayBuffer());
			const isEof = chunk.length < READ_SIZE;
			const r = mboxUtils.findMessagesInBytes(chunk, cur.cursor, this.IMPORT_BATCH, isEof);
			for (const msgBytes of r.messages) {
				try {
					let raw = new TextDecoder().decode(msgBytes);
					raw = raw.replace(/^>From /gm, 'From ').replace(/\n>From /g, '\nFrom ');
					const parsed = await parseEmailRaw(raw);
					const res = await emailService.importSingleEmail(c, parsed, { r2Domain });
					processed += res.imported || 0; skipped += res.skipped || 0;
				} catch (e) {
					failed++;
					await this.pushDetail(c, taskId, { file: key, reason: e.message });
				}
			}
			const patch = { processed, skipped, failed };
			if (r.done) { patch.fileIndex = cur.fileIndex + 1; patch.cursor = 0; }
			else { patch.cursor = r.nextCursor; }
			await this.patchTask(c, taskId, patch);
			return await this.getTask(c, taskId);
		}

		// EML 单封：R2 走 postal-mime 流式（obj.body），S3/KV 全量读
		const emlObj = await r2Service.getObj(c, key);
		try {
			const parsed = emlObj.body
				? await parseEmailRaw(emlObj.body)
				: await parseEmailRaw(new Uint8Array(await emlObj.arrayBuffer()));
			const res = await emailService.importSingleEmail(c, parsed, { r2Domain });
			processed += res.imported || 0; skipped += res.skipped || 0;
		} catch (e) {
			failed++;
			await this.pushDetail(c, taskId, { file: key, reason: e.message });
		}
		try { await r2Service.delete(c, key); } catch (_) {}
		await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0, processed, skipped, failed });
		return await this.getTask(c, taskId);
	},

	// W3 任务完成时清理 restore/* 源对象
	async _completeRestore(c, taskId, sourceKeys) {
		for (const k of sourceKeys || []) {
			try { await r2Service.delete(c, k); } catch (_) {}
		}
		await this.patchTask(c, taskId, { status: 'completed', expireTime: new Date().toISOString() });
	},

	// W3 清扫过期任务（由 scheduled 调用）
	async purgeExpired(c) {
		const now = new Date().toISOString();
		const tasks = await orm(c).select().from(backupTask).where(lt(backupTask.expireTime, now)).limit(20).all();
		for (const task of tasks) {
			if (task.resultKey) {
				for (const name of ['manifest.json', 'emails.mbox', 'config.json']) {
					try { await r2Service.delete(c, task.resultKey + name); } catch (_) {}
				}
			}
			try { await orm(c).delete(backupTask).where(eq(backupTask.taskId, task.taskId)).run(); } catch (_) {}
		}
	}
};

export default backupService;
