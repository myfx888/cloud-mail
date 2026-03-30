import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import {verifyRecordType} from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import verifyRecordService from './verify-record-service';

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

		let setting;
		if (c.env.kv && c.env.kv.get) {
			setting = await c.env.kv.get(KvConst.SETTING, { type: 'json' });
			if (setting) {
				const mailcowServersRaw = setting.mailcowServers ?? setting.mailcow_servers ?? '[]';
				setting.mailcowServers = Array.isArray(mailcowServersRaw)
					? mailcowServersRaw
					: JSON.parse(mailcowServersRaw);
				if (setting.mailcowEnabled === undefined && setting.mailcow_enabled !== undefined) {
					setting.mailcowEnabled = setting.mailcow_enabled;
				}
			}
		}

		if (!setting) {
			try {
				// 从数据库读取设置
				setting = await orm(c).select().from(setting).get();
				setting.resendTokens = JSON.parse(setting.resendTokens);
				setting.mailcowServers = JSON.parse(setting.mailcowServers || '[]');
			} catch (error) {
				// 数据库未初始化时返回默认设置
				setting = {
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
							mailcowServers: '[]',
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
		setting.domainList = domainList;


		let linuxdoSwitch = c.env.linuxdo_switch;

		if (typeof linuxdoSwitch === 'string' && linuxdoSwitch === 'true') {
			linuxdoSwitch = true
		} else if (linuxdoSwitch === true) {
			linuxdoSwitch = true
		} else {
			linuxdoSwitch = false
		}

		setting.linuxdoClientId = c.env.linuxdo_client_id;
		setting.linuxdoCallbackUrl = c.env.linuxdo_callback_url;
		setting.linuxdoSwitch = linuxdoSwitch;

		setting.emailPrefixFilter = setting.emailPrefixFilter ? setting.emailPrefixFilter.split(",").filter(Boolean) : [];

		c.set?.('setting', setting);
		return setting;
	},

	async get(c, showSiteKey = false) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);


		if (!showSiteKey) {
			settingRow.siteKey = settingRow.siteKey ? `${settingRow.siteKey.slice(0, 6)}******` : null;
		}

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 6)}******` : null;

		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.s3AccessKey = settingRow.s3AccessKey ? `${settingRow.s3AccessKey.slice(0, 12)}******` : null;
		settingRow.s3SecretKey = settingRow.s3SecretKey ? `${settingRow.s3SecretKey.slice(0, 12)}******` : null;
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

		if (params.mailcowServers !== undefined) {
			params.mailcowServers = Array.isArray(params.mailcowServers)
				? JSON.stringify(params.mailcowServers)
				: params.mailcowServers;
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
