# Cloudflare Send Email Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Email Workers `send_email` binding as the highest-priority free sending method, alongside existing Resend and SMTP.

**Architecture:** New `cf-send-service.js` uses `mimetext` to construct MIME messages and `EmailMessage` from `cloudflare:email` to send via `env.SEND_EMAIL.send()`. `email-service.js` gains a `cloudflare` branch in its send flow. Frontend adds a Cloudflare radio button with smart defaults and a failure-retry dialog.

**Tech Stack:** Cloudflare Workers, `mimetext` (npm), `cloudflare:email` (built-in), Hono, Vue 3 + Element Plus

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `mail-worker/src/service/cf-send-service.js` | MIME construction + `env.SEND_EMAIL.send()` |
| Modify | `mail-worker/src/const/entity-const.js` | Add `CLOUDFLARE` sendMethod |
| Modify | `mail-worker/src/i18n/zh.js` | Add Chinese i18n keys |
| Modify | `mail-worker/src/i18n/en.js` | Add English i18n keys |
| Modify | `mail-worker/wrangler.toml` | Add `[[send_email]]` binding |
| Modify | `mail-worker/src/service/email-service.js` | Add cloudflare send branch + default logic |
| Modify | `mail-worker/src/service/setting-service.js` | Expose `sendEmailAvailable` in websiteConfig |
| Modify | `mail-worker/package.json` | Add `mimetext` dependency |
| Modify | `mail-vue/src/i18n/zh.js` | Frontend Chinese i18n |
| Modify | `mail-vue/src/i18n/en.js` | Frontend English i18n |
| Modify | `mail-vue/src/store/setting.js` | Add `sendEmailAvailable` state |
| Modify | `mail-vue/src/layout/write/index.vue` | Cloudflare radio button, smart default, retry dialog |

---

## Task 1: Add `mimetext` dependency

**Files:**
- Modify: `mail-worker/package.json`

- [ ] **Step 1: Install mimetext**

```bash
cd mail-worker
npm install mimetext
```

This adds `mimetext` to `dependencies` in `package.json`. Verify it appears:

```json
"mimetext": "^3.x.x"
```

- [ ] **Step 2: Commit**

```bash
git add mail-worker/package.json mail-worker/package-lock.json
git commit -m "chore: add mimetext dependency for MIME email construction"
```

---

## Task 2: Add `CLOUDFLARE` sendMethod constant + i18n keys (backend)

**Files:**
- Modify: `mail-worker/src/const/entity-const.js:58-62`
- Modify: `mail-worker/src/i18n/zh.js:68-69`
- Modify: `mail-worker/src/i18n/en.js:68-69`

- [ ] **Step 1: Add CLOUDFLARE to sendMethod enum**

In `mail-worker/src/const/entity-const.js`, change:

```js
sendMethod: {
    RESEND: 'resend',
    SMTP: 'smtp',
    IMPORTED: 'imported'
}
```

to:

```js
sendMethod: {
    RESEND: 'resend',
    SMTP: 'smtp',
    CLOUDFLARE: 'cloudflare',
    IMPORTED: 'imported'
}
```

- [ ] **Step 2: Add backend i18n keys (zh.js)**

In `mail-worker/src/i18n/zh.js`, after `smtpSendFailed` line (line 69), add:

```js
cfSendFailed: 'Cloudflare邮件发送失败',
cfBindingNotConfigured: 'Cloudflare send_email未配置',
```

- [ ] **Step 3: Add backend i18n keys (en.js)**

In `mail-worker/src/i18n/en.js`, after `smtpSendFailed` line (line 69), add:

```js
cfSendFailed: 'Cloudflare email send failed',
cfBindingNotConfigured: 'Cloudflare send_email binding not configured',
```

- [ ] **Step 4: Commit**

```bash
git add mail-worker/src/const/entity-const.js mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js
git commit -m "feat: add CLOUDFLARE sendMethod constant and i18n keys"
```

---

## Task 3: Create `cf-send-service.js`

**Files:**
- Create: `mail-worker/src/service/cf-send-service.js`

- [ ] **Step 1: Create the service file**

