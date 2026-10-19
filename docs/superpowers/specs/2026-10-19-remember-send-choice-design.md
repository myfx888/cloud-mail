# 设计：按邮箱账号记忆上次发送选项

- 日期：2026-10-19
- 状态：设计已获用户口头确认
- 关联：复刻签名功能"记住上次选择"模式（`account_member.last_sig_scope/last_sig_id` + resolve 接口）

## 背景与目标

写信页（`mail-vue/src/layout/write/index.vue`）的发送方式单选（`form.sendMethod`：cloudflare / resend / cfsmtp / smtp）及 SMTP 账户选择，目前在每次打开写信页时被强制重置为默认链（cloudflare → resend → smtp），用户上次成功发送用的方式被覆盖。

目标：**每个邮箱账号**记住该用户上次**发送成功**时的发送选项；下次为同一邮箱打开写信页时自动恢复。

## 已确认的决策

| 决策点 | 结论 | 来源 |
| --- | --- | --- |
| 存储位置 | 后端 D1（跨设备生效） | 用户确认 |
| 记忆粒度 | 按邮箱账号（同一用户不同邮箱各自记忆） | 用户确认 |
| 记忆内容 | 发送方式 + SMTP 账户选择（方式为 smtp 时） | 默认（用户未答，取功能完整性） |
| 保存时机 | 仅发送成功时保存，失败不覆盖 | 默认（贴合用户原话"上次发送的选项"） |
| 存储结构 | `account_member` 表加列（方案A，复刻签名模式） | 默认（用户未答，取推荐项） |
| 记忆值不可用 | 回退现有默认链，不报错 | 默认（惯例） |

## 数据层（mail-worker）

`account_member` 表（每 邮箱×用户 一行）新增两列：

```sql
ALTER TABLE account_member ADD COLUMN last_send_method TEXT NOT NULL DEFAULT '';
ALTER TABLE account_member ADD COLUMN last_smtp_account_id INTEGER NOT NULL DEFAULT 0;
```

- 迁移：`init.js` 新增 `v4_7DB()`，try/catch 幂等（同 `v4_6DB` 款式），在 init 序列挂载。
- 实体：`src/entity/account-member.js` 增加 `lastSendMethod` / `lastSmtpAccountId` 字段。

## 后端接口（2 个）

放在 `src/api/account-api.js` 签名接口旁：

1. `PUT /mailbox/:accountId/send-choice` — body `{ sendMethod, smtpAccountId }`；`memberService.assertMember` 校验后更新该成员行。
2. `GET /account/:accountId/send-choice/resolve` — 返回 `{ sendMethod, smtpAccountId }`；空串表示从未发送过。

service：`src/service/member-service.js` 新增：

- `setLastSendChoice(c, accountId, userId, sendMethod, smtpAccountId)` — update 两列。
- `resolveSendChoice(c, accountId, userId)` — select 两列并返回。

## 前端写信页（`write/index.vue`）

**保存**：`sendEmail()` 成功回调内、`resetForm()` 之前调用：

```js
setSendChoice(form.accountId, form.sendMethod, form.sendMethod === 'smtp' ? form.smtpAccountId : 0).catch(() => {})
```

静默失败，记忆失败不影响发送结果。

**恢复**：`open()` 尾部（签名/SMTP 账户加载同一区块）并行调 resolve 接口，规则：

```
记忆的方式 ∈ 可用方式集合？
  → form.sendMethod = 记忆值
    若记忆值为 smtp 且记忆的 SMTP 账户仍在列表中 → 选中该账户
  → 不动，维持现有默认链（cloudflare → resend → smtp）
```

可用方式集合复用现成的 `sendEmailAvailable` / `resendEnabled` / `cfSmtpAvailable` computed，resend 被管理员关闭、域名不再支持 cfsmtp 等情形自动回退。

**改动收拢**：`resetForm()` / `openReply()` / `openForward()` 内部的"强制重置 sendMethod"保留不动（它们把表单拉回默认值）；恢复逻辑统一放在 `open()` 尾部覆盖。`openForward` / `openReply` 内部已调用 `open()`，时序天然成立，三条打开路径（新写/回复/转发）行为一致，改动面最小。

## 错误处理

- resolve 接口失败：console.warn 后走默认链（与签名加载容错一致）。
- 保存接口失败：静默。
- 记忆的 SMTP 账户已删除：不在 `smtpAccounts` 列表中则回落现有默认（default 优先，否则首项），无需额外代码。

## 测试

- 后端：`mail-worker/test/unit/` 为 `setLastSendChoice` / `resolveSendChoice` 补单测。
- 前端手动验证：三条打开路径（新写/回复/转发）× 四种发送方式 × resend 关闭回退 × SMTP 账户恢复与已删账户回落。

## 规模

worker 侧约 40 行、前端约 30 行、迁移 1 个函数。
