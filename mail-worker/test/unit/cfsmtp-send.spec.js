import { describe, it, expect, vi, beforeEach } from 'vitest';

const { smtpSendMock, insertGetMock } = vi.hoisted(() => ({
	smtpSendMock: vi.fn().mockResolvedValue({ success: true, messageId: 'smtp-1@x' }),
	insertGetMock: vi.fn().mockResolvedValue({ emailId: 99 })
}));

vi.mock('../../src/service/smtp-service', () => ({
	default: { send: smtpSendMock, getSmtpConfig: vi.fn() }
}));
vi.mock('../../src/service/cf-send-service', () => ({
	default: { isAvailable: vi.fn().mockReturnValue(false), send: vi.fn() }
}));
vi.mock('resend', () => ({ Resend: vi.fn() }));

// 仓库惯例（同 smtp-reset-endpoint.spec.js / cfsmtp-setting.spec.js）：
// 1) 切断 i18n -> hono/hono 的导入副作用链（node 环境缺 hono 文件），t 直返 key；
// 2) 切断 email-service -> smtp-service -> worker-mailer -> cloudflare:sockets 的导入副作用链（上方 mock smtp-service）；
// 3) 切断 email-service -> cf-send-service -> cloudflare:email 的导入副作用链（上方 mock cf-send-service）；
// 4) orm 仅 send() 末尾 insert 用到，mock 掉落库链。
vi.mock('../../src/i18n/i18n', () => ({ t: (key) => key, default: {} }));
vi.mock('../../src/entity/orm', () => ({
	default: () => ({
		insert: () => ({
			values: () => ({
				returning: () => ({ get: insertGetMock })
			})
		})
	})
}));

import emailService from '../../src/service/email-service';
import settingService from '../../src/service/setting-service';
import attService from '../../src/service/att-service';
import userService from '../../src/service/user-service';
import roleService from '../../src/service/role-service';
import accountService from '../../src/service/account-service';
import memberService from '../../src/service/member-service';

const baseParams = (over = {}) => ({
	accountId: 1, name: 'S', sendType: '', emailId: 0,
	receiveEmail: ['x@out.com'], cc: [], bcc: [],
	text: 't', content: '<p>t</p>', subject: 's', attachments: [],
	sendMethod: 'cfsmtp', smtpAccountId: null, ...over
});

function buildContext() {
	return { env: { admin: 'admin@a.com' } };
}

// 打桩 send() 开头到发送分支的协作面（settingService/attService/userService/roleService/accountService/memberService）
function stubFlow({ settingRow } = {}) {
	vi.spyOn(settingService, 'query').mockResolvedValue(settingRow ?? {
		resendTokens: {},
		cfSmtpTokens: { 'sender.com': { user: 'api_token', password: 'tok_cf_1' } },
		r2Domain: '',
		send: 0,
		domainList: ['@sender.com'],
		smtpFromName: 'CF'
	});
	vi.spyOn(attService, 'toImageUrlHtml').mockResolvedValue({ imageDataList: [], html: '<p>t</p>' });
	vi.spyOn(attService, 'selectByEmailIds').mockResolvedValue([]);
	vi.spyOn(userService, 'selectById').mockResolvedValue({ email: 'admin@a.com', type: 0, sendCount: 0 });
	vi.spyOn(roleService, 'selectById').mockResolvedValue({ sendType: '', sendCount: 0, availDomain: '' });
	vi.spyOn(accountService, 'selectById').mockResolvedValue({ accountId: 1, email: 's@sender.com' });
	vi.spyOn(memberService, 'assertMember').mockResolvedValue(undefined);
	vi.spyOn(emailService, 'selectById').mockResolvedValue(null); // 回复场景不会走到
}

describe('cfsmtp 发送分支', () => {

	beforeEach(() => {
		vi.restoreAllMocks();
		smtpSendMock.mockClear();
		smtpSendMock.mockResolvedValue({ success: true, messageId: 'smtp-1@x' });
		insertGetMock.mockClear();
		insertGetMock.mockResolvedValue({ emailId: 99 });
	});

	it('域名已配 token：以 CF 端点参数调 smtpService.send', async () => {
		stubFlow();
		const c = buildContext();

		const result = await emailService.send(c, baseParams(), 7);

		expect(smtpSendMock).toHaveBeenCalledTimes(1);
		const [ctxArg, payloadArg, configArg] = smtpSendMock.mock.calls[0];
		expect(ctxArg).toBe(c);
		expect(configArg).toEqual({
			enabled: true,
			host: 'smtp.mx.cloudflare.net',
			port: 465,
			secure: 1,
			authType: 'plain',
			user: 'api_token',
			password: 'tok_cf_1',
			fromName: 'CF'
		});
		expect(payloadArg.sendEmail).toBe('s@sender.com');
		expect(payloadArg.recipient).toEqual([{ address: 'x@out.com', name: '' }]);
		expect(payloadArg.cc).toEqual([]);
		expect(payloadArg.bcc).toEqual([]);
		expect(result[0].emailId).toBe(99);
	});

	it('未配 token：抛 cfSmtpNotConfigured', async () => {
		stubFlow({ settingRow: {
			resendTokens: {},
			cfSmtpTokens: {},
			r2Domain: '',
			send: 0,
			domainList: ['@sender.com'],
			smtpFromName: 'CF'
		} });
		const c = buildContext();

		await expect(emailService.send(c, baseParams(), 7)).rejects.toThrow(/cfSmtpNotConfigured/);
		expect(smtpSendMock).not.toHaveBeenCalled();
	});

	it('守卫放行：无 resend token 时 cfsmtp 不再抛 noResendToken', async () => {
		stubFlow(); // resendTokens 为空 => resendToken 未命中；收件人 x@out.com 为站外
		const c = buildContext();

		// cfsmtp：应走到发送分支而非守卫抛错
		await expect(emailService.send(c, baseParams({ sendMethod: 'cfsmtp' }), 7)).resolves.toBeDefined();
		expect(smtpSendMock).toHaveBeenCalledTimes(1);

		// 对照组：同一打桩下 resend 方式仍被守卫拦截（证明放行仅针对 cfsmtp，未动自动解析链）
		await expect(emailService.send(c, baseParams({ sendMethod: 'resend' }), 7)).rejects.toThrow(/noResendToken/);
	});
});
