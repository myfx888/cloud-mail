# Cloudflare Send Email Binding 发送功能设计

## 概述

在现有 Resend / SMTP / Internal 三种邮件发送方式基础上，新增第 4 种发送方式：**Cloudflare Email Workers `send_email` binding**。该方式利用 Cloudflare 原生邮件基础设施，免费、无需外部 SMTP 服务器或 API Key。

## 目标

- 作为**最高优先级免费通道**：binding 存在时默认选中
- 用户在发件页面**自由切换**发送方式（Cloudflare / Resend / SMTP）
- 发送失败时**前端弹窗询问**用户是否用其他方式重试（非自动回退）
- **全功能对等**：HTML、纯文本、附件、内嵌图片、CC/BCC、回复引用、自定义 Headers

## 架构

### sendMethod 枚举

```
resend   → Resend API
smtp     → 自建 SMTP（WorkerMailer）
cloudflare → Cloudflare send_email binding
imported → 导入（只读）
```

### 发送优先级（前端默认值选择）

```
if (env.SEND_EMAIL 存在) → 默认 'cloudflare'
else if (resendEnabled)  → 默认 'resend'
else                     → 默认 'smtp'
```

前端通过 `websiteConfig` 接口返回的 `sendEmailAvailable` 字段判断 binding 是否可用。

### 数据流

```
用户点击发送 (sendMethod='cloudflare')
  → POST /email/send { ..., sendMethod: 'cloudflare' }
    → email-service.send()
      → cfSendService.send(c, emailPayload)
        → mimetext 构造 MIME 消息
        → new EmailMessage(from, to, mime.asRaw())
        → env.SEND_EMAIL.send(message)
      → 成功: 保存 DB, 返回结果
      → 失败: 抛出 BizError
        → 前端收到错误 → 弹窗询问是否用其他方式重试
```

## 后端改动

### 1. wrangler.toml

新增 send_email binding（无限制模式）：

```toml
[[send_email]]
name = "SEND_EMAIL"
```

不指定 `destination_address`，可发往任意地址。发件人必须是 Email Routing 活跃域名的地址（与现有 `domain` 配置一致）。

### 2. entity-const.js

`emailConst.sendMethod` 新增：

```js
sendMethod: {
  RESEND: 'resend',
  SMTP: 'smtp',
  CLOUDFLARE: 'cloudflare',
  IMPORTED: 'imported'
}
```

### 3. 新建 src/service/cf-send-service.js

核心服务，封装 Cloudflare send_email 发送逻辑：

**职责**：
- 使用 `mimetext` 库（`createMimeMessage`）构造完整 MIME 邮件
- 支持 HTML 内容 + 纯文本 fallback（multipart/alternative）
- 支持普通附件（base64 编码）
- 支持内嵌图片（CID 引用）
- 支持 CC / BCC
- 支持回复引用 Headers（In-Reply-To、References）
- 支持自定义 Headers
- 通过 `EmailMessage`（from `cloudflare:email`）封装 MIME raw 内容
- 调用 `env.SEND_EMAIL.send(message)` 发送

**接口**：

```js
const cfSendService = {
  /**
   * 检查 send_email binding 是否可用
   */
  isAvailable(env) {
    return !!(env && env.SEND_EMAIL && typeof env.SEND_EMAIL.send === 'function');
  },

  /**
   * 通过 Cloudflare send_email 发送邮件
   * @param {object} c - Hono context
   * @param {object} emailData - 邮件数据
   *   - sendEmail: 发件人地址
   *   - name: 发件人名字
   *   - recipient: [{ address, name }]
   *   - cc: [{ address, name }]
   *   - bcc: [{ address, name }]
   *   - subject: 标题
   *   - text: 纯文本
   *   - content: HTML 内容
   *   - attachments: [{ filename, content (base64), mimeType, contentId? }]
   *   - headers: { key: value }
   * @returns {{ success: boolean, messageId: string }}
   */
  async send(c, emailData) { ... }
};
```

**错误处理**：
- binding 不存在 → 抛出 BizError（'Cloudflare send_email binding 未配置'）
- 发送失败 → 捕获异常，包装为 BizError 返回具体错误信息

### 4. email-service.js → send()

在现有 `if (!allInternal)` 分支中新增 `cloudflare` 路径：

