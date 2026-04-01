import app from '../hono/hono';
import smtpService from '../service/smtp-service';
import smtpAccountService from '../service/smtp-account-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

// 获取Mailcow服务器列表（任何已登录用户均可访问，用于一键开通功能）
app.get('/smtp/mailcow-servers', async (c) => {
	const settings = await settingService.query(c);
	const mailcowEnabled = Number(settings.mailcowEnabled || 0) === 1;
	const mailcowServers = Array.isArray(settings.mailcowServers)
		? settings.mailcowServers.map(s => ({ id: s.id, name: s.name, apiUrl: s.apiUrl, isDefault: s.isDefault }))
		: [];
	return c.json(result.ok({ mailcowEnabled, mailcowServers }));
});

// 验证全局SMTP配置
app.post('/smtp/verify', async (c) => {
	const params = await c.req.json();
	const smtpPort = Number(params.smtpPort ?? 587);
	const smtpSecure = Number(params.smtpSecure ?? 0);
	
	const smtpConfig = {
		host: params.smtpHost,
		port: smtpPort,
		user: params.smtpUser,
		password: params.smtpPassword,
		secure: [0, 1, 2].includes(smtpSecure) ? smtpSecure : 0,
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
	const isAdmin = userContext.isAdmin(c);
	const smtpPort = Number(params.smtpPort ?? 587);
	const smtpSecure = Number(params.smtpSecure ?? 0);
	
	const accountRow = await accountService.selectByIdAny(c, params.accountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}
	
	const smtpConfig = {
		host: params.smtpHost,
		port: smtpPort,
		user: params.smtpUser,
		password: params.smtpPassword,
		secure: [0, 1, 2].includes(smtpSecure) ? smtpSecure : 0,
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
	const isAdmin = userContext.isAdmin(c);
	
	// 确保accountId是数字
	const numericAccountId = parseInt(accountId, 10);
	if (isNaN(numericAccountId)) {
		throw new BizError(t('accountNotExist'));
	}
	
	const accountRow = await accountService.selectByIdAny(c, numericAccountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
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
	const isAdmin = userContext.isAdmin(c);

	const accountRow = await accountService.selectByIdAny(c, params.accountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
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

// 创建SMTP账户
app.post('/smtp/accounts', async (c) => {
	const params = await c.req.json();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, params.accountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 创建SMTP账户
	const smtpAccount = await smtpAccountService.create(c, params.accountId, {
		name: params.name,
		host: params.host,
		port: params.port,
		user: params.user,
		password: params.password,
		secure: params.secure,
		authType: params.authType,
		isDefault: params.isDefault
	});

	return c.json(result.ok(smtpAccount));
});

// 更新SMTP账户
app.put('/smtp/accounts/:smtpAccountId', async (c) => {
	const smtpAccountId = parseInt(c.req.param('smtpAccountId'), 10);
	const params = await c.req.json();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, params.accountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 更新SMTP账户
	const smtpAccount = await smtpAccountService.update(c, smtpAccountId, params.accountId, {
		name: params.name,
		host: params.host,
		port: params.port,
		user: params.user,
		password: params.password,
		secure: params.secure,
		authType: params.authType,
		isDefault: params.isDefault
	});

	return c.json(result.ok(smtpAccount));
});

// 删除SMTP账户
app.delete('/smtp/accounts/:smtpAccountId', async (c) => {
	const smtpAccountId = parseInt(c.req.param('smtpAccountId'), 10);
	const { accountId } = c.req.query();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, parseInt(accountId, 10));
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 删除SMTP账户
	await smtpAccountService.delete(c, smtpAccountId, parseInt(accountId, 10));

	return c.json(result.ok());
});

// 获取SMTP账户列表
app.get('/smtp/accounts', async (c) => {
	const { accountId } = c.req.query();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, parseInt(accountId, 10));
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 获取SMTP账户列表
	const smtpAccounts = await smtpAccountService.list(c, parseInt(accountId, 10));

	return c.json(result.ok(smtpAccounts));
});

// 获取指定SMTP账户
app.get('/smtp/accounts/:smtpAccountId', async (c) => {
	const smtpAccountId = parseInt(c.req.param('smtpAccountId'), 10);
	const { accountId } = c.req.query();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, parseInt(accountId, 10));
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 获取SMTP账户
	const smtpAccount = await smtpAccountService.getById(c, smtpAccountId, parseInt(accountId, 10));

	return c.json(result.ok(smtpAccount));
});

// 验证SMTP账户配置
app.post('/smtp/accounts/verify', async (c) => {
	const params = await c.req.json();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	// 验证账户所有权
	const accountRow = await accountService.selectByIdAny(c, params.accountId);
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	// 验证SMTP配置
	const verifyResult = await smtpAccountService.verify(c, {
		host: params.host,
		port: params.port,
		user: params.user,
		password: params.password,
		secure: params.secure,
		authType: params.authType
	});

	return c.json(result.ok(verifyResult));
});

// 一键开通Mailcow SMTP（权限控制：smtp:provision）
app.post('/smtp/provision-mailcow', async (c) => {
	const { accountId, mailcowServerId } = await c.req.json();
	const userId = userContext.getUserId(c);
	const isAdmin = userContext.isAdmin(c);

	const accountRow = await accountService.selectByIdAny(c, parseInt(accountId, 10));
	if (!accountRow || (!isAdmin && accountRow.userId !== userId)) {
		throw new BizError(t('accountNotExist'));
	}

	const provisionResult = await accountService.provisionSmtpByMailcowServer(
		c,
		parseInt(accountId, 10),
		mailcowServerId,
		userId,
		isAdmin
	);
	return c.json(result.ok(provisionResult));
});
