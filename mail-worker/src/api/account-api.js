import app from '../hono/hono';
import accountService from '../service/account-service';
import memberService from '../service/member-service';
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

// ===== 共享邮箱成员 =====
app.get('/mailbox/:accountId/members', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const userId = userContext.getUserId(c);
	await memberService.assertMember(c, accountId, userId);
	return c.json(result.ok(await memberService.listMembers(c, accountId)));
});

app.post('/mailbox/:accountId/leave', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	await memberService.leave(c, accountId, userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/mailbox/:accountId/signature-choice', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const { scope, sigId } = await c.req.json();
	await memberService.setLastSignature(c, accountId, userContext.getUserId(c), scope, sigId);
	return c.json(result.ok());
});

// ===== 个人签名 =====
app.get('/account/:accountId/signatures/personal', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const list = await accountService.getPersonalSignatures(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.post('/account/:accountId/signatures/personal', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const sig = await accountService.addPersonalSignature(c, accountId, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(sig));
});

app.put('/account/:accountId/signatures/personal/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const sig = await accountService.updatePersonalSignature(c, accountId, c.req.param('signatureId'), await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(sig));
});

app.delete('/account/:accountId/signatures/personal/:signatureId', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	await accountService.deletePersonalSignature(c, accountId, c.req.param('signatureId'), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/:accountId/signatures/personal/:signatureId/setDefault', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	await accountService.setDefaultPersonalSignature(c, accountId, c.req.param('signatureId'), userContext.getUserId(c));
	return c.json(result.ok());
});

// 发送签名解析（上次选择 > 共享默认 > 无）
app.get('/account/:accountId/signatures/resolve', async (c) => {
	const accountId = parseInt(c.req.param('accountId'));
	const data = await accountService.resolveSignature(c, accountId, userContext.getUserId(c));
	return c.json(result.ok(data));
});
