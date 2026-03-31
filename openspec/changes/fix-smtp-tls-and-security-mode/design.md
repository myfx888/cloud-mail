## 上下文

当前 SMTP 发信链路位于 `mail-worker/src/service/smtp-service.js`，配置写入路径位于 `mail-worker/src/service/smtp-account-service.js`。线上日志显示两类故障：
1. TLS 模式错配（客户端直接发送 TLS ClientHello，而服务端期望明文 SMTP + STARTTLS）
2. 证书/SNI 问题（证书过期或域名未命中证书链）

代码层面主要缺陷是 `secure` 默认值处理吞掉了 `0`，以及安全模式解析在发送与验证流程不一致。

## 目标 / 非目标

**目标：**
- 统一 `smtpSecure` 到 `secure/startTls` 的解析规则，并在发送与验证路径复用
- 修复 `secure` 默认赋值错误，保留 `0` 配置
- 修复附件字段与 `worker-mailer` API 的对齐问题
- 保证验证流程连接可关闭，避免连接泄漏

**非目标：**
- 不修复服务器侧证书过期和 SNI 配置（属于运维层）
- 不引入新的 SMTP 客户端依赖
- 不重构全部 SMTP API，只做最小必要改动

## 决策

### 决策 1：定义安全模式三态映射并集中解析
- 选择：新增统一解析函数，输入 `smtpSecure` 和 `port`，输出 `secure/startTls`
- 映射：
  - `1` -> `secure=true, startTls=false`（隐式 TLS）
  - `2` -> `secure=false, startTls=true`（显式 STARTTLS）
  - `0` -> `secure=false, startTls=false`（明文）
- 备选方案：在各处内联判断。未选中原因：容易再出现分叉行为

### 决策 2：保留零值，替换错误默认写法
- 选择：将 `secure: x || 1` 改为 `secure: x ?? 1`
- 备选方案：继续使用 `||` 并在外部预处理。未选中原因：隐蔽且易回归

### 决策 3：附件字段改为 `mimeType`
- 选择：`formatAttachments` 输出 `mimeType`
- 备选方案：继续输出 `contentType`。未选中原因：与 `worker-mailer` 文档不一致

### 决策 4：验证流程显式关闭连接
- 选择：`verify()` 使用 `try/finally` 关闭连接
- 备选方案：依赖运行时自动回收。未选中原因：连接泄漏风险不可控

## 风险 / 权衡

- 风险：部分历史配置将 `smtpSecure=0` 用作“自动 STARTTLS”语义
  - 缓解：通过端口与模式在 UI/文档中明确语义，避免隐式推断
- 风险：服务器证书过期仍会导致握手失败
  - 缓解：在错误信息中保留底层 TLS 错误，指导运维修复证书和 SNI
- 风险：附件字段变更可能影响旧调用方
  - 缓解：仅内部服务使用该字段，变更范围可控

## 迁移计划

1. 修改 `smtp-account-service.js`，修复 `secure` 默认赋值
2. 修改 `smtp-service.js`，引入统一安全模式解析并复用到 `send/verify`
3. 修改附件格式化字段映射并补充验证流程连接关闭
4. 手工验证：
   - 587 + STARTTLS
   - 465 + TLS
   - 附件发送
   - `/smtp/verify` 行为
5. 回滚策略：仅回滚上述两个服务文件变更

## 待定问题

- `smtpSecure=0` 在现网是否被部分用户当作“自动协商 STARTTLS”使用，是否需要兼容开关。