```js
if (actualSendMethod === emailConst.sendMethod.CLOUDFLARE) {
  // 使用 Cloudflare send_email 发送
  const emailPayload = {
    sendEmail: accountRow.email,
    name,
    recipient: receiveEmail.map(email => ({ address: email, name: '' })),
    cc: ...,
    bcc: ...,
    subject,
    text,
    content: html,
    attachments: [...imageDataList, ...attachments],
    headers: sendType === 'reply' ? { 'In-Reply-To': ..., 'References': ... } : {}
  };
  sendResult = await cfSendService.send(c, emailPayload);
}
```

结果处理逻辑与 SMTP 类似（检查 `sendResult.success`，提取 `messageId`）。

### 5. email-service.js → send() 默认方式选择

更新 `actualSendMethod` 的默认值逻辑：

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

### 6. setting-service.js → websiteConfig()

返回值新增 `sendEmailAvailable` 字段：

```js
sendEmailAvailable: !!(c.env.SEND_EMAIL && typeof c.env.SEND_EMAIL.send === 'function')
```

### 7. 依赖

新增 npm 依赖：

```
mimetext@^3.x
```

用于构造符合 RFC 2822 的 MIME 邮件消息。

## 前端改动

### 1. write/index.vue

**radio-group 改动**：

在现有 Resend / SMTP 按钮组旁新增 Cloudflare 选项：

```html
<el-radio-group v-model="form.sendMethod" size="small" v-if="showMethodSelector">
  <el-radio-button value="cloudflare" v-if="sendEmailAvailable">Cloudflare</el-radio-button>
  <el-radio-button value="resend" v-if="resendEnabled">Resend</el-radio-button>
  <el-radio-button value="smtp">SMTP</el-radio-button>
</el-radio-group>
```

**智能默认逻辑**：

```js
const sendEmailAvailable = computed(() => !!settingStore.settings?.sendEmailAvailable)

// 默认值选择
form.sendMethod = sendEmailAvailable.value
  ? 'cloudflare'
  : (resendEnabled.value ? 'resend' : 'smtp')
```

**发送失败重试弹窗**：

```js
emailSend(form, progress).then(...).catch(error => {
  // 弹窗询问用户是否用其他方式重试
  ElMessageBox.confirm(
    `发送失败: ${error.message}。是否使用其他方式重试？`,
    '发送失败',
    { confirmButtonText: '切换方式重试', cancelButtonText: '取消' }
  ).then(() => {
    // 显示发送方式选择，用户选择后重新发送
  })
})
```

**showMethodSelector 显示逻辑**：

```js
const showMethodSelector = computed(() => {
  if (form.sendType === 'reply') return false  // 回复时隐藏选择器（沿用现有行为或按需调整）
  // 有多于一种可用方式时显示选择器
  const methods = [sendEmailAvailable.value, resendEnabled.value, true /* smtp always available */]
  return methods.filter(Boolean).length > 1
})
```

### 2. store/setting.js

state 新增：

```js
settings: {
  r2Domain: '',
  loginOpacity: 1.00,
  resendEnabled: 1,
  sendEmailAvailable: false,  // 新增
}
```

### 3. i18n

新增翻译 key：

| key | zh | en |
|-----|----|----|
| `cfSendFailed` | Cloudflare 发送失败 | Cloudflare send failed |
| `cfBindingNotConfigured` | Cloudflare send_email 未配置 | Cloudflare send_email binding not configured |
| `retrySendWithOtherMethod` | 是否使用其他方式重试？ | Retry with another method? |
| `switchMethodRetry` | 切换方式重试 | Switch method and retry |

## 限制与约束

1. **发件人域名**：必须是 Cloudflare Email Routing 活跃域名，与现有 `domain` 配置天然兼容
2. **邮件大小**：Cloudflare Email Workers 原始邮件大小限制 25MB
3. **binding 依赖**：需在 `wrangler.toml` 中配置 `[[send_email]]`，未配置时前端自动隐藏该选项
4. **无状态追踪**：Cloudflare send_email 不提供投递状态回调（不像 Resend 有 webhook），messageId 使用自生成格式 `cf-{timestamp}@{domain}`

## 测试要点

1. binding 存在时，默认选中 Cloudflare，发送成功
2. binding 不存在时，隐藏 Cloudflare 选项，回退到 Resend/SMTP
3. Cloudflare 发送失败时，弹窗提示用户切换方式
4. 全功能验证：HTML、附件、内嵌图片、CC/BCC、回复邮件
5. 大附件（接近 25MB 限制）的边界测试
6. 与现有 sendMethod（resend/smtp）的兼容性：数据库存储、邮件列表显示
