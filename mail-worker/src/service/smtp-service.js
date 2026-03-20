import { WorkerMailer } from 'worker-mailer';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import accountService from './account-service';
import settingService from './setting-service';

const smtpService = {
	
	/**
	 * 获取有效的SMTP配置
	 * 优先使用账号配置，其次使用全局配置
	 */
	async getSmtpConfig(c, accountId) {
		const [settingRow, accountRow] = await Promise.all([
			settingService.query(c),
			accountService.selectById(c, accountId)
		]);
		
		// 检查是否启用SMTP
		const globalEnabled = settingRow.smtpEnabled === 1;
		const accountOverride = accountRow?.smtpOverride === 1;
		
		// 如果账号覆盖，使用账号配置
		if (accountOverride && accountRow.smtpHost) {
			return {
				enabled: true,
				host: accountRow.smtpHost,
				port: accountRow.smtpPort || settingRow.smtpPort,
				user: accountRow.smtpUser,
				password: accountRow.smtpPassword,
				secure: accountRow.smtpSecure >= 0 ? accountRow.smtpSecure : settingRow.smtpSecure,
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
			fromName: settingRow.smtpFromName
		};
	},
	
	/**
	 * 通过SMTP发送邮件
	 */
	async send(c, emailData, smtpConfig) {
		try {
			// 确定安全设置
			const isSecure = smtpConfig.secure === 1;
			const useStartTls = !isSecure && smtpConfig.port === 587;
			
			// 连接SMTP服务器
			const mailer = await WorkerMailer.connect({
				credentials: {
					username: smtpConfig.user,
					password: smtpConfig.password
				},
				authType: 'plain',
				host: smtpConfig.host,
				port: smtpConfig.port,
				secure: isSecure,
				startTls: useStartTls,
				socketTimeoutMs: 30000,
				responseTimeoutMs: 15000
			});
			
			// 构建收件人列表
			const recipients = emailData.recipient.map(r => ({
				name: r.name || '',
				email: r.address
			}));
			
			// 发送邮件
			await mailer.send({
				from: {
					name: emailData.name || smtpConfig.fromName || '',
					email: emailData.sendEmail
				},
				to: recipients,
				subject: emailData.subject,
				text: emailData.text,
				html: emailData.content,
				attachments: this.formatAttachments(emailData.attachments),
				headers: emailData.headers || {}
			});
			
			// 返回成功结果
			return {
				success: true,
				messageId: `smtp-${Date.now()}@${smtpConfig.host}`
			};
			
		} catch (error) {
			console.error('SMTP发送失败:', error);
			throw new BizError(t('smtpSendFailed') + ': ' + error.message);
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
			contentType: att.contentType || att.mime_type
		}));
	},
	
	/**
	 * 验证SMTP配置
	 */
	async verify(c, smtpConfig) {
		try {
			const isSecure = smtpConfig.secure === 1;
			const useStartTls = !isSecure && smtpConfig.port === 587;
			
			const mailer = await WorkerMailer.connect({
				credentials: {
					username: smtpConfig.user,
					password: smtpConfig.password
				},
				authType: 'plain',
				host: smtpConfig.host,
				port: smtpConfig.port,
				secure: isSecure,
				startTls: useStartTls,
				socketTimeoutMs: 10000,
				responseTimeoutMs: 5000
			});
			
			// 连接成功，返回true
			return { success: true, message: 'SMTP连接成功' };
			
		} catch (error) {
			return { success: false, message: error.message };
		}
	}
};

export default smtpService;
