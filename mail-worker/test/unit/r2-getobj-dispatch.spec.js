import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦截 setting-service：storageType 依赖其 query 结果决定后端
// （默认 {} → 未配置 S3；配合 env 决定 R2/KV）
vi.mock('../../src/service/setting-service', () => ({
	default: { query: vi.fn() },
}));

// 拦截 s3-service：r2-service 的直接依赖，测试不触网
vi.mock('../../src/service/s3-service', () => ({
	default: { getObj: vi.fn(), putObj: vi.fn(), deleteObj: vi.fn() },
}));

import r2Service from '../../src/service/r2-service';
import settingService from '../../src/service/setting-service';
import s3Service from '../../src/service/s3-service';

const encoder = new TextEncoder();

// 构造最小 Context stub：c.get 供 settingService 缓存判断，env 按用例注入
const makeContext = (env) => ({
	get: () => undefined,
	env,
});

describe('r2Service.getObj 按存储后端分发（修复：此前硬编码 c.env.r2.get）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 默认：未配置 S3
		settingService.query.mockResolvedValue({});
	});

	it('KV 后端（R2 未绑定）：返回含 body/arrayBuffer/text/httpMetadata 的包装对象', async () => {
		const ab = encoder.encode('hello-attachment').buffer;
		const c = makeContext({
			kv: {
				getWithMetadata: vi.fn(async () => ({
					value: ab,
					metadata: { contentType: 'text/plain', contentDisposition: 'attachment;filename=a.txt' },
				})),
			},
			// 无 r2 绑定 —— 修复前此处直接 TypeError: reading 'get'
		});

		const obj = await r2Service.getObj(c, 'attachments/abc');

		expect(c.env.kv.getWithMetadata).toHaveBeenCalledWith('attachments/abc', { type: 'arrayBuffer' });
		expect(obj).not.toBeNull();
		expect(obj.body).toBe(ab); // /oss 路由用 obj.body 作 Response body
		expect(await obj.arrayBuffer()).toBe(ab); // generateEml 导出用
		expect(await obj.text()).toBe('hello-attachment'); // backup-service 用
		expect(obj.httpMetadata.contentType).toBe('text/plain');
	});

	it('KV 后端：key 不存在时返回 null（消费方已有空值兜底）', async () => {
		const c = makeContext({
			kv: { getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })) },
		});

		const obj = await r2Service.getObj(c, 'attachments/missing');

		expect(obj).toBeNull();
	});

	it('R2 后端（已绑定）：直接透传 R2ObjectBody', async () => {
		const r2Body = { body: 'stream', arrayBuffer: async () => 1, text: async () => 't' };
		const c = makeContext({
			kv: { getWithMetadata: vi.fn() },
			r2: { get: vi.fn(async () => r2Body) },
		});

		const obj = await r2Service.getObj(c, 'attachments/abc');

		expect(obj).toBe(r2Body);
		expect(c.env.r2.get).toHaveBeenCalledWith('attachments/abc');
		expect(c.env.kv.getWithMetadata).not.toHaveBeenCalled();
	});

	it('S3 后端（设置已配置）：转发给 s3Service.getObj', async () => {
		settingService.query.mockResolvedValue({ bucket: 'b', endpoint: 'e', s3AccessKey: 'k', s3SecretKey: 's' });
		s3Service.getObj.mockResolvedValue({ body: 's3-stream' });
		const c = makeContext({ kv: { getWithMetadata: vi.fn() }, r2: { get: vi.fn() } });

		const obj = await r2Service.getObj(c, 'attachments/abc');

		expect(obj).toEqual({ body: 's3-stream' });
		expect(s3Service.getObj).toHaveBeenCalledWith(c, 'attachments/abc');
		expect(c.env.r2.get).not.toHaveBeenCalled();
	});
});
