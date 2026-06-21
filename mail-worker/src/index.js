import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";
import backupService from './service/backup-service';
import settingService from './service/setting-service';
import orm from './entity/orm';
import { backupTask } from './entity/backup-task';
import { eq } from 'drizzle-orm';
import './api/smtp-api';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/init/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		}

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
		try {
			const settings = await settingService.query({ env });
			if (settings && settings.backupCron) {
				let task = await orm({ env }).select().from(backupTask).where(eq(backupTask.status, 'processing')).get();
				if (!task) {
					task = await backupService.createTask({ env }, 'backup', { scope: 'all', includeConfig: true, includeSecrets: false, schedule: 'cron' });
				}
				for (let i = 0; i < 5; i++) {
					task = await backupService.processBackupBatch({ env }, task.taskId);
					if (task.status === 'completed' || task.status === 'cancelled') break;
				}
			}
		} catch (e) {
			console.error('scheduled backup failed:', e);
		}
		try {
			await backupService.purgeExpired({ env });
		} catch (e) {
			console.error('purge expired failed:', e);
		}
	},
};
