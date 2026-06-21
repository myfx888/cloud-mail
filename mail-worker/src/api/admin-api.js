import app from '../hono/hono';
import accountService from '../service/account-service';
import memberService from '../service/member-service';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

app.get('/admin/accounts', async (c) => {
	if (!userContext.isAdmin(c)) {
		throw new BizError(t('unauthorized'), 403);
	}
	const data = await accountService.adminListAccounts(c, c.req.query());
	return c.json(result.ok(data));
});

app.get('/admin/mailbox/:accountId/members', async (c) => {
	if (!userContext.isAdmin(c)) {
		throw new BizError(t('unauthorized'), 403);
	}
	const accountId = parseInt(c.req.param('accountId'));
	return c.json(result.ok(await memberService.listMembers(c, accountId)));
});

app.post('/admin/mailbox/:accountId/members', async (c) => {
	if (!userContext.isAdmin(c)) {
		throw new BizError(t('unauthorized'), 403);
	}
	const accountId = parseInt(c.req.param('accountId'));
	const { userId } = await c.req.json();
	await memberService.join(c, accountId, Number(userId), true);
	return c.json(result.ok());
});

app.delete('/admin/mailbox/:accountId/members/:userId', async (c) => {
	if (!userContext.isAdmin(c)) {
		throw new BizError(t('unauthorized'), 403);
	}
	const accountId = parseInt(c.req.param('accountId'));
	const userId = parseInt(c.req.param('userId'));
	await memberService.leave(c, accountId, userId);
	return c.json(result.ok());
});
