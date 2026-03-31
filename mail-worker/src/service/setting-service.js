import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import account from '../entity/account';
import orm from '../entity/orm';
import {isDel, verifyRecordType} from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import verifyRecordService from './verify-record-service';
import { and, count, eq } from 'drizzle-orm';

const settingService = {

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		c.set('setting', settingRow);
		if (c.env.kv && c.env.kv.put) {
			await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
		}
	},

	async query(c) {

		if (c.get?.('setting')) {
			return c.get('setting')
		}

		let settingRow;
		if (c.env.kv && c.env.kv.get) {
			settingRow = await c.env.kv.get(KvConst.SETTING, { type: 'json' });
			if (settingRow) {
				const mailcowServersRaw = settingRow.mailcowServers ?? settingRow.mailcow_servers ?? '[]';
				settingRow.mailcowServers = (Array.isArray(mailcowServersRaw)
					? mailcowServersRaw
					: JSON.parse(mailcowServersRaw)).map((server, index) => {
						if (!server.id) {
							server.id = `mc_${index}_${server.apiUrl?.replace(/[^a-z0-9]/gi, '_')}`;
						}
						return server;
					});
				const smtpServersRaw = settingRow.smtpServers ?? settingRow.smtp_servers ?? '[]';
				settingRow.smtpServers = (Array.isArray(smtpServersRaw)
					? smtpServersRaw
					: JSON.parse(smtpServersRaw)).map((server, index) => {
						if (!server.id) {
							server.id = `smtp_${index}_${server.smtpHost?.replace(/[^a-z0-9]/gi, '_')}`;
						}
						return server;
					});
				const mailcowGlobalSmtpTemplateRaw = settingRow.mailcowGlobalSmtpTemplate ?? settingRow.mailcow_global_smtp_template ?? '{}';
				settingRow.mailcowGlobalSmtpTemplate = typeof mailcowGlobalSmtpTemplateRaw === 'object'
					? mailcowGlobalSmtpTemplateRaw
					: JSON.parse(mailcowGlobalSmtpTemplateRaw || '{}');
				if (settingRow.mailcowEnabled === undefined && settingRow.mailcow_enabled !== undefined) {
					settingRow.mailcowEnabled = settingRow.mailcow_enabled;
				}
				if (settingRow.mailcowPasswordMode === undefined && settingRow.mailcow_password_mode !== undefined) {
					settingRow.mailcowPasswordMode = settingRow.mailcow_password_mode;
				}
				if (settingRow.mailcowProvisionPassword === undefined && settingRow.mailcow_provision_password !== undefined) {
					settingRow.mailcowProvisionPassword = settingRow.mailcow_provision_password;
				}
				if (settingRow.mailcowCreateStrict === undefined && settingRow.mailcow_create_strict !== undefined) {
					settingRow.mailcowCreateStrict = settingRow.mailcow_create_strict;
				}
				if (settingRow.mailcowRetryCount === undefined && settingRow.mailcow_retry_count !== undefined) {
					settingRow.mailcowRetryCount = settingRow.mailcow_retry_count;
				}
				if (settingRow.mailcowTimeout === undefined && settingRow.mailcow_timeout !== undefined) {
					settingRow.mailcowTimeout = settingRow.mailcow_timeout;
				}
			}
		}

		if (!settingRow) {
			try {
				// 从数据库读取设置
				settingRow = await orm(c).select().from(setting).get();
				settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
				settingRow.mailcowServers = JSON.parse(settingRow.mailcowServers || '[]').map((server, index) => {
					if (!server.id) {
						server.id = `mc_${index}_${server.apiUrl?.replace(/[^a-z0-9]/gi, '_')}`;
					}
					return server;
				});
				settingRow.smtpServers = JSON.parse(settingRow.smtpServers || '[]').map((server, index) => {
					if (!server.id) {
						server.id = `smtp_${index}_${server.smtpHost?.replace(/[^a-z0-9]/gi, '_')}`;
					}
					return server;
				});
				settingRow.mailcowGlobalSmtpTemplate = JSON.parse(settingRow.mailcowGlobalSmtpTemplate || '{}');
			} catch (error) {
				// 数据库未初始化时返回默认设置
				settingRow = {
					register: 0,
					receive: 0,
					add_email: 0,
					many_email: 0,
					title: 'Cloud Mail',
					auto_refresh: 0,
					register_verify: 1,
					add_email_verify: 1,
					resendTokens: {},
					send: 0,
					r2_domain: '',
					site_key: '',
					background: '',
					login_opacity: 0.90,
					reg_key: 1,
					notice_title: 'Cloud Mail',
					notice_content: '',
					notice_type: 'none',
					notice_duration: 0,
					notice_position: 'top-right',
					notice_width: 340,
					notice_offset: 0,
					notice: 0,
					login_domain: 0,
					min_email_prefix: 1,
					email_prefix_filter: '',
					smtp_enabled: 0,
					smtp_host: '',
					smtp_port: 587,
					smtp_user: '',
					smtp_password: '',
					smtp_secure: 0,
			smtp_from_name: '',
							resend_enabled: 1,
							smtp_user_config: 1,
							mailcowEnabled: 0,
							mailcowServers: [],
							mailcowPasswordMode: 'random',
							mailcowProvisionPassword: '',
							mailcowCreateStrict: 0,
							mailcowGlobalSmtpTemplate: {},
							smtpServers: [],
							mailcowRetryCount: 3,
							mailcowTimeout: 30000
						};
			}
		}

		let domainList = c.env.domain;

		if (typeof domainList === 'string') {
			try {
				domainList = JSON.parse(domainList)
			} catch (error) {
				throw new BizError(t('notJsonDomain'));
			}
		}

		if (!c.env.domain) {
			throw new BizError(t('noDomainVariable'));
		}

		domainList = domainList.map(item => '@' + item);
		settingRow.domainList = domainList;


		let linuxdoSwitch = c.env.linuxdo_switch;

		if (typeof linuxdoSwitch === 'string' && linuxdoSwitch === 'true') {
			linuxdoSwitch = true
		} else if (linuxdoSwitch === true) {
			linuxdoSwitch = true
		} else {
			linuxdoSwitch = false
		}

		settingRow.linuxdoClientId = c.env.linuxdo_client_id;
		settingRow.linuxdoCallbackUrl = c.env.linuxdo_callback_url;
		settingRow.linuxdoSwitch = linuxdoSwitch;

		settingRow.emailPrefixFilter = settingRow.emailPrefixFilter ? settingRow.emailPrefixFilter.split(",").filter(Boolean) : [];

		c.set?.('setting', settingRow);
		return settingRow;
	},

	async get(c, showSiteKey = false) {

		const [settingRowRaw, recordList] = await Promise.all([
			this.query(c),
			verifyRecordService.selectListByIP(c)
		]);

		// Deep clone to avoid modifying the cached object
		const settingRow = JSON.parse(JSON.stringify(settingRowRaw));

		if (!showSiteKey) {
			settingRow.siteKey = settingRow.siteKey ? `${settingRow.siteKey.slice(0, 6)}******` : null;
		}

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 6)}******` : null;

		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.s3AccessKey = settingRow.s3AccessKey ? `${settingRow.s3AccessKey.slice(0, 12)}******` : null;
		settingRow.s3SecretKey = settingRow.s3SecretKey ? `${settingRow.s3SecretKey.slice(0, 12)}******` : null;
		settingRow.mailcowProvisionPassword = settingRow.mailcowProvisionPassword ? '******' : '';
		if (Array.isArray(settingRow.mailcowServers)) {
			settingRow.mailcowServers = settingRow.mailcowServers.map(server => ({
				...server,
				apiKey: server?.apiKey ? `${server.apiKey.slice(0, 4)}****${server.apiKey.slice(-3)}` : ''
			}));
		}
		settingRow.hasR2 = !!c.env.r2

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		settingRow.storageType = await r2Service.storageType(c);

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});

		if (Array.isArray(params.emailPrefixFilter)) {
			params.emailPrefixFilter = params.emailPrefixFilter + '';
		}

		params.resendTokens = JSON.stringify(resendTokens);

		if (params.mailcow_enabled !== undefined && params.mailcowEnabled === undefined) {
			params.mailcowEnabled = params.mailcow_enabled;
			delete params.mailcow_enabled;
		}

		if (params.mailcow_retry_count !== undefined && params.mailcowRetryCount === undefined) {
			params.mailcowRetryCount = params.mailcow_retry_count;
			delete params.mailcow_retry_count;
		}

		if (params.mailcow_timeout !== undefined && params.mailcowTimeout === undefined) {
			params.mailcowTimeout = params.mailcow_timeout;
			delete params.mailcow_timeout;
		}

		if (params.mailcow_servers !== undefined && params.mailcowServers === undefined) {
			params.mailcowServers = params.mailcow_servers;
			delete params.mailcow_servers;
		}

		if (params.smtp_servers !== undefined && params.smtpServers === undefined) {
			params.smtpServers = params.smtp_servers;
			delete params.smtp_servers;
		}

		if (params.mailcow_password_mode !== undefined && params.mailcowPasswordMode === undefined) {
			params.mailcowPasswordMode = params.mailcow_password_mode;
			delete params.mailcow_password_mode;
		}

		if (params.mailcow_provision_password !== undefined && params.mailcowProvisionPassword === undefined) {
			params.mailcowProvisionPassword = params.mailcow_provision_password;
			delete params.mailcow_provision_password;
		}

		if (params.mailcow_create_strict !== undefined && params.mailcowCreateStrict === undefined) {
			params.mailcowCreateStrict = params.mailcow_create_strict;
			delete params.mailcow_create_strict;
		}

		if (params.mailcow_global_smtp_template !== undefined && params.mailcowGlobalSmtpTemplate === undefined) {
			params.mailcowGlobalSmtpTemplate = params.mailcow_global_smtp_template;
			delete params.mailcow_global_smtp_template;
		}

		if (params.smtpServers !== undefined && Array.isArray(params.smtpServers)) {
			const defaultCount = params.smtpServers.filter(item => item?.isDefault).length;
			if (defaultCount > 1) {
				throw new BizError('smtpServers default item must be unique');
			}
			params.smtpServers.forEach((item) => {
				if (!item?.name || !item?.smtpHost) {
					throw new BizError('smtpServer name and smtpHost are required');
				}
				if (!Number.isInteger(Number(item.smtpPort)) || Number(item.smtpPort) < 1 || Number(item.smtpPort) > 65535) {
					throw new BizError('smtpServer smtpPort is invalid');
				}
				if (![0, 1, 2].includes(Number(item.smtpSecure))) {
					throw new BizError('smtpServer smtpSecure is invalid');
				}
			});
		}

		if (params.mailcowServers !== undefined && Array.isArray(params.mailcowServers)) {
			const currentSetting = await this.query(c);
			const currentServers = Array.isArray(currentSetting?.mailcowServers) ? currentSetting.mailcowServers : [];

			// Prevent overwriting real API keys with masked ones from the UI
			params.mailcowServers = params.mailcowServers.map(newServer => {
				const oldServer = currentServers.find(s => s.id === newServer.id);
				if (newServer.apiKey && newServer.apiKey.includes('****') && oldServer?.apiKey) {
					newServer.apiKey = oldServer.apiKey;
				}
				return newServer;
			});

			const defaultCount = params.mailcowServers.filter(item => item?.isDefault).length;
			if (defaultCount > 1) {
				throw new BizError('mailcowServers default item must be unique');
			}
			if (params.mailcowServers.length > 0 && defaultCount === 0) {
				throw new BizError('mailcowServers must contain one default server');
			}

			const nextIds = params.mailcowServers.map(item => String(item?.id || '')).filter(Boolean);
			const currentIds = currentServers.map(item => String(item?.id || '')).filter(Boolean);
			const removedIds = currentIds.filter(id => !nextIds.includes(id));

			for (const removedId of removedIds) {
				const { num } = await orm(c)
					.select({ num: count() })
					.from(account)
					.where(and(
						eq(account.mailcowServerId, removedId),
						eq(account.isDel, isDel.NORMAL)
					))
					.get();
				if (Number(num || 0) > 0) {
					throw new BizError(`mailcow server ${removedId} is still bound by ${num} accounts`);
				}
			}
		}

		if (params.mailcowGlobalSmtpTemplate !== undefined) {
			const template = typeof params.mailcowGlobalSmtpTemplate === 'string'
				? JSON.parse(params.mailcowGlobalSmtpTemplate || '{}')
				: params.mailcowGlobalSmtpTemplate;
			if (template.smtpPort !== undefined && (!Number.isInteger(Number(template.smtpPort)) || Number(template.smtpPort) < 1 || Number(template.smtpPort) > 65535)) {
				throw new BizError('mailcowGlobalSmtpTemplate smtpPort is invalid');
			}
			if (template.smtpSecure !== undefined && ![0, 1, 2].includes(Number(template.smtpSecure))) {
				throw new BizError('mailcowGlobalSmtpTemplate smtpSecure is invalid');
			}
			params.mailcowGlobalSmtpTemplate = template;
		}

		if (params.mailcowServers !== undefined) {
			params.mailcowServers = Array.isArray(params.mailcowServers)
				? JSON.stringify(params.mailcowServers)
				: params.mailcowServers;
		}

		if (params.smtpServers !== undefined) {
			params.smtpServers = Array.isArray(params.smtpServers)
				? JSON.stringify(params.smtpServers)
				: params.smtpServers;
		}

		if (params.mailcowGlobalSmtpTemplate !== undefined) {
			params.mailcowGlobalSmtpTemplate = typeof params.mailcowGlobalSmtpTemplate === 'object'
				? JSON.stringify(params.mailcowGlobalSmtpTemplate)
				: params.mailcowGlobalSmtpTemplate;
		}

		// 处理SMTP密码（如果不更新则保留原值）
		if (params.smtpPassword === '' || params.smtpPassword === undefined) {
			delete params.smtpPassword;
		}

		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async deleteBackground(c) {

		const { background } = await this.query(c);
		if (!background) return

		if (background.startsWith('http')) {
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
			return;
		}

		if (background) {
			await r2Service.delete(c,background)
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
		}
	},

	async setBackground(c, params) {

		let { background } = params

		await this.deleteBackground(c);

		if (background && !background.startsWith('http')) {

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type,
				cacheControl: `public, max-age=31536000, immutable`,
				contentDisposition: `inline; filename="${file.name}"`
			});

		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c, true);

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefresh: settingRow.autoRefresh,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			loginOpacity: settingRow.loginOpacity,
			domainList: settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain,
			linuxdoClientId: settingRow.linuxdoClientId,
			linuxdoCallbackUrl: settingRow.linuxdoCallbackUrl,
			linuxdoSwitch: settingRow.linuxdoSwitch,
			minEmailPrefix: settingRow.minEmailPrefix
		};
	}
};

export default settingService;
