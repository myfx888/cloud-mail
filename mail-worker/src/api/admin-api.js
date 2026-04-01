import app from '../hono/hono';
import accountService from '../service/account-service';
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
