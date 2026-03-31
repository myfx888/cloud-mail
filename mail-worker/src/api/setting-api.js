import app from '../hono/hono';
import result from '../model/result';
import settingService from '../service/setting-service';
import mailcowService from '../service/mailcow-service';
import accountService from '../service/account-service';

app.put('/setting/set', async (c) => {
	await settingService.set(c, await c.req.json());
	return c.json(result.ok());
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	return c.json(result.ok(setting));
})

app.put('/setting/setBackground', async (c) => {
	const key = await settingService.setBackground(c, await c.req.json());
	return c.json(result.ok(key));
});

app.delete('/setting/deleteBackground', async (c) => {
	await settingService.deleteBackground(c);
	return c.json(result.ok());
});

app.post('/setting/mailcow/testConnection', async (c) => {
	const { serverId, serverConfig } = await c.req.json();
	const targetServerConfig = (serverConfig && serverConfig.apiUrl && serverConfig.apiKey)
		? serverConfig
		: await mailcowService.getServerById(c, serverId);
	const start = Date.now();
	await mailcowService.testConnection(c, targetServerConfig);
	return c.json(result.ok({ success: true, duration: Date.now() - start }));
});

app.get('/setting/mailcow/dependencies/:serverId', async (c) => {
	const serverId = c.req.param('serverId');
	const count = await accountService.countByMailcowServerId(c, serverId);
	return c.json(result.ok({ count }));
});

