import { describe, it, expect } from 'vitest';

// 测试目标：onError 的运行时错误映射（抽为纯函数以便单测）。
// 修复动机：旧逻辑把一切 undefined.get/put 猜成「KV数据库未绑定」，
// 曾把 R2 缺绑定误报成 KV 未绑定，严重误导排查。
import { mapRuntimeError } from '../../src/utils/error-mapper';

const fullEnv = { db: {}, kv: {}, r2: {}, assets: {} };
const prodLikeEnv = { db: {}, kv: {}, assets: {} }; // 生产现状：R2 未绑定（可选）

describe('mapRuntimeError：如实报告，不猜测绑定归属', () => {

	it('TypeError reading + R2 未绑定 → 列出缺失的 R2，不再宣称 KV 未绑定', () => {
		const err = new TypeError("Cannot read properties of undefined (reading 'get')");

		const mapped = mapRuntimeError(err, prodLikeEnv);

		expect(mapped).not.toBeNull();
		expect(mapped.code).toBe(502);
		// 如实保留原始错误信息
		expect(mapped.message).toContain("reading 'get'");
		// 点名实际缺失的绑定（昨天的 R2 事故场景）
		expect(mapped.message).toContain('r2');
		// 不再出现旧的误导性断言
		expect(mapped.message).not.toContain('KV数据库未绑定');
		expect(mapped.message).not.toContain('KV database not bound');
	});

	it('D1 未绑定时 reading prepare → 缺失清单点名 db', () => {
		const err = new TypeError("Cannot read properties of undefined (reading 'prepare')");
		const env = { kv: {}, assets: {} }; // 无 db

		const mapped = mapRuntimeError(err, env);

		expect(mapped.message).toContain('db');
	});

	it('绑定齐全时发生 TypeError → 提示绑定正常、看日志定位', () => {
		const err = new TypeError("Cannot read properties of undefined (reading 'get')");

		const mapped = mapRuntimeError(err, fullEnv);

		expect(mapped).not.toBeNull();
		expect(mapped.message).toContain('日志');
	});

	it('非 reading 型 TypeError → 返回 null 走通用分支（行为不变）', () => {
		const err = new TypeError('x is not a function');

		expect(mapRuntimeError(err, fullEnv)).toBeNull();
	});

	it('BizError / 普通错误 → 返回 null 走通用分支（行为不变）', () => {
		const biz = Object.assign(new Error('该邮箱不属于当前用户'), { name: 'BizError' });

		expect(mapRuntimeError(biz, fullEnv)).toBeNull();
		expect(mapRuntimeError(new Error('boom'), fullEnv)).toBeNull();
		expect(mapRuntimeError(null, fullEnv)).toBeNull();
	});
});