Create `mail-worker/src/service/cf-send-service.js` with the following content:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add mail-worker/src/service/cf-send-service.js
git commit -m "feat: create cf-send-service for Cloudflare send_email binding"
```

---

## Task 4: Add `[[send_email]]` binding to wrangler.toml

**Files:**
- Modify: `mail-worker/wrangler.toml`

- [ ] **Step 1: Add send_email binding**

In `mail-worker/wrangler.toml`, after the `[[kv_namespaces]]` block (after line 17), add:

```toml
[[send_email]]
name = "SEND_EMAIL"
```

- [ ] **Step 2: Commit**

```bash
git add mail-worker/wrangler.toml
git commit -m "feat: add send_email binding to wrangler.toml"
```

---

## Task 5: Integrate cloudflare send into `email-service.js`

**Files:**
- Modify: `mail-worker/src/service/email-service.js:1-10` (imports)
- Modify: `mail-worker/src/service/email-service.js:246` (default method logic)
- Modify: `mail-worker/src/service/email-service.js:250` (resend token guard)
- Modify: `mail-worker/src/service/email-service.js:277-327` (send branch)
- Modify: `mail-worker/src/service/email-service.js:331-346` (result handling)

- [ ] **Step 1: Add cfSendService import**

At the top of `mail-worker/src/service/email-service.js`, add after the existing imports:

```js
import cfSendService from './cf-send-service';
```

- [ ] **Step 2: Update actualSendMethod default logic**

Replace line 246:

```js
let actualSendMethod = sendMethod || (send.resendEnabled === 0 ? emailConst.sendMethod.SMTP : emailConst.sendMethod.RESEND);
```

with:

```js
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
```

- [ ] **Step 3: Update resend token guard to allow cloudflare**

Replace line 250:

```js
if (!resendToken && !allInternal && actualSendMethod !== emailConst.sendMethod.SMTP) {
    throw new BizError(t('noResendToken'));
}
```

with:

```js
if (!resendToken && !allInternal && actualSendMethod !== emailConst.sendMethod.SMTP && actualSendMethod !== emailConst.sendMethod.CLOUDFLARE) {
    throw new BizError(t('noResendToken'));
}
```

- [ ] **Step 4: Add cloudflare branch in send block**

In the `if (!allInternal)` block (around line 277), change from:

```js
if (!allInternal) {
    if (actualSendMethod === emailConst.sendMethod.SMTP) {
```

to add a new cloudflare branch before the SMTP branch:

```js
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
```

This turns the existing `if (SMTP)` into `else if (SMTP)`.

- [ ] **Step 5: Update result handling to support cloudflare**

Replace lines 331-346:

```js
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
```

with:

```js
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
```

- [ ] **Step 6: Commit**

```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat: integrate cloudflare send_email into email send flow"
```

---

## Task 6: Expose `sendEmailAvailable` in websiteConfig

**Files:**
- Modify: `mail-worker/src/service/setting-service.js:465-497`

- [ ] **Step 1: Add sendEmailAvailable to websiteConfig return value**

In `mail-worker/src/service/setting-service.js`, in the `websiteConfig()` method's return object (around line 465-497), add a new field after `minEmailPrefix`:

```js
minEmailPrefix: settingRow.minEmailPrefix,
sendEmailAvailable: !!(c.env.SEND_EMAIL && typeof c.env.SEND_EMAIL.send === 'function')
```

Note: change the existing last line `minEmailPrefix: settingRow.minEmailPrefix` to add a comma.

- [ ] **Step 2: Commit**

```bash
git add mail-worker/src/service/setting-service.js
git commit -m "feat: expose sendEmailAvailable in websiteConfig API"
```

---

## Task 7: Frontend i18n keys

**Files:**
- Modify: `mail-vue/src/i18n/zh.js`
- Modify: `mail-vue/src/i18n/en.js`

- [ ] **Step 1: Add Chinese i18n keys**

In `mail-vue/src/i18n/zh.js`, after the `sendMethod: '发送方式'` line, add:

```js
cloudflare: 'Cloudflare',
sendFailRetryTitle: '发送失败',
sendFailRetryMsg: '发送失败: {msg}。是否使用其他方式重试？',
switchMethodRetry: '切换方式重试',
```

- [ ] **Step 2: Add English i18n keys**

In `mail-vue/src/i18n/en.js`, after the `sendMethod: 'Send Method'` line, add:

```js
cloudflare: 'Cloudflare',
sendFailRetryTitle: 'Send Failed',
sendFailRetryMsg: 'Send failed: {msg}. Retry with another method?',
switchMethodRetry: 'Switch & Retry',
```

- [ ] **Step 3: Commit**

```bash
git add mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat: add cloudflare send frontend i18n keys"
```

---

## Task 8: Update setting store

**Files:**
- Modify: `mail-vue/src/store/setting.js`

- [ ] **Step 1: Add sendEmailAvailable to store state**

In `mail-vue/src/store/setting.js`, change:

```js
settings: {
    r2Domain: '',
    loginOpacity: 1.00,
    resendEnabled: 1,
},
```

to:

```js
settings: {
    r2Domain: '',
    loginOpacity: 1.00,
    resendEnabled: 1,
    sendEmailAvailable: false,
},
```

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/store/setting.js
git commit -m "feat: add sendEmailAvailable to setting store"
```

---

## Task 9: Update write/index.vue — smart default + Cloudflare option + retry dialog

**Files:**
- Modify: `mail-vue/src/layout/write/index.vue`

- [ ] **Step 1: Add sendEmailAvailable computed property**

In the `<script setup>` section, after the `resendEnabled` computed (around line 208), add:

```js
const sendEmailAvailable = computed(() => !!settingStore.settings?.sendEmailAvailable)
```

- [ ] **Step 2: Update form.sendMethod default**

Change the default in `form` reactive (around line 201):

```js
sendMethod: 'resend',
```

This will be dynamically set, so leave the reactive default. Instead update the `resetForm` function (around line 529) from:

```js
form.sendMethod = resendEnabled.value ? 'resend' : 'smtp'
```

to:

```js
form.sendMethod = sendEmailAvailable.value ? 'cloudflare' : (resendEnabled.value ? 'resend' : 'smtp')
```

- [ ] **Step 3: Update the watch on resendEnabled**

Change the `watch(resendEnabled, ...)` block (around line 219-223) from:

```js
watch(resendEnabled, (enabled) => {
  if (!enabled) {
    form.sendMethod = 'smtp'
  }
})
```

to:

```js
watch(resendEnabled, (enabled) => {
  if (!enabled && !sendEmailAvailable.value) {
    form.sendMethod = 'smtp'
  }
})
```

- [ ] **Step 4: Update radio-group template**

Replace the existing radio-group (around line 81-84):

```html
<el-radio-group v-model="form.sendMethod" size="small" v-if="form.sendType !== 'reply' && resendEnabled">
  <el-radio-button value="resend">Resend</el-radio-button>
  <el-radio-button value="smtp">SMTP</el-radio-button>
</el-radio-group>
```

with:

```html
<el-radio-group v-model="form.sendMethod" size="small" v-if="form.sendType !== 'reply' && (sendEmailAvailable || resendEnabled)">
  <el-radio-button value="cloudflare" v-if="sendEmailAvailable">Cloudflare</el-radio-button>
  <el-radio-button value="resend" v-if="resendEnabled">Resend</el-radio-button>
  <el-radio-button value="smtp">SMTP</el-radio-button>
</el-radio-group>
```

- [ ] **Step 5: Add retry dialog on send failure**

In the `sendEmail()` function, locate the `.catch` block of `emailSend(form, ...)` (around line 490+). The current error handling ends at the catch. Add a retry dialog. Find:

```js
}).catch(e => {
```

and in the catch handler, after existing error handling, add retry logic:

```js
// 发送失败询问用户是否切换方式重试
const availableMethods = []
if (sendEmailAvailable.value && form.sendMethod !== 'cloudflare') availableMethods.push('cloudflare')
if (resendEnabled.value && form.sendMethod !== 'resend') availableMethods.push('resend')
if (form.sendMethod !== 'smtp') availableMethods.push('smtp')

if (availableMethods.length > 0) {
  ElMessageBox.confirm(
    t('sendFailRetryMsg', { msg: e?.response?.data?.message || e?.message || t('sendFailMsg') }),
    t('sendFailRetryTitle'),
    {
      confirmButtonText: t('switchMethodRetry'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    }
  ).then(() => {
    form.sendMethod = availableMethods[0]
    show.value = true
  }).catch(() => {})
}
```

Note: Carefully integrate this into the existing catch block without removing existing error notification logic.

- [ ] **Step 6: Update showSmtpSelector computed**

Update the `showSmtpSelector` computed (around line 209-217) to also account for cloudflare. Change:

```js
const showSmtpSelector = computed(() => {
  if (form.sendType === 'reply') {
    return smtpAccounts.value.length > 0
  }
  if (!resendEnabled.value) {
    return smtpAccounts.value.length > 0
  }
  return form.sendMethod === 'smtp' && smtpAccounts.value.length > 0
})
```

to:

```js
const showSmtpSelector = computed(() => {
  if (form.sendType === 'reply') {
    return smtpAccounts.value.length > 0
  }
  if (!resendEnabled.value && !sendEmailAvailable.value) {
    return smtpAccounts.value.length > 0
  }
  return form.sendMethod === 'smtp' && smtpAccounts.value.length > 0
})
```

- [ ] **Step 7: Commit**

```bash
git add mail-vue/src/layout/write/index.vue
git commit -m "feat: add Cloudflare send option with smart default and retry dialog"
```

---

## Task 10: Manual end-to-end verification

- [ ] **Step 1: Start dev server and verify**

```bash
cd mail-worker
npm run dev
```

Verify the worker starts without errors. Check console for any import issues.

- [ ] **Step 2: Verify websiteConfig returns sendEmailAvailable**

Open browser or use curl to call the websiteConfig endpoint. Confirm `sendEmailAvailable` field is present (should be `true` if `[[send_email]]` binding is in wrangler-dev.toml, `false` otherwise).

- [ ] **Step 3: Test frontend**

Start the Vue dev server, open the compose page. Verify:
1. If `sendEmailAvailable` is `true`: Cloudflare is default, radio shows 3 options
2. If `sendEmailAvailable` is `false`: Cloudflare option is hidden, Resend/SMTP as before
3. Send an email with Cloudflare method selected — confirm success or meaningful error
4. On failure, retry dialog appears with alternative methods

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Cloudflare send_email binding integration"
```
