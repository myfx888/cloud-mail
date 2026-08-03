import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';
import { noCacheHeaders } from '../middleware/cache-headers';

app.use('*', cors());

// 动态 email 路由永不缓存（浏览器 + EdgeOne 双头）
// 正文路由 /email/content/ 走长缓存，在路由内自行设头并豁免此处
app.use('/email/*', async (c, next) => {
	if (c.req.path.startsWith('/email/content/')) {
		return next();
	}
	return noCacheHeaders(c, next);
});
app.use('/allEmail/*', noCacheHeaders);

app.onError((err, c) => {
	if (err.name === 'BizError') {
		console.log(err.message);
	} else {
		console.error(err);
	}

	if (err.message === `Cannot read properties of undefined (reading 'get')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'put')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'prepare')`) {
		return c.json(result.fail('D1数据库未绑定 D1 database not bound',502));
	}

	return c.json(result.fail(err.message, err.code));
});

export default app;


