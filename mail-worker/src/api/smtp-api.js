import app from '../hono/hono';
import smtpService from '../service/smtp-service';
import accountService from '../service/account-service';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

// 验证全局SMTP配置
app.post('/smtp/verify', async (c) => {
	const params = await c.req.json();
	
	const smtpConfig = {
		host: params.smtpHost,
		port: params.smtpPort || 587,
		user: params.smtpUser,
		password: params.smtpPassword,
		secure: params.smtpSecure || 0,
		authType: params.smtpAuthType || 'plain'
	};
	
	if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.password) {
		throw new BizError(t('smtpConfigIncomplete'));
	}
	
	const verifyResult = await smtpService.verify(c, smtpConfig);
	return c.json(result.ok(verifyResult));
});

// 验证账号SMTP配置
app.post('/smtp/verify-account', async (c) => {
	const params = await c.req.json();
	const userId = userContext.getUserId(c);
	
	const accountRow = await accountService.selectById(c, params.accountId);
	if (!accountRow || accountRow.userId !== userId) {
		throw new BizError(t('accountNotExist'));
	}
	
	const smtpConfig = {
		host: params.smtpHost,
		port: params.smtpPort || 587,
		user: params.smtpUser,
		password: params.smtpPassword,
		secure: params.smtpSecure || 0,
		authType: params.smtpAuthType || 'plain'
	};
	
	if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.password) {
		throw new BizError(t('smtpConfigIncomplete'));
	}
	
	const verifyResult = await smtpService.verify(c, smtpConfig);
	return c.json(result.ok(verifyResult));
});

// 获取账号SMTP配置
app.get('/smtp/account-config', async (c) => {
	const { accountId } = c.req.query();
	const userId = userContext.getUserId(c);
	
	// 确保accountId是数字
	const numericAccountId = parseInt(accountId, 10);
	if (isNaN(numericAccountId)) {
		throw new BizError(t('accountNotExist'));
	}
	
	const accountRow = await accountService.selectById(c, numericAccountId);
	if (!accountRow || accountRow.userId !== userId) {
		throw new BizError(t('accountNotExist'));
	}
	
	// 返回配置（隐藏密码）
		const config = {
			smtpOverride: accountRow.smtpOverride,
			smtpHost: accountRow.smtpHost,
			smtpPort: accountRow.smtpPort,
			smtpUser: accountRow.smtpUser,
			smtpSecure: accountRow.smtpSecure,
			smtpAuthType: accountRow.smtpAuthType || 'plain',
			signature: accountRow.signature || ''
		};
	
	return c.json(result.ok(config));
});

// 保存账号SMTP配置
app.post('/smtp/account-config', async (c) => {
	const params = await c.req.json();
	const userId = userContext.getUserId(c);

	const accountRow = await accountService.selectById(c, params.accountId);
	if (!accountRow || accountRow.userId !== userId) {
		throw new BizError(t('accountNotExist'));
	}

	// 检查用户是否有SMTP配置权限
	const settingRow = await settingService.query(c);
	const isAdmin = userContext.isAdmin(c);
	
	if (!isAdmin && settingRow.smtpUserConfig !== 1) {
		throw new BizError(t('smtpConfigPermissionDenied'));
	}

	// 更新账号SMTP配置
		await accountService.updateSmtpConfig(c, params.accountId, {
			smtpOverride: params.smtpOverride,
			smtpHost: params.smtpHost,
			smtpPort: params.smtpPort,
			smtpUser: params.smtpUser,
			smtpPassword: params.smtpPassword,
			smtpSecure: params.smtpSecure,
			smtpAuthType: params.smtpAuthType || 'plain',
			signature: params.signature
		});

	return c.json(result.ok());
});
