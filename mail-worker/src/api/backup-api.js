import app from '../hono/hono';
import backupService from '../service/backup-service';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

function assertAdmin(c) {
	if (!userContext.isAdmin(c)) {
		throw new BizError(t('unauthorized'), 403);
	}
}

app.post('/admin/backup/create', async (c) => {
	assertAdmin(c);
	const body = await c.req.json();
	const task = await backupService.createTask(c, 'backup', {
		scope: body.scope || 'all',
		filter: body.filter || {},
		includeConfig: body.includeConfig !== false,
		includeSecrets: !!body.includeSecrets,
		schedule: body.schedule || 'once'
	});
	return c.json(result.ok(task));
});

app.post('/admin/backup/:taskId/process', async (c) => {
	assertAdmin(c);
	const task = await backupService.processBackupBatch(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/backup/:taskId/progress', async (c) => {
	assertAdmin(c);
	const task = await backupService.getTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/backup/list', async (c) => {
	assertAdmin(c);
	return c.json(result.ok(await backupService.listBackups(c)));
});

app.get('/admin/backup/:backupId/download', async (c) => {
	assertAdmin(c);
	const tar = await backupService.getBackupTar(c, Number(c.req.param('backupId')));
	return new Response(tar, {
		headers: {
			'Content-Type': 'application/x-tar',
			'Content-Disposition': `attachment; filename="backup-${c.req.param('backupId')}.tar"`
		}
	});
});

app.delete('/admin/backup/:backupId', async (c) => {
	assertAdmin(c);
	await backupService.deleteBackup(c, Number(c.req.param('backupId')));
	return c.json(result.ok());
});

app.post('/admin/restore/upload', async (c) => {
	assertAdmin(c);
	const form = await c.req.formData();
	const files = [];
	for (const [name, value] of form.entries()) {
		if (value instanceof File) {
			const buf = new Uint8Array(await value.arrayBuffer());
			files.push({ filename: value.name, content: buf });
		}
	}
	const keys = await backupService.uploadFiles(c, files);
	return c.json(result.ok({ sourceKeys: keys }));
});

app.post('/admin/restore/create', async (c) => {
	assertAdmin(c);
	const body = await c.req.json();
	const task = await backupService.createRestoreTask(c, body.sourceKeys || [], body.mode || 'import', body.dedup || 'skip');
	return c.json(result.ok(task));
});

app.post('/admin/restore/:taskId/process', async (c) => {
	assertAdmin(c);
	const task = await backupService.processImportBatch(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/restore/:taskId/progress', async (c) => {
	assertAdmin(c);
	const task = await backupService.getTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/restore/task/list', async (c) => {
	assertAdmin(c);
	const type = c.req.query('type') || 'import';
	return c.json(result.ok(await backupService.listTasks(c, type)));
});

app.post('/admin/backup-task/:taskId/cancel', async (c) => {
	assertAdmin(c);
	await backupService.cancelTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok());
});
