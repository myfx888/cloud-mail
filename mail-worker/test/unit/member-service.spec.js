import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦截 perm-service：避免真实 DB join。
// factory 必须返回对象（含 default），匹配模块的真实导出形状。
vi.mock('../../src/service/perm-service', () => ({
	default: {
		userPermKeys: vi.fn(),
		tree: vi.fn(),
	},
}));

// 拦截 i18n：切断 i18n.js 顶部 `import app from '../hono/hono'` 的导入副作用链，
// 否则会因 node_modules 中 hono 文件缺失（prepared-router.js）而无法加载。
// hasPerm 测试不依赖任何文案，空 t 即可。
vi.mock('../../src/i18n/i18n', () => ({
	t: () => '',
	default: {},
}));

// 测试目标：memberService.hasPerm 的 admin 短路逻辑与 permKey 命中判定。
// 本次修复点：admin（type===0 或 email===env.admin）应直接返回 true，
// 不再因默认不授予 mailbox:share 而抛 "无共享邮箱权限"。
import memberService from '../../src/service/member-service';
import permService from '../../src/service/perm-service';

// 构造最小 Hono Context stub：
// - c.get('user') 喂给 userContext.isAdmin（读 user.type / user.email）
// - c.env.admin 喂给 userContext.isAdmin 的 email 比对
const makeContext = (user, adminEmail = 'admin@example.com') => ({
	get: (key) => (key === 'user' ? user : undefined),
	env: { admin: adminEmail },
});

describe('memberService.hasPerm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('type===0 的管理员直接放行，不查权限表', async () => {
		permService.userPermKeys.mockResolvedValue([]); // 即便没有任何权限 key
		const c = makeContext({ type: 0, email: 'someone@example.com' });

		const ok = await memberService.hasPerm(c, 1, 'mailbox:share');

		expect(ok).toBe(true);
		// 关键：admin 短路，不应触发 DB 查询
		expect(permService.userPermKeys).not.toHaveBeenCalled();
	});

	it('邮箱等于 env.admin 的超级管理员直接放行，不查权限表', async () => {
		permService.userPermKeys.mockResolvedValue([]);
		const c = makeContext({ type: 9, email: 'admin@example.com' }, 'admin@example.com');

		const ok = await memberService.hasPerm(c, 1, 'mailbox:share');

		expect(ok).toBe(true);
		expect(permService.userPermKeys).not.toHaveBeenCalled();
	});

	it('普通用户命中权限 key 时返回 true', async () => {
		permService.userPermKeys.mockResolvedValue(['account:add', 'mailbox:share']);
		const c = makeContext({ type: 2, email: 'u@example.com' });

		const ok = await memberService.hasPerm(c, 5, 'mailbox:share');

		expect(ok).toBe(true);
		expect(permService.userPermKeys).toHaveBeenCalledWith(c, 5);
	});

	it('普通用户缺少权限 key 时返回 false（复现修复前的 bug 行为）', async () => {
		// mailbox:share 默认不授予任何角色 —— 修复前 admin 也命中这条 false 分支
		permService.userPermKeys.mockResolvedValue(['account:add']);
		const c = makeContext({ type: 2, email: 'u@example.com' });

		const ok = await memberService.hasPerm(c, 5, 'mailbox:share');

		expect(ok).toBe(false);
		expect(permService.userPermKeys).toHaveBeenCalledWith(c, 5);
	});
});
