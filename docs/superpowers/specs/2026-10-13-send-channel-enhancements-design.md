# 发送通道增强：Cloudflare SMTP 备用通道 + Mailcow 密码重置重发

日期：2026-10-13
状态：已确认设计，待实施
关联背景：抄送修复（183c5c9）后发送通道排查中发现的两项增强需求

---

## 背景

当前系统有三种发送方式（`entity-const.js > sendMethod`）：`resend` / `smtp` / `cloudflare`（send_email binding）。排查中确认了两类需求：

1. **CF 新版 Email Service 提供认证 SMTP 提交端点** `smtp.mx.cloudflare.net:465`（隐式 TLS）。已实测：`AUTH PLAIN LOGIN` 可用，SIZE 25MB，用户名为字面字符串 `api_token`，密码为带 "Email Sending: Edit" 权限的 Cloudflare API Token。它与 send_email binding 同走 cf-bounce 信封改写架构（"由 bounces@cf-bounce 代发"提示依旧存在）。价值：**凭据运行时可配、免改 wrangler 免重新部署、绕开 Workers 到第三方服务器的出口问题、增加备用通道**。
2. **Mailcow 开通的账号存在确定性 535 认证失败 bug**：`provisionSmtpByMailcowServer` / `provisionMailcowForAccount` 在"邮箱已存在于 mailcow"分支里，本地生成随机密码仅写入本地库（`applyMailcowSmtpConfig` 只写 `smtp_account` 表），**从未调用 mailcow API 把该密码设置到邮箱**。仅"新建邮箱"分支通过 `add/mailbox` 同步过密码。凡先有邮箱后接入的账号，SMTP 发送必然 535。

## 硬约束（用户明确要求）

- CF SMTP **单独放置、只作可选备用**：绝不进入自动发送方式解析链，现有 `smtp` 通道的代码、账户体系、UI 零改动。
- 两个功能相互独立，可分别实现、分别上线。

---

## 第一部分：Cloudflare SMTP 备用通道

### 架构

新增第四种发送方式 `cfsmtp`。**底层完全复用现有 SMTP 通道**：按发件人域名从设置中取出 token 凭据，构造 smtpConfig 后调用现有 `smtpService.send`。抄送修复、附件、TLS 回退、错误处理全部继承。

预期管理：该通道与 binding 一样走 cf-bounce 架构，收件方"代发"提示不会消失；其价值在免部署配置、冗余与出口可靠性。

### 后端改动（mail-worker）

| 文件 | 改动 |
|---|---|
| `src/const/entity-const.js` | `sendMethod` 增加 `CLOUDFLARE_SMTP: 'cfsmtp'` |
| `src/entity/setting.js` | 新增 `cfSmtpTokens: text('cf_smtp_tokens').default("{}").notNull()` |
| `src/service/setting-service.js` | 解析/保存 `cfSmtpTokens`，逻辑照抄 `resendTokens`（JSON 字符串 ↔ 对象） |
| `src/service/email-service.js` | `send()` 新增 `cfsmtp` 分支（见下） |
| `src/i18n/zh.js` / `en.js` | 新增 `cfSmtpNotConfigured` 等文案 |

`cfsmtp` 分支逻辑：

0. **同步放宽 `noResendToken` 守卫**（约 286 行）：现有条件 `actualSendMethod !== SMTP && actualSendMethod !== CLOUDFLARE` 会把显式选择 `cfsmtp` 的外部发送误拦，需追加 `&& actualSendMethod !== CLOUDFLARE_SMTP`。
1. 取发件账号域名：`emailUtils.getDomain(accountRow.email)`。
2. 从 `cfSmtpTokens[domain]` 取凭据；未命中抛 `BizError(t('cfSmtpNotConfigured'))`，**不静默回退**（掩盖配置缺失比失败更糟；前端"其他方式重试"可兜底）。
3. 命中则构造并调用：

```js
const smtpConfig = {
    enabled: true,
    host: 'smtp.mx.cloudflare.net',
    port: 465,
    secure: 1,              // 隐式 TLS
    authType: 'plain',
    user: token.user,
    password: token.password,
    fromName: name
};
sendResult = await smtpService.send(c, emailPayload, smtpConfig);
```

4. **自动解析链不动**：`actualSendMethod` 未指定时仍是 `binding 可用 → cloudflare`，`resend` 次之，最后 `smtp`。`cfsmtp` 只在用户显式选择时生效。

### 前端改动（mail-vue）

