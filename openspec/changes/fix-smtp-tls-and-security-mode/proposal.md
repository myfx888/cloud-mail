## 为什么

当前 SMTP 发送与验证链路在 TLS 模式解析上存在缺陷，导致 `TLS Handshake Failed`、`Socket timeout` 等高频失败，影响外发可用性。结合线上日志可确认存在加密模式错配与证书/SNI 协商失败叠加问题，需要立即修复并统一行为。

## 变更内容

- 修复 SMTP `secure` 字段默认赋值逻辑，避免将用户配置 `0` 错误覆盖为 `1`
- 统一 SMTP 安全模式解析（`smtpSecure` → `secure/startTls`），明确三态语义并在发送/验证流程复用
- 修复 SMTP 附件字段映射，按 `worker-mailer` 接口输出 `mimeType`
- 改进 SMTP 验证连接生命周期，确保连接在验证后正确关闭
- 补充错误诊断日志，便于区分模式错配与证书链路问题

## 功能 (Capabilities)

### 新增功能
- `smtp-security-mode-resolution`: 统一 SMTP 安全模式解析与连接参数组装能力

### 修改功能
- `smtp-delivery`: 修正 SMTP 发信链路中的安全模式与附件参数行为
- `smtp-verification`: 修正 SMTP 连通性验证链路中的安全模式和连接关闭行为

## 影响

- 受影响代码：`mail-worker/src/service/smtp-service.js`、`mail-worker/src/service/smtp-account-service.js`
- 受影响 API：`POST /api/smtp/verify`、`POST /api/smtp/accounts/verify`（行为更稳定，返回失败信息更可诊断）
- 依赖影响：无新增依赖，继续使用现有 `worker-mailer@^1.2.1`
- 运维影响：需要按既有规范确保 SMTP 域名证书有效且 SNI 配置正确
