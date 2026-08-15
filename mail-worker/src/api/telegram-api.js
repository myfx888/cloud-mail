import app from '../hono/hono';
import telegramService from '../service/telegram-service';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	// 覆盖全局 noCache 中间件的双头（内容不可变，允许边缘缓存）
	c.header('Cache-Control', 'public, max-age=604800, immutable');
	c.header('cdn-cache-control', 'public, max-age=604800');
	return c.html(content)
});

