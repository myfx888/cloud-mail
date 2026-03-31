import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import accountService from '../service/account-service';

export default async function handler(request, env) {
  try {
    const body = await request.json();
    const { sourceServerId, targetServerId } = body;

    if (!sourceServerId || !targetServerId) {
      throw new BizError(t('missingRequiredParameters'));
    }

    const c = { env };
    const result = await accountService.migrateAccounts(c, sourceServerId, targetServerId);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: error instanceof BizError ? 400 : 500,
    });
  }
}
