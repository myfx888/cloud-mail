import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';
import { noCacheHeaders } from '../middleware/cache-headers';
import { mapRuntimeError } from '../utils/error-mapper';

app.use('*', cors());

// 所有 API 响应默认不缓存（浏览器 + EdgeOne 双头），覆盖全部动态接口
// （email/allEmail/setting/account/user/star/analysis/role 等 23 个前缀）
// 需要缓存的路由（/email/content/*、/oss/*、telegram 头像）在 handler 内
// 用 longCacheHeaders/c.header 覆盖这两个头（Hono 后设的头覆盖先设的）
app.use('*', noCacheHeaders);

app.onError((err, c) => {
	if (err.name === 'BizError') {
		console.log(err.message);
	} else {
		console.error(err);
	}

	// TypeError（读 undefined 属性等）：如实报告原始错误 + 实际缺失的绑定清单，
	// 不再猜测归属（详见 utils/error-mapper.js 注释）
	const runtime = mapRuntimeError(err, c.env);
	if (runtime) {
		return c.json(result.fail(runtime.message, runtime.code));
	}

	return c.json(result.fail(err.message, err.code));
});

export default app;


