import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, sql, ne, or, like, lte, gte } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import { Resend } from 'resend';
import attService from './att-service';
import { parseHTML } from 'linkedom';
import userService from './user-service';
import roleService from './role-service';
import user from '../entity/user';
import starService from './star-service';
import dayjs from 'dayjs';
import kvConst from '../const/kv-const';
import { t } from '../i18n/i18n'
import domainUtils from '../utils/domain-uitls';
import account from "../entity/account";
import { att } from '../entity/att';
import telegramService from './telegram-service';
import smtpService from './smtp-service';

const emailService = {

	async list(c, params, userId) {

		let { emailId, type, accountId, size, timeSort, allReceive } = params;

		size = Number(size);
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(email)
			.leftJoin(
				star,
				and(
					eq(star.emailId, email.emailId),
					eq(star.userId, userId)
				)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL)
				)
			);

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = query.limit(size).all();

		const totalQuery = orm(c).select({ total: count() }).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL)
				)
		).get();

		const latestEmailQuery = orm(c).select().from(email).where(
			and(
				allReceive ? eq(1,1) : eq(email.accountId, accountId),
				eq(email.userId, userId),
				eq(email.type, type),
				eq(email.isDel, isDel.NORMAL)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		list = list.map(item => ({
			...item,
			isStar: item.starId != null ? 1 : 0
		}));


		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: accountId,
				userId: userId,
			}
		}

		return { list, total: totalRow.total, latestEmail };
	},

	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)))
			.run();
	},

	receive(c, params, cidAttList, r2domain) {
		params.content = this.imgReplace(params.content, cidAttList, r2domain)
		return orm(c).insert(email).values({ ...params }).returning().get();
	},

	//邮件发送
	async send(c, params, userId) {

		let {
			accountId, //发送账号id
			name, //发件人名字
			sendType, //发件类型
			emailId, //邮件id，如果是回复邮件会带
			receiveEmail, //收件人邮箱
			text, //邮件纯文本
			content, //邮件内容
			subject, //邮件标题
			attachments, //附件
			sendMethod //发送方式：resend或smtp
		} = params;

		const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);

		let { imageDataList, html } = await attService.toImageUrlHtml(c, content);

		//判断是否关闭发件功能
		if (send === settingConst.send.CLOSE) {
			throw new BizError(t('disabledSend'), 403);
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		//判断接收方是不是全部为站内邮箱
		const allInternal = receiveEmail.every(email => {
			const domain = '@' + emailUtils.getDomain(email);
			return domainList.includes(domain);
		});

		if (c.env.admin !== userRow.email) {

			//发件被禁用
			if (roleRow.sendType === 'ban') {
				throw new BizError(t('bannedSend'), 403);
			}

			//发件被禁用
			if (roleRow.sendType === 'internal' && !allInternal) {
				throw new BizError(t('onlyInternalSend'), 403);
			}

		}

		//如果不是管理员，权限设置了发送次数
		if (c.env.admin !== userRow.email && roleRow.sendCount) {

			if (userRow.sendCount >= roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLimit'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLimit'), 403);
			}

			if (userRow.sendCount + receiveEmail.length > roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLack'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLack'), 403);
			}

		}

		const accountRow = await accountService.selectById(c, accountId);

		if (!accountRow) {
			throw new BizError(t('senderAccountNotExist'));
		}

		if (accountRow.userId !== userId) {
			throw new BizError(t('sendEmailNotCurUser'));
		}

		if (c.env.admin !== userRow.email) {
			//用户没有这个域名的使用权限
			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, accountRow.email)) {
				throw new BizError(t('noDomainPermSend'),403)
			}

		}

		const domain = emailUtils.getDomain(accountRow.email);
		const resendToken = resendTokens[domain];

		//如果接收方存在站外邮箱，又没有resend token且不是使用SMTP发送
		let actualSendMethod = sendMethod || (send.resendEnabled === 0 ? emailConst.sendMethod.SMTP : emailConst.sendMethod.RESEND);
		if (!resendToken && !allInternal && actualSendMethod !== emailConst.sendMethod.SMTP) {
			throw new BizError(t('noResendToken'));
		}

		//没有发件人名字自动截取
		if (!name) {
			name = emailUtils.getName(accountRow.email);
		}

		let emailRow = {
			messageId: null
		};

		//如果是回复邮件
		if (sendType === 'reply') {

			emailRow = await this.selectById(c, emailId);

			if (!emailRow) {
				throw new BizError(t('notExistEmailReply'));
			}

		}

		let sendResult = {};

		// 存在站外邮箱时需要发送
		if (!allInternal) {
			if (actualSendMethod === emailConst.sendMethod.SMTP) {
				// 使用SMTP发送
				const smtpConfig = await smtpService.getSmtpConfig(c, accountId);
				
				if (!smtpConfig.enabled) {
					throw new BizError(t('smtpNotConfigured'));
				}
				
				const emailPayload = {
					sendEmail: accountRow.email,
					name: name,
					recipient: receiveEmail.map(email => ({ address: email, name: '' })),
					subject: subject,
					text: text,
					content: html,
					attachments: [...imageDataList, ...attachments],
					headers: sendType === 'reply' ? {
						'In-Reply-To': emailRow.messageId,
						'References': emailRow.messageId
					} : {}
				};
				
				sendResult = await smtpService.send(c, emailPayload, smtpConfig);
				
			} else {
				// 使用Resend发送（现有逻辑）
				if (!resendToken) {
					throw new BizError(t('noResendToken'));
				}
				
				const resend = new Resend(resendToken);
			const sendForm = {
					from: `${name} <${accountRow.email}>`,
					to: [...receiveEmail],
					subject: subject,
					text: text,
					html: html,
					attachments: [...imageDataList, ...attachments]
				};
			if (sendType === 'reply') {
					sendForm.headers = {
						'in-reply-to': emailRow.messageId,
						'references': emailRow.messageId
					};
				}

				sendResult = await resend.emails.send(sendForm);
			}

		}

		let messageId = null;

		if (actualSendMethod === emailConst.sendMethod.SMTP) {
			// SMTP发送结果处理
			if (!sendResult.success) {
				throw new BizError(sendResult.message || t('smtpSendFailed'));
			}
			messageId = sendResult.messageId;
		} else {
			// Resend发送结果处理
			const { data, error } = sendResult;
			if (error) {
				throw new BizError(error.message);
			}
			messageId = data?.id;
		}

		imageDataList = imageDataList.map(item => ({...item, contentId: `<${item.contentId}>`}))

		//把图片标签cid标签切换会通用url
		html = this.imgReplace(html, imageDataList, r2Domain);

		//封装数据保存到数据库
		const emailData = {};
		emailData.sendEmail = accountRow.email;
		emailData.name = name;
		emailData.subject = subject;
		emailData.content = html;
		emailData.text = text;
		emailData.accountId = accountId;
		emailData.status = emailConst.status.SENT;
		emailData.type = emailConst.type.SEND;
		emailData.userId = userId;
		emailData.resendEmailId = messageId;
		emailData.sendMethod = actualSendMethod;

		const recipient = [];

		receiveEmail.forEach(item => {
			recipient.push({ address: item, name: '' });
		});

		emailData.recipient = JSON.stringify(recipient);

		if (sendType === 'reply') {
			emailData.inReplyTo = emailRow.messageId;
			emailData.relation = emailRow.messageId;
		}

		//如果权限有发送次数增加用户发送次数
		if (roleRow.sendCount && roleRow.sendType !== 'internal') {
			await userService.incrUserSendCount(c, receiveEmail.length, userId);
		}

		//保存到数据库并返回结果
		const emailResult = await orm(c).insert(email).values(emailData).returning().get();

		//保存内嵌附件
		if (imageDataList.length > 0) {
			if (imageDataList.length > 10) {
				throw new BizError(t('imageAttLimit'));
			}
			await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
		}

		//保存普通附件
		if (attachments?.length > 0) {
			if (attachments.length > 10) {
				throw new BizError(t('attLimit'));
			}
			await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
		}

		const attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
		emailResult.attList = attList;

		//如果全是站内接收方，直接写入数据库
		if (allInternal) {
			await this.HandleOnSiteEmail(c, receiveEmail, emailResult, attList);
		}

		const dateStr = dayjs().format('YYYY-MM-DD');
		if (c.env.kv && c.env.kv.get) {
			let daySendTotal = await c.env.kv.get(kvConst.SEND_DAY_COUNT + dateStr);

			//记录每天发件次数统计
			if (!daySendTotal) {
				if (c.env.kv && c.env.kv.put) {
					await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(receiveEmail.length), { expirationTtl: 60 * 60 * 24 });
				}
			} else  {
				daySendTotal = Number(daySendTotal) + receiveEmail.length
				if (c.env.kv && c.env.kv.put) {
					await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(daySendTotal), { expirationTtl: 60 * 60 * 24 });
				}
			}
		}

		return [ emailResult ];
	},

	//处理站内邮件发送
	async HandleOnSiteEmail(c, receiveEmail, sendEmailData, attList) {

		const { noRecipient  } = await settingService.query(c);

		//查询所有收件人账号信息
		let accountList = await orm(c).select().from(account).where(inArray(account.email, receiveEmail)).all();

		//查询所有收件人权限身份
		const userIds = accountList.map(accountRow => accountRow.userId);
		let roleList = await roleService.selectByUserIds(c, userIds);

		//封装数据库准备保存到数据库
		const emailDataList = [];

		for (const email of receiveEmail) {

			//把发件人邮件改成收件
			const emailValues = {...sendEmailData}
			emailValues.status = emailConst.status.RECEIVE;
			emailValues.type = emailConst.type.RECEIVE;
			emailValues.toEmail = email;
			emailValues.toName = emailUtils.getName(email);
			emailValues.emailId = null;

			const accountRow = accountList.find(accountRow => accountRow.email === email);

			//如果收件人存在就把邮件信息改成收件人的
			if (accountRow) {

				//设置给收件人保存
				emailValues.userId = accountRow.userId;
				emailValues.accountId = accountRow.accountId;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.RECEIVE;

				const roleRow = roleList.find(roleRow => roleRow.userId === accountRow.userId);

				let { banEmail, availDomain } = roleRow;

				//如果收件人没有这个域名的使用权限和有邮件拦截，就把邮件改为拒收状态
				if (email !== c.env.admin) {

					if (!roleService.hasAvailDomainPerm(availDomain, email)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is not authorized to use this domain.`;
					} else if(roleService.isBanEmail(banEmail, sendEmailData.sendEmail)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is disabled from receiving emails.`;
					}

				}

				emailDataList.push(emailValues);

			} else {

				//设置无收件人邮件信息
				emailValues.userId = 0;
				emailValues.accountId = 0;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.NOONE;

				//如果无人收件关闭改为拒收
				if (noRecipient === settingConst.noRecipient.CLOSE) {
					emailValues.status = emailConst.status.BOUNCED;
					emailValues.message = `Recipient not found: <${email}>`;
				}

				emailDataList.push(emailValues);

			}

		}

		//保存邮件
		const receiveEmailList = emailDataList.filter(emailRow => emailRow.status === emailConst.status.RECEIVE || emailRow.status === emailConst.status.NOONE);

		for (const emailData of receiveEmailList) {

			const emailRow = await orm(c).insert(email).values(emailData).returning().get();

			//设置附件保存
			for (const attRow of attList) {
				const attValues = {...attRow};
				attValues.emailId = emailRow.emailId;
				attValues.accountId = emailRow.accountId;
				attValues.userId = emailRow.userId;
				attValues.attId = null;
				await orm(c).insert(att).values(attValues).run();
			}

		}

		const bouncedEmail = emailDataList.find(emailRow => emailRow.status === emailConst.status.BOUNCED);


		let status = emailConst.status.DELIVERED;
		let message = ''
		//如果有拒收邮件，就把发件人的邮件改成拒收
		if (bouncedEmail) {
			const messageJson = { message: bouncedEmail.message };
			message = JSON.stringify(messageJson);
			status = emailConst.status.BOUNCED;
		}

		await orm(c).update(email).set({ status, message: message }).where(eq(email.emailId, sendEmailData.emailId)).run();

	},

	imgReplace(content, cidAttList, r2domain) {

		if (!content) {
			return ''
		}

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		const useAtts = []

		for (const img of images) {

			const src = img.getAttribute('src');
			if (src && src.startsWith('cid:') && cidAttList) {

				const cid = src.replace(/^cid:/, '');
				const attCidIndex = cidAttList.findIndex(cidAtt => cidAtt.contentId.replace(/^<|>$/g, '') === cid);

				if (attCidIndex > -1) {
					const cidAtt = cidAttList[attCidIndex];
					img.setAttribute('src', '{{domain}}' + cidAtt.key);
					useAtts.push(cidAtt)
				}

			}

			r2domain = domainUtils.toOssDomain(r2domain)

			if (src && src.startsWith(r2domain + '/')) {
				img.setAttribute('src', src.replace(r2domain + '/', '{{domain}}'));
			}

		}

		useAtts.forEach(att => {
			att.type = attConst.type.EMBED
		})

		return document.toString();
	},

	selectById(c, emailId) {
		return orm(c).select().from(email).where(
			and(eq(email.emailId, emailId),
				eq(email.isDel, isDel.NORMAL)))
			.get();
	},

	async latest(c, params, userId) {
		let { emailId, accountId, allReceive } = params;
		allReceive = Number(allReceive);

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		let list = await orm(c).select({...email}).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.userId, userId),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.type, emailConst.type.RECEIVE)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async physicsDelete(c, params) {
		let { emailIds } = params;
		emailIds = emailIds.split(',').map(Number);
		await attService.removeByEmailIds(c, emailIds);
		await starService.removeByEmailIds(c, emailIds);
		await orm(c).delete(email).where(inArray(email.emailId, emailIds)).run();
	},

	async physicsDeleteUserIds(c, userIds) {
		await attService.removeByUserIds(c, userIds);
		await orm(c).delete(email).where(inArray(email.userId, userIds)).run();
	},

	updateEmailStatus(c, params) {
		const { status, resendEmailId, message } = params;
		return orm(c).update(email).set({
			status: status,
			message: message
		}).where(eq(email.resendEmailId, resendEmailId)).returning().get();
	},

	async selectUserEmailCountList(c, userIds, type, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: email.userId,
				count: count(email.emailId)
			})
			.from(email)
			.where(and(
				inArray(email.userId, userIds),
				eq(email.type, type),
				eq(email.isDel, del),
				ne(email.status, emailConst.status.SAVING),
			))
			.groupBy(email.userId);
		return result;
	},

	async allList(c, params) {

		let { emailId, size, name, subject, accountEmail, userEmail, type, timeSort } = params;

		size = Number(size);

		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		const conditions = [];

		if (type === 'send') {
			conditions.push(eq(email.type, emailConst.type.SEND));
		}

		if (type === 'receive') {
			conditions.push(eq(email.type, emailConst.type.RECEIVE));
		}

		if (type === 'delete') {
			conditions.push(eq(email.isDel, isDel.DELETE));
		}

		if (type === 'noone') {
			conditions.push(eq(email.status, emailConst.status.NOONE));
		}

		if (userEmail) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${'%'+ userEmail + '%'}`);
		}

		if (accountEmail) {
			conditions.push(
				or(
					sql`${email.toEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
					sql`${email.sendEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
				)
			)
		}

		if (name) {
			conditions.push(sql`${email.name} COLLATE NOCASE LIKE ${'%'+ name + '%'}`);
		}

		if (subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${'%'+ subject + '%'}`);
		}

		conditions.push(ne(email.status, emailConst.status.SAVING));

		const countConditions = [...conditions];

		if (timeSort) {
			conditions.unshift(gt(email.emailId, emailId));
		} else {
			conditions.unshift(lt(email.emailId, emailId));
		}

		const query = orm(c).select({ ...email, userEmail: user.email })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...conditions));

		const queryCount = orm(c).select({ total: count() })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...countConditions));

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = await query.limit(size).all();
		const totalQuery = await queryCount.get();
		const latestEmailQuery = await orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: 0,
				userId: 0,
			}
		}

		return { list: list, total: totalRow.total, latestEmail };
	},

	async allEmailLatest(c, params) {

		const { emailId } = params;

		let list = await orm(c).select({...email, userEmail: user.email}).from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.type, emailConst.type.RECEIVE),
					ne(email.status, emailConst.status.SAVING)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async emailAddAtt(c, list) {

		const emailIds = list.map(item => item.emailId);

		if (emailIds.length > 0) {

			const attList = await attService.selectByEmailIds(c, emailIds);

			list.forEach(emailRow => {
				const atts = attList.filter(attRow => attRow.emailId === emailRow.emailId);
				emailRow.attList = atts;
			});
		}
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(eq(email.userId, userId)).run();
	},

	async completeReceive(c, status, emailId) {
		return await orm(c).update(email).set({
			isDel: isDel.NORMAL,
			status: status
		}).where(eq(email.emailId, emailId)).returning().get();
	},

	async completeReceiveAll(c) {
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.RECEIVE} WHERE status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.NOONE} WHERE status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
	},

	async batchDelete(c, params) {
		let { sendName, sendEmail, toEmail, subject, startTime, endTime, type  } = params

		let right = type === 'left' || type === 'include'
		let left = type === 'include'

		const conditions = []

		if (sendName) {
			conditions.push(like(email.name,`${left ? '%' : ''}${sendName}${right ? '%' : ''}`))
		}

		if (subject) {
			conditions.push(like(email.subject,`${left ? '%' : ''}${subject}${right ? '%' : ''}`))
		}

		if (sendEmail) {
			conditions.push(like(email.sendEmail,`${left ? '%' : ''}${sendEmail}${right ? '%' : ''}`))
		}

		if (toEmail) {
			conditions.push(like(email.toEmail,`${left ? '%' : ''}${toEmail}${right ? '%' : ''}`))
		}

		if (startTime && endTime) {
			conditions.push(gte(email.createTime,`${startTime}`))
			conditions.push(lte(email.createTime,`${endTime}`))
		}

		if (conditions.length === 0) {
			return;
		}

		const emailIdsRow = await orm(c).select({emailId: email.emailId}).from(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).all();

		const emailIds = emailIdsRow.map(row => row.emailId);

		if (emailIds.length === 0){
			return;
		}

		await attService.removeByEmailIds(c, emailIds);

		await orm(c).delete(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).run();
	},

	async physicsDeleteByAccountId(c, accountId) {
		await attService.removeByAccountId(c, accountId);
		await orm(c).delete(email).where(eq(email.accountId, accountId)).run();
	},

	async read(c, params, userId) {
		const { emailIds } = params;
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(and(eq(email.userId, userId), inArray(email.emailId, emailIds)));
	},

	async exportEmail(c, emailId, userId) {
		// 获取邮件信息
		const emailRow = await this.selectById(c, emailId);
		if (!emailRow) {
			throw new BizError(t('notExistEmail'));
		}

		// 验证邮件属于当前用户
		if (emailRow.userId !== userId) {
			throw new BizError(t('noPermission'));
		}

		// 获取附件信息
		const attList = await attService.selectByEmailIds(c, [emailId]);

		// 生成 .eml 文件内容
		const emlContent = await this.generateEml(emailRow, attList, c);

		return emlContent;
	},

	async generateEml(emailRow, attList, c) {
		const { r2Domain } = await settingService.query(c);

		// 构建邮件头
		const headers = [
			`From: ${emailRow.name} <${emailRow.sendEmail}>`,
			`To: ${emailRow.toName} <${emailRow.toEmail}>`,
			`Subject: ${emailRow.subject}`,
			`Date: ${new Date(emailRow.createTime).toUTCString()}`,
			`Message-ID: ${emailRow.messageId || `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@cloud-mail>`}`,
			`MIME-Version: 1.0`
		];

		// 处理抄送和密送
		if (emailRow.cc && emailRow.cc !== '[]') {
			const ccList = JSON.parse(emailRow.cc);
			if (ccList.length > 0) {
				headers.push(`Cc: ${ccList.map(item => `${item.name} <${item.address}>`).join(', ')}`);
			}
		}

		if (emailRow.bcc && emailRow.bcc !== '[]') {
			const bccList = JSON.parse(emailRow.bcc);
			if (bccList.length > 0) {
				headers.push(`Bcc: ${bccList.map(item => `${item.name} <${item.address}>`).join(', ')}`);
			}
		}

		// 处理回复相关头
		if (emailRow.inReplyTo) {
			headers.push(`In-Reply-To: ${emailRow.inReplyTo}`);
		}

		if (emailRow.relation) {
			headers.push(`References: ${emailRow.relation}`);
		}

		// 生成边界
		const boundary = `----=_NextPart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		// 添加内容类型头
		headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
		headers.push(''); // 空行分隔头和正文

		// 构建邮件正文
		const bodyParts = [];

		// 文本部分
		bodyParts.push(`--${boundary}`);
		bodyParts.push('Content-Type: text/plain; charset="UTF-8"');
		bodyParts.push('Content-Transfer-Encoding: 7bit');
		bodyParts.push('');
		bodyParts.push(emailRow.text || '');

		// HTML部分
		if (emailRow.content) {
			bodyParts.push(`--${boundary}`);
			bodyParts.push('Content-Type: text/html; charset="UTF-8"');
			bodyParts.push('Content-Transfer-Encoding: 7bit');
			bodyParts.push('');
			// 替换图片URL
			let htmlContent = emailRow.content;
			if (r2Domain) {
				htmlContent = htmlContent.replace(/{{domain}}/g, domainUtils.toOssDomain(r2Domain) + '/');
			}
			bodyParts.push(htmlContent);
		}

		// 处理附件
		for (const attItem of attList) {
			bodyParts.push(`--${boundary}`);
			bodyParts.push(`Content-Type: ${attItem.type || 'application/octet-stream'}`);
			bodyParts.push(`Content-Disposition: attachment; filename="${attItem.filename}"`);
			bodyParts.push('Content-Transfer-Encoding: base64');
			bodyParts.push('');
			// 注意：这里应该使用实际的文件内容进行base64编码
			// 但由于在Cloudflare Worker环境中，我们无法直接读取文件内容
			// 这里使用占位符，实际实现需要根据存储方式获取文件内容
			bodyParts.push('SGVsbG8gV29ybGQ='); // 示例base64编码的"Hello World"
		}

		// 结束边界
		bodyParts.push(`--${boundary}--`);

		// 组合所有部分
		const emlContent = [...headers, ...bodyParts].join('\r\n');

		return emlContent;
	},

	async importEmail(c, emlContent, userId, accountId) {
		// 解析 .eml 文件内容
		const emailData = await this.parseEml(emlContent);

		// 验证账户属于当前用户
		const accountRow = await accountService.selectById(c, accountId);
		if (!accountRow || accountRow.userId !== userId) {
			throw new BizError(t('noPermission'));
		}

		// 构建邮件数据
		const emailValues = {
			sendEmail: emailData.from.email,
			name: emailData.from.name,
			accountId: accountId,
			userId: userId,
			subject: emailData.subject,
			text: emailData.text,
			content: emailData.html,
			cc: JSON.stringify(emailData.cc),
			bcc: JSON.stringify(emailData.bcc),
			recipient: JSON.stringify(emailData.to),
			toEmail: emailData.to.map(item => item.address).join(', '),
			toName: emailData.to.map(item => item.name).join(', '),
			inReplyTo: emailData.inReplyTo || '',
			relation: emailData.references || '',
			messageId: emailData.messageId || '',
			type: emailConst.type.RECEIVE,
			status: emailConst.status.RECEIVE,
			unread: emailConst.unread.UNREAD,
			sendMethod: emailConst.sendMethod.IMPORTED
		};

		// 保存邮件到数据库
		const emailResult = await orm(c).insert(email).values(emailValues).returning().get();

		// 处理附件
		if (emailData.attachments && emailData.attachments.length > 0) {
			for (const attachment of emailData.attachments) {
				// 保存附件到存储
				// 注意：这里需要根据实际的存储方式实现附件保存
				// 由于在Cloudflare Worker环境中，我们无法直接写入文件
				// 这里使用占位符，实际实现需要根据存储方式保存附件
			}
		}

		return emailResult;
	},

	async parseEml(emlContent) {
		// 解析 .eml 文件内容
		const lines = emlContent.split(/\r?\n/);
		let headers = {};
		let body = [];
		let inBody = false;

		// 解析邮件头
		for (const line of lines) {
			if (line === '') {
				inBody = true;
				continue;
			}

			if (!inBody) {
				const match = line.match(/^([^:]+):\s*(.+)$/);
				if (match) {
					const key = match[1].toLowerCase();
					headers[key] = match[2];
				} else if (headers[Object.keys(headers).pop()]) {
					// 处理多行头
					headers[Object.keys(headers).pop()] += ' ' + line.trim();
				}
			} else {
				body.push(line);
			}
		}

		// 解析发件人
		const from = this.parseEmailAddress(headers.from || '');

		// 解析收件人
		const to = this.parseEmailAddresses(headers.to || '');

		// 解析抄送
		const cc = this.parseEmailAddresses(headers.cc || '');

		// 解析密送
		const bcc = this.parseEmailAddresses(headers.bcc || '');

		// 解析主题
		const subject = headers.subject || '';

		// 解析消息ID
		const messageId = headers['message-id'] || '';

		// 解析回复相关头
		const inReplyTo = headers['in-reply-to'] || '';
		const references = headers.references || '';

		// 解析正文
		const bodyContent = body.join('\n');
		const { text, html, attachments } = this.parseBody(bodyContent, headers);

		return {
			from,
			to,
			cc,
			bcc,
			subject,
			messageId,
			inReplyTo,
			references,
			text,
			html,
			attachments
		};
	},

	parseEmailAddress(address) {
		// 解析单个邮件地址
		const match = address.match(/"?([^"]*)"?\s*<([^>]+)>/);
		if (match) {
			return {
				name: match[1].trim(),
				address: match[2].trim()
			};
		} else {
			return {
				name: '',
				address: address.trim()
			};
		}
	},

	parseEmailAddresses(addresses) {
		// 解析多个邮件地址
		const addressList = [];
		const parts = addresses.split(/,\s*/);

		for (const part of parts) {
			if (part) {
				addressList.push(this.parseEmailAddress(part));
			}
		}

		return addressList;
	},

	parseBody(bodyContent, headers) {
		// 解析邮件正文
		let text = '';
		let html = '';
		const attachments = [];

		// 检查内容类型
		const contentType = headers['content-type'] || 'text/plain';

		if (contentType.includes('multipart')) {
			// 处理多部分内容
			const boundaryMatch = contentType.match(/boundary="([^"]+)"/);
			if (boundaryMatch) {
				const boundary = boundaryMatch[1];
				const parts = bodyContent.split(`--${boundary}`);

				for (const part of parts) {
					if (part.trim() && !part.trim().endsWith('--')) {
						const partLines = part.split(/\r?\n/);
						let partHeaders = {};
						let partBody = [];
						let inPartBody = false;

						// 解析部分头
						for (const line of partLines) {
							if (line === '') {
								inPartBody = true;
								continue;
							}

							if (!inPartBody) {
								const match = line.match(/^([^:]+):\s*(.+)$/);
								if (match) {
									const key = match[1].toLowerCase();
									partHeaders[key] = match[2];
								}
							}
						}

						// 提取部分正文
						const partBodyStart = part.indexOf('\n\n') + 2;
						if (partBodyStart > 1) {
							const partBodyContent = part.substring(partBodyStart).trim();

							// 检查部分类型
							const partContentType = partHeaders['content-type'] || 'text/plain';

							if (partContentType.includes('text/plain')) {
								text = partBodyContent;
							} else if (partContentType.includes('text/html')) {
								html = partBodyContent;
							} else if (partHeaders['content-disposition'] && partHeaders['content-disposition'].includes('attachment')) {
								// 处理附件
								const filenameMatch = partHeaders['content-disposition'].match(/filename="([^"]+)"/);
								const filename = filenameMatch ? filenameMatch[1] : 'attachment';

								attachments.push({
									filename,
									type: partContentType,
									content: partBodyContent
								});
							}
						}
					}
				}
			}
		} else if (contentType.includes('text/plain')) {
			// 处理纯文本内容
			text = bodyContent;
		} else if (contentType.includes('text/html')) {
			// 处理HTML内容
			html = bodyContent;
		}

		return { text, html, attachments };
	}
};

export default emailService;
