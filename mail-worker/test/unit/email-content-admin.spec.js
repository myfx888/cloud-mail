import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦截 i18n：切断 i18n.js 顶部 `import app from '../hono/hono'` 的导入副作用链
// （同 member-service.spec.js）。t 返回 key 本身，便于断言错误来源。
vi.mock('../../src/i18n/i18n', () => ({
	t: (key) => key,
	default: {},
}));

// 拦截 member-service：默认模拟真实行为——非成员时抛 noUserAccount。
// 这正是管理员从「所有邮件」点开别人邮件时收到的报错。
vi.mock('../../src/service/member-service', () => ({
	default: {
		assertMember: vi.fn(),
		getVisibleAccountIds: vi.fn(),
		getOwnedAccountIds: vi.fn(),
	},
}));

// 拦截 orm：select().from().where().get() 链式桩，行内容可按用例覆写
const ormState = vi.hoisted(() => ({
	row: {
		emailId: 101,
		accountId: 7, // 属于其他用户的邮箱（管理员不是其成员）
		userId: 3,
		isDel: 0,
		content: '<p>hello</p>',
		text: 'hello',
		subject: 's',
		sendEmail: 'a@example.com',
		toEmail: 'b@example.com',
		name: 'A',
		toName: 'B',
		cc: '[]',
	},
}));

vi.mock('../../src/entity/orm', () => ({
	default: vi.fn(() => ({
		select: () => ({
			from: () => ({
				where: () => ({
					get: async () => ormState.row,
				}),
			}),
		}),
	})),
}));

// 拦截 smtp-service：切断 lib/worker-mailer → cloudflare:sockets 的 workers 专属导入
// （测试路径不触达发信，空实现即可）
vi.mock('../../src/service/smtp-service', () => ({
	default: {
		getSmtpConfig: vi.fn(),
		send: vi.fn(),
	},
}));

// 拦截 cf-send-service：切断 cloudflare:email 的 workers 专属导入
vi.mock('../../src/service/cf-send-service', () => ({
	default: {
		isAvailable: vi.fn(() => false),
		send: vi.fn(),
	},
}));

// generateEml（导出路径）依赖：空附件 + 空 r2 域即可走通
vi.mock('../../src/service/att-service', () => ({
	default: { selectByEmailIds: vi.fn(async () => []) },
}));

vi.mock('../../src/service/setting-service', () => ({
	default: { query: vi.fn(async () => ({ r2Domain: '' })) },
}));

import emailService from '../../src/service/email-service';
import memberService from '../../src/service/member-service';
import BizError from '../../src/error/biz-error';

// 构造最小 Hono Context stub（同 member-service.spec.js）：
// c.get('user') 喂给 userContext.isAdmin，c.env.admin 喂 email 比对
const makeContext = (user, adminEmail = 'admin@example.com') => ({
	get: (key) => (key === 'user' ? user : undefined),
	env: { admin: adminEmail },
});

describe('emailService.getContent / exportEmail 的 admin 旁路', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 默认：当前用户不是邮箱 7 的成员（管理员看别人邮件的真实处境）
		memberService.assertMember.mockRejectedValue(new BizError('noUserAccount'));
	});

	it('管理员（type===0）加载任意用户邮件正文不触发成员校验', async () => {
		const c = makeContext({ userId: 999, type: 0, email: 'boss@example.com' });

		const body = await emailService.getContent(c, 101, 999);

		expect(body).toEqual({ content: '<p>hello</p>', text: 'hello' });
		expect(memberService.assertMember).not.toHaveBeenCalled();
	});

	it('管理员（email===env.admin）导出任意用户邮件不触发成员校验', async () => {
		const c = makeContext({ userId: 999, type: 9, email: 'admin@example.com' });

		const eml = await emailService.exportEmail(c, 101, 999);

		expect(typeof eml).toBe('string');
		expect(eml).toContain('a@example.com');
		expect(memberService.assertMember).not.toHaveBeenCalled();
	});

	it('普通用户是邮箱成员时正常加载正文', async () => {
		memberService.assertMember.mockResolvedValue(undefined);
		const c = makeContext({ userId: 3, type: 2, email: 'u@example.com' });

		const body = await emailService.getContent(c, 101, 3);

		expect(body).toEqual({ content: '<p>hello</p>', text: 'hello' });
		expect(memberService.assertMember).toHaveBeenCalledWith(c, 7, 3);
	});

	it('普通用户非成员时仍被拒绝（该邮箱不属于当前用户）', async () => {
		const c = makeContext({ userId: 999, type: 2, email: 'u@example.com' });

		await expect(emailService.getContent(c, 101, 999)).rejects.toThrow('noUserAccount');
		expect(memberService.assertMember).toHaveBeenCalledWith(c, 7, 999);
	});
});
