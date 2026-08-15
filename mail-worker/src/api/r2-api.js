import r2Service from '../service/r2-service';
import app from '../hono/hono';
import result from '../model/result';

app.get('/oss/*', async (c) => {
	const key = c.req.path.split('/oss/')[1];
	const obj = await r2Service.getObj(c, key);
	if (!obj) {
		return c.json(result.fail('附件不存在 attachment not found', 404));
	}
	// 注意：直接 return new Response 时 c.header() 预设头不生效（Hono 行为），
	// 缓存头必须写进 Response headers。附件按内容哈希命名，不可变，长缓存安全。
	return new Response(obj.body, {
		headers: {
			'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
			'Content-Disposition': obj.httpMetadata?.contentDisposition || null,
			'Cache-Control': 'public, max-age=604800, immutable',
			'cdn-cache-control': 'public, max-age=604800'
		}
	});
});


