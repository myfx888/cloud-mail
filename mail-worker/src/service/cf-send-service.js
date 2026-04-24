import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

const cfSendService = {

	/**
	 * 检查 send_email binding 是否可用
	 */
	isAvailable(env) {
		return !!(env && env.SEND_EMAIL && typeof env.SEND_EMAIL.send === 'function');
	},

	/**
	 * 通过 Cloudflare send_email binding 发送邮件
	 * @param {object} c - Hono context (需要 c.env.SEND_EMAIL)
	 * @param {object} emailData
	 *   - sendEmail: string 发件人地址
	 *   - name: string 发件人名字
	 *   - recipient: Array<{ address: string, name: string }> 收件人
	 *   - cc: Array<{ address: string, name: string }> 抄送
	 *   - bcc: Array<{ address: string, name: string }> 密送
	 *   - subject: string 标题
	 *   - text: string 纯文本
	 *   - content: string HTML 内容
	 *   - attachments: Array<{ filename, content (base64), mimeType, contentId? }> 附件
	 *   - headers: object 自定义 Headers
	 * @returns {{ success: boolean, messageId: string }}
	 */
	async send(c, emailData) {
		if (!this.isAvailable(c.env)) {
			throw new BizError(t('cfBindingNotConfigured'));
		}

		try {
			const msg = createMimeMessage();

			// 发件人
			msg.setSender({
				name: emailData.name || '',
				addr: emailData.sendEmail
			});

			// 收件人
			const toAddresses = emailData.recipient.map(r => ({
				name: r.name || '',
				addr: r.address
			}));
			msg.setRecipient(toAddresses);

			// CC
			if (Array.isArray(emailData.cc) && emailData.cc.length > 0) {
				const ccAddresses = emailData.cc.map(r => ({
					name: r.name || '',
					addr: r.address
				}));
				msg.setCc(ccAddresses);
			}

			// BCC
			if (Array.isArray(emailData.bcc) && emailData.bcc.length > 0) {
				const bccAddresses = emailData.bcc.map(r => ({
					name: r.name || '',
					addr: r.address
				}));
				msg.setBcc(bccAddresses);
			}

			// 主题
			msg.setSubject(emailData.subject || '');

			// 自定义 Headers（如 In-Reply-To、References）
			if (emailData.headers && typeof emailData.headers === 'object') {
				for (const [key, value] of Object.entries(emailData.headers)) {
					if (value) {
						msg.setHeader(key, value);
					}
				}
			}

			// 纯文本内容
			if (emailData.text) {
				msg.addMessage({
					contentType: 'text/plain',
					data: emailData.text
				});
			}

			// HTML 内容
			if (emailData.content) {
				msg.addMessage({
					contentType: 'text/html',
					data: emailData.content
				});
			}

			// 内嵌图片附件 (CID)
			if (Array.isArray(emailData.attachments)) {
				for (const att of emailData.attachments) {
					if (att.contentId) {
						msg.addAttachment({
							filename: att.filename || 'image',
							contentType: att.mimeType || att.contentType || 'application/octet-stream',
							data: att.content,
							encoding: 'base64',
							headers: {
								'Content-ID': `<${att.contentId.replace(/^<|>$/g, '')}>`,
								'Content-Disposition': 'inline'
							}
						});
					}
				}
			}

			// 普通附件
			if (Array.isArray(emailData.attachments)) {
				for (const att of emailData.attachments) {
					if (!att.contentId) {
						msg.addAttachment({
							filename: att.filename || 'attachment',
							contentType: att.mimeType || att.contentType || 'application/octet-stream',
							data: att.content,
							encoding: 'base64'
						});
					}
				}
			}

			// 构造 EmailMessage 并发送
			const rawMessage = msg.asRaw();
			const firstRecipient = emailData.recipient[0]?.address;

			const message = new EmailMessage(
				emailData.sendEmail,
				firstRecipient,
				rawMessage
			);

			await c.env.SEND_EMAIL.send(message);

			const domain = emailData.sendEmail.split('@')[1] || 'unknown';
			return {
				success: true,
				messageId: `cf-${Date.now()}@${domain}`
			};

		} catch (error) {
			console.error('Cloudflare send_email 发送失败:', error);
			if (error instanceof BizError) {
				throw error;
			}
			throw new BizError(t('cfSendFailed') + ': ' + error.message);
		}
	}
};

export default cfSendService;
