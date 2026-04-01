import { WorkerMailer } from '../lib/worker-mailer/mailer.js';
import { eq, and } from 'drizzle-orm';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import accountService from './account-service';
import settingService from './setting-service';
import smtpAccountService from './smtp-account-service';
import orm from '../entity/orm';
import smtpAccount from '../entity/smtp-account';

const smtpService = {

	async getSmtpServerById(c, smtpServerId) {
		const settingRow = await settingService.query(c);
		const smtpServers = Array.isArray(settingRow.smtpServers) ? settingRow.smtpServers : [];
		if (!smtpServerId) {
			return this.getDefaultSmtpServer(c);
		}
		const target = smtpServers.find(item => String(item.id) === String(smtpServerId));
		if (!target) {
			throw new BizError('smtp server not found');
		}
		return target;
	},

	async getDefaultSmtpServer(c) {
		const settingRow = await settingService.query(c);
		const smtpServers = Array.isArray(settingRow.smtpServers) ? settingRow.smtpServers : [];
		if (!smtpServers.length) {
			return null;
		}
		return smtpServers.find(item => item?.isDefault) || smtpServers[0];
	},

	/**
	 * 验证SMTP主机是否安全（防止SSRF攻击）
	 * 阻止对私有IP地址的连接
	 */
	isValidSmtpHost(host) {
		// 私有IP地址模式
		const privatePatterns = [
			/^127\./,           // 127.0.0.0/8
			/^10\./,            // 10.0.0.0/8
			/^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
			/^192\.168\./,       // 192.168.0.0/16
			/^169\.254\./,       // 169.254.0.0/16 (链路本地)
			/^::1$/,            // IPv6回环
			/^fe80:/i,          // IPv6链路本地
			/^fc00:/i,          // IPv6私有地址
			/^fd[0-9a-f]{2}:/i, // IPv6私有地址
		];
		
		// 检查是否为私有IP
		for (const pattern of privatePatterns) {
			if (pattern.test(host)) {
				return false;
			}
		}
		
		// 检查常见内部主机名
		const internalHostnames = ['localhost', 'local', 'internal'];
		const hostLower = host.toLowerCase();
		for (const hostname of internalHostnames) {
			if (hostLower.includes(hostname)) {
				return false;
			}
		}
		
		return true;
	},
	
	/**
	 * 验证SMTP配置完整性
	 */
	validateSmtpConfig(smtpConfig) {
		// 验证主机
		if (!smtpConfig.host) {
			throw new BizError(t('smtpHostRequired'));
		}
		
		if (smtpConfig.host.length > 253) {
			throw new BizError(t('smtpHostTooLong'));
		}
		
		if (!this.isValidSmtpHost(smtpConfig.host)) {
			throw new BizError(t('smtpHostInvalid'));
		}
		
		// 验证端口
		const port = Number(smtpConfig.port);
		if (isNaN(port) || port < 1 || port > 65535) {
			throw new BizError(t('smtpPortInvalid'));
		}

		if (port === 25) {
			throw new BizError('Cloudflare Workers does not support outbound SMTP on port 25. Please use port 465 or 587.');
		}
		
		// 验证用户名
		if (!smtpConfig.user) {
			throw new BizError(t('smtpUserRequired'));
		}
		
		if (smtpConfig.user.length > 255) {
			throw new BizError(t('smtpUserTooLong'));
		}
		
		// 验证密码
		if (!smtpConfig.password) {
			throw new BizError(t('smtpPasswordRequired'));
		}
	},

	resolveSecurityOptions(smtpSecure, smtpPort) {
		const mode = Number(smtpSecure ?? 0);
		const port = Number(smtpPort || 587);

		if (mode === 1) {
			return { mode, port, secure: true, startTls: false };
		}

		if (mode === 2) {
			return { mode, port, secure: false, startTls: true };
		}

		// mode === 0: 根据端口自动判断加密方式
		// 端口 465 通常使用隐式 TLS，其他端口（如 587）使用 STARTTLS
		const isImplicitTlsPort = port === 465;
		return {
			mode: 0,
			port,
			secure: isImplicitTlsPort,
			startTls: !isImplicitTlsPort
		};
	},

	buildFallbackSecurityOptions(securityOptions) {
		if (securityOptions.secure) {
			return {
				mode: 2,
				port: securityOptions.port,
				secure: false,
				startTls: true
			};
		}

		if (securityOptions.startTls) {
			return {
				mode: 1,
				port: securityOptions.port,
				secure: true,
				startTls: false
			};
		}

		return null;
	},

	isTlsHandshakeError(error) {
		const msg = String(error?.message || '').toLowerCase();
		return msg.includes('tls handshake failed') || msg.includes('failed to start tls');
	},

	isProxyConnectError(error) {
		const msg = String(error?.message || '').toLowerCase();
		return msg.includes('proxy request failed') || msg.includes('cannot connect to the specified address');
	},

	async connectMailer(smtpConfig, securityOptions) {
		// 允许协商多种认证方式，提高兼容性
		const authType = smtpConfig.authType ? 
			(Array.isArray(smtpConfig.authType) ? smtpConfig.authType : [smtpConfig.authType]) : 
			['plain', 'login', 'cram-md5'];

		return WorkerMailer.connect({
			credentials: {
				username: smtpConfig.user,
				password: smtpConfig.password
			},
			authType: authType,
			host: smtpConfig.host,
			port: securityOptions.port,
			secure: securityOptions.secure,
			startTls: securityOptions.startTls,
			socketTimeoutMs: securityOptions.socketTimeoutMs || 30000,
			responseTimeoutMs: securityOptions.responseTimeoutMs || 15000,
			logLevel: 0 // 开启 DEBUG 日志，方便排查连接问题
		});
	},
	
	/**
	 * 获取有效的SMTP配置
	 * 优先使用指定的SMTP账户配置，其次使用账号配置，最后使用全局配置
	 */
	async getSmtpConfig(c, accountId, smtpAccountId = null) {
		const [settingRow, accountRow] = await Promise.all([
			settingService.query(c),
			accountService.selectById(c, accountId)
		]);
		
		// 检查是否启用SMTP
		const globalEnabled = settingRow.smtpEnabled === 1;
		
		// 如果指定了SMTP账户ID，使用该账户的配置
		if (smtpAccountId) {
			const smtpAccountRow = await orm(c).select().from(smtpAccount).where(
				and(
					eq(smtpAccount.smtpAccountId, smtpAccountId),
					eq(smtpAccount.accountId, accountId),
					eq(smtpAccount.status, 1)
				)
			).get();
			
			if (smtpAccountRow) {
				return {
					enabled: true,
					host: smtpAccountRow.host,
					port: smtpAccountRow.port,
					user: smtpAccountRow.user,
					password: smtpAccountRow.password,
					secure: smtpAccountRow.secure,
					authType: smtpAccountRow.authType || 'plain',
					fromName: settingRow.smtpFromName
				};
			}
		}
		
		// 如果账号覆盖，使用账号配置
		const accountOverride = accountRow?.smtpOverride === 1;
		if (accountOverride && accountRow.smtpHost) {
			return {
				enabled: true,
				host: accountRow.smtpHost,
				port: accountRow.smtpPort || settingRow.smtpPort,
				user: accountRow.smtpUser,
				password: accountRow.smtpPassword,
				secure: accountRow.smtpSecure >= 0 ? accountRow.smtpSecure : settingRow.smtpSecure,
				authType: accountRow.smtpAuthType || 'plain',
				fromName: settingRow.smtpFromName
			};
		}
		
		// 使用全局配置
		if (!globalEnabled || !settingRow.smtpHost) {
			return { enabled: false };
		}
		
		return {
			enabled: true,
			host: settingRow.smtpHost,
			port: settingRow.smtpPort,
			user: settingRow.smtpUser,
			password: settingRow.smtpPassword,
			secure: settingRow.smtpSecure,
			authType: settingRow.smtpAuthType || 'plain',
			fromName: settingRow.smtpFromName
		};
	},
	
	/**
	 * 通过SMTP发送邮件
	 */
	async send(c, emailData, smtpConfig) {
		this.validateSmtpConfig(smtpConfig);

		let mailer = null;
		try {
			let securityOptions = this.resolveSecurityOptions(smtpConfig.secure, smtpConfig.port);

			console.log('SMTP发送配置:', {
				host: smtpConfig.host,
				port: securityOptions.port,
				user: smtpConfig.user,
				secure: securityOptions.secure,
				startTls: securityOptions.startTls,
				securityMode: securityOptions.mode
			});

			try {
				mailer = await this.connectMailer(smtpConfig, securityOptions);
			} catch (connectError) {
				console.error('SMTP初始连接失败:', {
					message: connectError.message,
					code: connectError.code,
					stack: connectError.stack,
					config: {
						host: smtpConfig.host,
						port: securityOptions.port,
						secure: securityOptions.secure,
						startTls: securityOptions.startTls
					}
				});

				if (!this.isTlsHandshakeError(connectError)) {
					throw connectError;
				}

				const fallbackOptions = this.buildFallbackSecurityOptions(securityOptions);
				if (!fallbackOptions) {
					throw connectError;
				}

				console.warn('SMTP TLS握手失败，使用回退安全模式重试连接:', {
					host: smtpConfig.host,
					port: fallbackOptions.port,
					secure: fallbackOptions.secure,
					startTls: fallbackOptions.startTls,
					securityMode: fallbackOptions.mode
				});

				securityOptions = fallbackOptions;
				mailer = await this.connectMailer(smtpConfig, securityOptions);
			}

			const recipients = emailData.recipient.map(r => ({
				name: r.name || '',
				email: r.address
			}));

			const ccRecipients = Array.isArray(emailData.cc) ? emailData.cc.map(r => ({
				name: r.name || '',
				email: r.address || r
			})) : [];

			const bccRecipients = Array.isArray(emailData.bcc) ? emailData.bcc.map(r => ({
				name: r.name || '',
				email: r.address || r
			})) : [];

			await mailer.send({
				from: {
					name: emailData.name || smtpConfig.fromName || '',
					email: emailData.sendEmail
				},
				to: recipients,
				cc: ccRecipients.length > 0 ? ccRecipients : undefined,
				bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
				subject: emailData.subject,
				text: emailData.text,
				html: emailData.content,
				attachments: this.formatAttachments(emailData.attachments),
				headers: emailData.headers || {}
			});

			return {
				success: true,
				messageId: `smtp-${Date.now()}@${smtpConfig.host}`
			};

		} catch (error) {
			console.error('SMTP发送失败:', error);
			console.error('详细错误信息:', {
				message: error.message,
				code: error.code,
				errno: error.errno,
				syscall: error.syscall,
				host: smtpConfig.host,
				port: smtpConfig.port,
				secure: smtpConfig.secure,
				stack: error.stack
			});

			if (this.isProxyConnectError(error)) {
				const detail = error.message.includes('proxy request failed') 
					? 'Cloudflare outbound proxy failed' 
					: 'Network unreachable';
				throw new BizError(
					`${t('smtpSendFailed')}: cannot connect to SMTP server ${smtpConfig.host}:${smtpConfig.port} (${detail}). ` +
					'Please ensure the host is public and reachable, DNS resolves correctly, and firewall allows Cloudflare egress. ' +
					'If 587 fails, please try port 465 with SSL/TLS.'
				);
			}
			throw new BizError(t('smtpSendFailed') + ': ' + error.message);
		} finally {
			if (mailer) {
				try {
					if (typeof mailer.close === 'function') {
						await mailer.close();
					}
				} catch (e) {
					console.warn('关闭SMTP连接失败:', e);
				}
			}
		}
	},
	
	/**
	 * 格式化附件为worker-mailer格式
	 */
	formatAttachments(attachments) {
		if (!attachments || attachments.length === 0) {
			return [];
		}
		
		return attachments.map(att => ({
			filename: att.filename,
			content: att.content,  // base64编码
			mimeType: att.mimeType || att.contentType || att.mime_type
		}));
	},
	
	/**
	 * 验证SMTP配置
	 */
	async verify(c, smtpConfig) {
		this.validateSmtpConfig(smtpConfig);

		let mailer = null;
		try {
			let securityOptions = this.resolveSecurityOptions(smtpConfig.secure, smtpConfig.port);
			
			console.log('SMTP验证配置:', {
				host: smtpConfig.host,
				port: securityOptions.port,
				user: smtpConfig.user,
				secure: securityOptions.secure,
				startTls: securityOptions.startTls,
				securityMode: securityOptions.mode
			});
			
			try {
				// 使用统一的 connectMailer 方法，支持多认证方式和日志
				mailer = await this.connectMailer(smtpConfig, {
					...securityOptions,
					socketTimeoutMs: 10000,
					responseTimeoutMs: 5000
				});
			} catch (connectError) {
				console.error('SMTP验证初始连接失败:', {
					message: connectError.message,
					code: connectError.code,
					stack: connectError.stack,
					config: {
						host: smtpConfig.host,
						port: securityOptions.port,
						secure: securityOptions.secure,
						startTls: securityOptions.startTls
					}
				});

				if (!this.isTlsHandshakeError(connectError)) {
					throw connectError;
				}

				const fallbackOptions = this.buildFallbackSecurityOptions(securityOptions);
				if (!fallbackOptions) {
					throw connectError;
				}

				console.warn('SMTP验证TLS握手失败，使用回退安全模式重试连接:', {
					host: smtpConfig.host,
					port: fallbackOptions.port,
					secure: fallbackOptions.secure,
					startTls: fallbackOptions.startTls,
					securityMode: fallbackOptions.mode
				});

				securityOptions = fallbackOptions;
				mailer = await this.connectMailer(smtpConfig, {
					...securityOptions,
					socketTimeoutMs: 10000,
					responseTimeoutMs: 5000
				});
			}
			
			return { success: true, message: 'SMTP连接成功' };
			
		} catch (error) {
			console.error('SMTP验证失败:', error);
			console.error('详细错误信息:', {
				message: error.message,
				code: error.code,
				errno: error.errno,
				syscall: error.syscall,
				host: smtpConfig.host,
				port: smtpConfig.port,
				secure: smtpConfig.secure,
				stack: error.stack
			});
			if (this.isProxyConnectError(error)) {
				const detail = error.message.includes('proxy request failed') 
					? 'Cloudflare outbound proxy failed' 
					: 'Network unreachable';
				return {
					success: false,
					message: `cannot connect to SMTP server ${smtpConfig.host}:${smtpConfig.port} (${detail}). ` +
						'Please ensure host/port are publicly reachable from Cloudflare Workers. ' +
						'If 587 fails, please try port 465 with SSL/TLS.'
				};
			}
			return { success: false, message: error.message };
		} finally {
			if (mailer) {
				try {
					if (typeof mailer.close === 'function') {
						await mailer.close();
					}
				} catch (e) {
					console.warn('关闭SMTP验证连接失败:', e);
				}
			}
		}
	}
};

export default smtpService;
