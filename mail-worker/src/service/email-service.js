import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, sql, ne, or, like, lte, gte } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import memberService from './member-service';
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
import cfSendService from './cf-send-service';
import { parseEmailRaw } from '../utils/eml-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';

const emailService = {

	async list(c, params, userId) {

		let { emailId, type, accountId, size, timeSort, allReceive, deleted } = params;

		size = Number(size);
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);
		deleted = Number(deleted);

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

		// 共享邮箱：访问控制按成员身份
		let visible = [];
		if (allReceive) {
			visible = await memberService.getVisibleAccountIds(c, userId);
		} else {
			await memberService.assertMember(c, accountId, userId);
		}
		const accountCond = allReceive ? inArray(email.accountId, visible) : eq(email.accountId, accountId);
		const delCond = eq(email.isDel, deleted ? isDel.DELETE : isDel.NORMAL);

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(email)
			.leftJoin(
				star,
				eq(star.emailId, email.emailId)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
		.where(
			and(
				accountCond,
				timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId),
				eq(email.type, type),
				delCond,
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
					accountCond,
					eq(email.type, type),
					delCond,
					eq(account.isDel, isDel.NORMAL)
				)
		).get();

		const latestEmailQuery = orm(c).select({...email}).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
			and(
				accountCond,
				eq(email.type, type),
				delCond,
				eq(account.isDel, isDel.NORMAL)
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
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(inArray(email.emailId, emailIdList), inArray(email.accountId, visible)))
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
			cc, //抄送
			bcc, //密送
			text, //邮件纯文本
			content, //邮件内容
			subject, //邮件标题
			attachments, //附件
			sendMethod, //发送方式：resend或smtp
			smtpAccountId //SMTP账户ID
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

		await memberService.assertMember(c, accountRow.accountId, userId);

		if (c.env.admin !== userRow.email) {
			//用户没有这个域名的使用权限
			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, accountRow.email)) {
				throw new BizError(t('noDomainPermSend'),403)
			}

		}

		const domain = emailUtils.getDomain(accountRow.email);
		const resendToken = resendTokens[domain];

		//如果接收方存在站外邮箱，又没有resend token且不是使用SMTP发送
		let actualSendMethod = sendMethod;
		if (!actualSendMethod) {
			if (cfSendService.isAvailable(c.env)) {
				actualSendMethod = emailConst.sendMethod.CLOUDFLARE;
			} else if (send.resendEnabled !== 0) {
				actualSendMethod = emailConst.sendMethod.RESEND;
			} else {
				actualSendMethod = emailConst.sendMethod.SMTP;
			}
		}
		if (send.resendEnabled === 0 && actualSendMethod === emailConst.sendMethod.RESEND) {
			throw new BizError(t('noResendToken'));
		}
		if (!resendToken && !allInternal && actualSendMethod !== emailConst.sendMethod.SMTP && actualSendMethod !== emailConst.sendMethod.CLOUDFLARE) {
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
			if (actualSendMethod === emailConst.sendMethod.CLOUDFLARE) {
				// 使用 Cloudflare send_email 发送
				const emailPayload = {
					sendEmail: accountRow.email,
					name: name,
					recipient: receiveEmail.map(email => ({ address: email, name: '' })),
					cc: Array.isArray(cc) ? cc.map(email => ({ address: email, name: '' })) : (cc ? [{ address: cc, name: '' }] : []),
					bcc: Array.isArray(bcc) ? bcc.map(email => ({ address: email, name: '' })) : (bcc ? [{ address: bcc, name: '' }] : []),
					subject: subject,
					text: text,
					content: html,
					attachments: [...imageDataList, ...attachments],
					headers: sendType === 'reply' ? {
						'In-Reply-To': emailRow.messageId,
						'References': emailRow.messageId
					} : {}
				};

				sendResult = await cfSendService.send(c, emailPayload);

			} else if (actualSendMethod === emailConst.sendMethod.SMTP) {
				// 使用SMTP发送
				const smtpConfig = await smtpService.getSmtpConfig(c, accountId, smtpAccountId);
				
				if (!smtpConfig.enabled) {
					throw new BizError(t('smtpNotConfigured'));
				}
				
				const emailPayload = {
					sendEmail: accountRow.email,
					name: name,
					recipient: receiveEmail.map(email => ({ address: email, name: '' })),
					cc: Array.isArray(cc) ? cc.map(email => ({ address: email, name: '' })) : (cc ? [{ address: cc, name: '' }] : []),
					bcc: Array.isArray(bcc) ? bcc.map(email => ({ address: email, name: '' })) : (bcc ? [{ address: bcc, name: '' }] : []),
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

		if (actualSendMethod === emailConst.sendMethod.CLOUDFLARE) {
			// Cloudflare send_email 结果处理
			if (!sendResult.success) {
				throw new BizError(sendResult.message || t('cfSendFailed'));
			}
			messageId = sendResult.messageId;
		} else if (actualSendMethod === emailConst.sendMethod.SMTP) {
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
		let accountList = await orm(c).select().from(account).where(and(inArray(account.email, receiveEmail), eq(account.isDel, isDel.NORMAL))).all();

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

		let visible = [];
		if (allReceive) {
			visible = await memberService.getVisibleAccountIds(c, userId);
		} else {
			await memberService.assertMember(c, accountId, userId);
		}
		const accountCond = allReceive ? inArray(email.accountId, visible) : eq(email.accountId, accountId);

		let list = await orm(c).select({...email}).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					gt(email.emailId, emailId),
					accountCond,
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
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

		const t0 = Date.now();
		let [list, totalRow, latestEmail] = await Promise.all([
			query.limit(size).all(),
			queryCount.get(),
			orm(c).select().from(email)
				.where(and(
					eq(email.type, emailConst.type.RECEIVE),
					ne(email.status, emailConst.status.SAVING)
				))
				.orderBy(desc(email.emailId)).limit(1).get()
		]);
		const t1 = Date.now();
		await this.emailAddAtt(c, list);
		const t2 = Date.now();
		let _respSize = 0;
		try { _respSize = JSON.stringify({ list, total: totalRow?.total, latestEmail }).length; } catch (_) {}
		console.log('[allList] timing(ms):', { db: t1 - t0, att: t2 - t1, listLen: list?.length, total: totalRow?.total, respSize: _respSize });

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
			.leftJoin(account, eq(email.accountId, account.accountId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.type, emailConst.type.RECEIVE),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
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
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(and(inArray(email.accountId, visible), inArray(email.emailId, emailIds)));
	},

	async restore(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = String(emailIds).split(',').map(Number);
		const visible = await memberService.getVisibleAccountIds(c, userId);
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(
			and(inArray(email.emailId, emailIdList), inArray(email.accountId, visible))
		).run();
	},

	async claimHistoricalMails(c, emailAddress, userId, accountId) {
		try {
			// Find match NOONE emails
			const matchedEmails = await orm(c).select({ emailId: email.emailId })
				.from(email)
				.where(and(
					eq(email.status, emailConst.status.NOONE),
					eq(email.userId, 0),
					eq(email.accountId, 0),
					sql`LOWER(${email.toEmail}) = LOWER(${emailAddress})`
				))
				.all();

			if (matchedEmails.length === 0) {
				return;
			}

			const emailIds = matchedEmails.map(e => e.emailId);

			// Update emails
			await orm(c).update(email)
				.set({
					userId: userId,
					accountId: accountId,
					status: emailConst.status.RECEIVE
				})
				.where(inArray(email.emailId, emailIds))
				.run();

			// Update attachments
			await orm(c).update(att)
				.set({
					userId: userId,
					accountId: accountId
				})
				.where(inArray(att.emailId, emailIds))
				.run();

			console.log(`Successfully claimed ${emailIds.length} historical mails for ${emailAddress}`);
		} catch (error) {
			console.error(`Failed to claim historical mails for ${emailAddress}:`, error);
			// Option A: Not throwing error to avoid blocking account creation
		}
	},

	async exportEmail(c, emailId, userId) {
		// 获取邮件信息
		const emailRow = await this.selectById(c, emailId);
		if (!emailRow) {
			throw new BizError(t('notExistEmail'));
		}

		// 验证当前用户为该邮箱成员
		await memberService.assertMember(c, emailRow.accountId, userId);

		// 获取附件信息
		const attList = await attService.selectByEmailIds(c, [emailId]);

		// 生成 .eml 文件内容
		const emlContent = await this.generateEml(emailRow, attList, c);

		return emlContent;
	},

	async generateEml(emailRow, attList, c) {
		const { r2Domain } = await settingService.query(c);

		const headers = [
			`From: ${emailRow.name ? emailRow.name + ' ' : ''}<${emailRow.sendEmail}>`,
			`To: ${emailRow.toName ? emailRow.toName + ' ' : ''}<${emailRow.toEmail}>`,
			`Subject: ${this._encodeHeader(emailRow.subject || '')}`,
			`Date: ${emailRow.createTime ? new Date(emailRow.createTime).toUTCString() : new Date().toUTCString()}`,
			`Message-ID: ${emailRow.messageId || `<${Date.now()}.${Math.random().toString(36).slice(2)}@cloud-mail>`}`,
			`MIME-Version: 1.0`
		];

		if (emailRow.cc && emailRow.cc !== '[]') {
			try {
				const ccList = JSON.parse(emailRow.cc);
				if (ccList.length) {
					headers.push(`Cc: ${ccList.map(i => `${i.name ? i.name + ' ' : ''}<${i.address}>`).join(', ')}`);
				}
			} catch (_) {}
		}
		if (emailRow.inReplyTo) {
			headers.push(`In-Reply-To: ${emailRow.inReplyTo}`);
		}
		if (emailRow.relation) {
			headers.push(`References: ${emailRow.relation}`);
		}

		const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');

		const parts = [];
		parts.push(`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', this._b64(emailRow.text || ''));
		if (emailRow.content) {
			let html = emailRow.content;
			if (r2Domain) {
				html = html.replace(/\{\{domain\}\}/g, domainUtils.toOssDomain(r2Domain) + '/');
			}
			parts.push(`--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', this._b64(html));
		}
		for (const a of attList) {
			const obj = await r2Service.getObj(c, a.key);
			let bytes;
			if (obj) {
				const ab = await obj.arrayBuffer();
				bytes = new Uint8Array(ab);
			} else {
				bytes = new Uint8Array(0);
			}
			const disposition = a.contentId ? 'inline' : 'attachment';
			const ct = a.mimeType || 'application/octet-stream';
			const partHead = [`--${boundary}`, `Content-Type: ${ct}`, `Content-Disposition: ${disposition}; filename="${this._encodeHeader(a.filename || 'attachment')}"`, 'Content-Transfer-Encoding: base64'];
			if (a.contentId) {
				partHead.push(`Content-ID: <${a.contentId.replace(/^<|>$/g, '')}>`);
			}
			parts.push(...partHead, '', this._b64Bytes(bytes));
		}
		parts.push(`--${boundary}--`, '');
		return [...headers, ...parts].join('\r\n');
	},

	_encodeHeader(s) {
		if (!s) return '';
		if (!/[^\x00-\x7F]/.test(s)) return s;
		return '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
	},

	_b64(str) {
		return btoa(unescape(encodeURIComponent(str || '')));
	},

	_b64Bytes(bytes) {
		let bin = '';
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
		}
		return btoa(bin).replace(/(.{76})/g, '$1\r\n');
	},

	async importSingleEmail(c, parsed, opts = {}) {
		let toAddress = '';
		let accountId = 0, userId = 0, status = emailConst.status.NOONE;
		if (opts.forceAccount && opts.accountId) {
			accountId = opts.accountId;
			userId = opts.userId;
			status = emailConst.status.RECEIVE;
			toAddress = (parsed.to[0] && parsed.to[0].address) || '';
		} else {
			toAddress = opts.toAddress || (parsed.to[0] && parsed.to[0].address) || '';
			if (toAddress) {
				const acc = await accountService.selectByEmailIncludeDel(c, toAddress);
				if (acc && acc.isDel === isDel.NORMAL) {
					accountId = acc.accountId;
					userId = acc.userId;
					status = emailConst.status.RECEIVE;
				}
			}
		}

		const dup = await this.dedupExists(c, {
			messageId: parsed.messageId,
			sendEmail: parsed.from.address,
			toEmail: toAddress,
			subject: parsed.subject,
			accountId
		});
		if (dup) {
			return { action: 'skipped' };
		}

		const cidAttachments = parsed.attachments.filter(a => a.contentId);
		const emailValues = {
			sendEmail: parsed.from.address,
			name: parsed.from.name || emailUtils.getName(parsed.from.address),
			accountId, userId,
			subject: parsed.subject,
			text: parsed.text,
			content: this.imgReplace(parsed.html || '', cidAttachments, opts.r2Domain),
			cc: JSON.stringify(parsed.cc || []),
			bcc: JSON.stringify(parsed.bcc || []),
			recipient: JSON.stringify(parsed.to.length ? parsed.to : (toAddress ? [{ address: toAddress, name: '' }] : [])),
			toEmail: toAddress,
			toName: (parsed.to[0] && parsed.to[0].name) || '',
			inReplyTo: parsed.inReplyTo || '',
			relation: parsed.references || '',
			messageId: parsed.messageId || '',
			type: emailConst.type.RECEIVE,
			status,
			unread: emailConst.unread.UNREAD,
			sendMethod: emailConst.sendMethod.IMPORTED
		};
		if (parsed.date) {
			emailValues.createTime = parsed.date;
		}

		const emailRow = await orm(c).insert(email).values(emailValues).returning().get();

		const atts = [];
		for (const a of parsed.attachments) {
			const content = a.content;
			const hash = await fileUtils.getBuffHash(content);
			const ext = fileUtils.getExtFileName(a.filename || '');
			atts.push({
				key: constant.ATTACHMENT_PREFIX + hash + ext,
				filename: a.filename || 'attachment',
				mimeType: a.mimeType || 'application/octet-stream',
				size: content?.length ?? content?.byteLength ?? 0,
				contentId: a.contentId || null,
				disposition: a.disposition || (a.contentId ? 'inline' : 'attachment'),
				related: a.related || null,
				encoding: a.encoding || null,
				userId, accountId, emailId: emailRow.emailId,
				status: 0,
				type: a.contentId ? attConst.type.EMBED : attConst.type.ATT,
				_content: content
			});
		}
		if (atts.length > 0) {
			await attService.addAtt(c, atts.map(({ _content, ...rest }) => ({ ...rest, content: _content })));
		}
		return { action: 'imported', emailId: emailRow.emailId };
	},

	async dedupExists(c, { messageId, sendEmail, toEmail, subject, accountId }) {
		if (messageId) {
			if (accountId > 0) {
				const row = await orm(c).select({ id: email.emailId }).from(email)
					.where(and(eq(email.accountId, accountId), eq(email.messageId, messageId))).get();
				return !!row;
			}
			const row = await orm(c).select({ id: email.emailId }).from(email)
				.where(and(eq(email.toEmail, toEmail), eq(email.messageId, messageId))).get();
			return !!row;
		}
		const row = await orm(c).select({ id: email.emailId }).from(email).where(and(
			eq(email.sendEmail, sendEmail || ''),
			eq(email.toEmail, toEmail || ''),
			eq(email.subject, subject || '')
		)).get();
		return !!row;
	},

	async importEmail(c, emlContent, userId, accountId) {
		const accountRow = await accountService.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('accountNotExist'));
		}
		await memberService.assertMember(c, accountId, userId);
		const parsed = await parseEmailRaw(emlContent);
		return await this.importSingleEmail(c, parsed, { userId, accountId, forceAccount: true });
	},

	parseEmailRaw,
};

export default emailService;