| 文件 | 改动 |
|---|---|
| `src/layout/write/index.vue` | 单选组新增「CF SMTP」按钮；显隐条件 = 当前发件域名已配 token；选中时**不显示** SMTP 账户选择框（token 按域名自动取）；"换其他方式重试"链（约 519-533 行）加入 `cfsmtp`（仅当域名已配）；三处默认选中逻辑（约 561/587/629 行）不含 `cfsmtp` |
| 设置页 SMTP 区 | 新增独立卡片「Cloudflare SMTP（备用）」：域名 + token 用户名 + token 密码的行编辑器（增删行），保存走现有设置保存接口；「测试连接」按钮直接复用现有 `POST /smtp/verify` 端点（传 host=smtp.mx.cloudflare.net、port=465、secure=1 与 token 凭据即可，无需新端点） |
| `src/i18n/zh.js` / `en.js` | 「CF SMTP」标签、未配置提示、设置卡片文案 |

域名可用性下发：设置查询接口在返回中附带 `cfSmtpDomains`（已配置 token 的域名数组），供写信页判断按钮显隐。

### 测试（vitest 单测，test/unit/）

- `cfSmtpTokens` 设置解析/保存 roundtrip（照 resendTokens 模式）。
- `cfsmtp` 分支：域名命中 → `smtpService.send` 收到 host/port/secure/user/password 正确的 config；未命中 → 抛 `cfSmtpNotConfigured`。
- `noResendToken` 守卫：无 resend token 时显式选择 `cfsmtp` 的外部发送不再被拦。
- 自动解析链回归：binding 可用时默认仍为 `cloudflare`，`cfsmtp` 不出现。

---

## 第二部分：Mailcow 密码重置并重发

### 治本：修 provisioning 的 exists 分支

"邮箱已存在"分支在生成新密码后、落库前，先调用 mailcow API 把密码真正设置到邮箱：

- `mailcowService.callApi(c, 'edit/mailbox', 'POST', { items: [email], attr: { password, password2 } }, server)`（mailcow.yaml `/api/v1/edit/mailbox` 规范）。
- 按 `createAccount` 同款 `isSuccess` 判断校验结果，失败抛 `BizError`。
- 成功后走现有 `applyMailcowSmtpConfig` 落库。保证"本地存的 = mailcow 里的"自开通起成立。
- 两处同步修复：`account-service.js > provisionSmtpByMailcowServer`（约 580-596 行）与 `provisionMailcowForAccount`（约 76-95 行）。

### 自愈：发送遇 535 时一键「重置密码并重发」

后端新端点 `POST /smtp/reset-mailcow-password`（body: `{ accountId }`，放 `src/api/smtp-api.js`）：

1. `userContext` 取 userId/isAdmin；`accountService.selectByIdAny` + `memberService.canAccessAccount` 权限校验（同 `/smtp/delete-mailcow-account` 守卫模式）。
2. `accountRow.mailcowServerId` 为空则抛 `t('mailcowAccountNotFound')`；`getServerById` 取服务器配置。
3. `resolvePassword` 生成新密码。
4. `callApi('edit/mailbox', ...)` 设置密码，按 `isSuccess` 模式校验，失败抛错。
5. `smtpAccountService.findByMailcowServer(c, accountId, serverId)` 定位对应 `smtp_account` 行，更新 `password`（无行则跳过本地更新，不报错）。
6. **不回传密码明文**，仅返回 `{ success: true }`。

前端（发送失败弹窗）：

- 显示条件：发件账号 `mailcowServerId` 非空，且失败信息匹配 `/535|authentication failed/i`。
- 点击 → 调 `reset-mailcow-password` → 成功后自动用原参数重发 → toast 结果；失败则展示错误。
- i18n：zh/en 按钮文案「重置 mailcow 密码并重发」及结果提示。

### 测试（vitest 单测）

- exists 分支：mock `callApi`，断言 `edit/mailbox` 被调用且 items/attr 正确，密码先同步后落库。
- reset 端点：无权限拒绝；`mailcowServerId` 为空拒绝；成功路径更新对应 `smtp_account` 行。
- 前端逻辑为 UI 行为，不写单测。

---

## 范围外（记录待办，不在本设计内）

- mailcow 服务器证书现为 `*.djshipregistry.com`，不覆盖 `mail.hornmaritime.org`：需在 mailcow 后台把 hornmaritime.org 加入证书域名重新签发（部署侧操作）。
- `hornmaritime.org` / `cmrshipregistry.org` 的 SPF/DKIM/DMARC DNS 修正（另行处理，部分已完成）。
- CF send_email binding 路径的"代发"提示为平台行为，不在任何改动范围内。
