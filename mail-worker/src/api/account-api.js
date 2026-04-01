import app from '../hono/hono';
import accountService from '../service/account-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/account/list', async (c) => {
	const list = await accountService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/account/delete', async (c) => {
	await accountService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.post('/account/add', async (c) => {
	const account = await accountService.add(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(account));
});

app.post('/account/:accountId/mailcow/retry', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const retryResult = await accountService.retryMailcow(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(retryResult));
});

app.post('/account/:accountId/mailcow/:mailcowServerId/provision-smtp', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const mailcowServerId = c.req.param('mailcowServerId');
	const provisionResult = await accountService.provisionSmtpByMailcowServer(
		c,
		accountId,
		mailcowServerId,
		userContext.getUserId(c)
	);
	return c.json(result.ok(provisionResult));
});

app.post('/account/:accountId/smtp/server', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const { smtpServerId } = await c.req.json();
	const switchResult = await accountService.switchSmtpServer(c, accountId, smtpServerId, userContext.getUserId(c));
	return c.json(result.ok(switchResult));
});

app.put('/account/setName', async (c) => {
	await accountService.setName(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/setAllReceive', async (c) => {
	await accountService.setAllReceive(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/setAsTop', async (c) => {
	await accountService.setAsTop(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

// 签名管理接口
app.get('/account/:accountId/signatures', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const signatures = await accountService.getSignatures(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(signatures));
});

app.post('/account/:accountId/signatures', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const signature = await accountService.addSignature(c, accountId, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(signature));
});

app.put('/account/:accountId/signatures/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const signatureId = c.req.param('signatureId');
	const signature = await accountService.updateSignature(c, accountId, signatureId, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(signature));
});

app.delete('/account/:accountId/signatures/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const signatureId = c.req.param('signatureId');
	await accountService.deleteSignature(c, accountId, signatureId, userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/:accountId/signatures/:signatureId/setDefault', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const signatureId = c.req.param('signatureId');
	await accountService.setDefaultSignature(c, accountId, signatureId, userContext.getUserId(c));
	return c.json(result.ok());
});
