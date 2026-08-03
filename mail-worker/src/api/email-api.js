import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';
import attService from '../service/att-service';
import { longCacheHeaders, noStoreHeaders } from '../middleware/cache-headers';

app.get('/email/list', async (c) => {
	const data = await emailService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/latest', async (c) => {
	const list = await emailService.latest(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/email/delete', async (c) => {
	await emailService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.get('/email/attList', async (c) => {
	const attList = await attService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(attList));
});

app.post('/email/send', async (c) => {
	const email = await emailService.send(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(email));
});

app.put('/email/read', async (c) => {
	await emailService.read(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

app.put('/email/restore', async (c) => {
	await emailService.restore(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

app.get('/email/export', async (c) => {
	const { emailId } = c.req.query();
	const emlContent = await emailService.exportEmail(c, Number(emailId), userContext.getUserId(c));
	c.header('Content-Type', 'message/rfc822');
	c.header('Content-Disposition', `attachment; filename="email-${emailId}.eml"`);
	return c.body(emlContent);
})

app.post('/email/import', async (c) => {
	const { emlContent, accountId } = await c.req.json();
	const email = await emailService.importEmail(c, emlContent, userContext.getUserId(c), Number(accountId));
	return c.json(result.ok(email));
})

// 单封邮件正文（content + text），长缓存（7天 immutable）
// noCache 中间件已对 /email/content/ 放行，此处自行设长缓存头
app.get('/email/content/:emailId', async (c) => {
	const emailId = Number(c.req.param('emailId'));
	const userId = userContext.getUserId(c);
	try {
		const data = await emailService.getContent(c, emailId, userId);
		longCacheHeaders(c);
		return c.json(result.ok(data));
	} catch (e) {
		// 404/403 错误不缓存（避免错误响应被边缘缓存）
		noStoreHeaders(c);
		throw e;
	}
})

