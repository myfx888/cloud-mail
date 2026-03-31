# Mailcow / SMTP 多服务器使用说明

## 1. 系统设置入口

进入 `系统设置 -> Mailcow`，点击配置按钮打开 Mailcow 配置弹窗。

## 2. Mailcow 配置项说明

- `密码模式`
  - `固定密码`: 使用统一密码为新邮箱开通 Mailcow 账户
  - `随机密码`: 为每个邮箱随机生成密码
- `统一密码`
  - 仅固定密码模式显示
  - 留空表示不更新已有配置
- `失败阻断`
  - 关闭（宽松）: Mailcow 失败不阻断本地账户创建
  - 开启（严格）: Mailcow 失败时整个账户创建失败
- `重试次数 / 请求超时`
  - 用于 Mailcow API 调用的重试策略

## 3. 多服务器配置

### 3.1 Mailcow 服务器列表

在 `Mailcow 服务器列表 JSON` 中维护多个服务器，建议字段：

- `id`
- `name`
- `apiUrl`
- `apiKey`
- `smtpHost`
- `smtpPort`
- `smtpSecure`
- `smtpAuthType`
- `isDefault`

说明：
- 建议仅保留一个 `isDefault=true`
- 添加后可点击“测试连接”验证可用性

### 3.2 SMTP 服务器列表

在 `SMTP 服务器列表 JSON` 中维护多个发送服务器，建议字段：

- `id`
- `name`
- `smtpHost`
- `smtpPort`
- `smtpUser`
- `smtpSecure`
- `smtpAuthType`
- `isDefault`

说明：
- 新邮箱默认绑定默认 SMTP 服务器
- 可在账户侧切换到其他 SMTP 服务器

## 4. 账户列表操作

- `SMTP 设置` 按钮为统一入口
  - 包含 SMTP 覆盖配置和 SMTP 账户管理能力
- `重试` 按钮
  - 当 Mailcow 开通失败时可手动重试
  - 重试成功后会自动回填 SMTP 配置

## 5. 回复窗口 SMTP 选择

在邮件回复编辑窗口右下角：

- 多个可用 SMTP 账户时显示下拉框
- 可切换当前回复会话的 SMTP 发送账户
- 切换仅作用于当前会话，不改变账户长期默认绑定

## 6. 安全建议

- `API Key` 与统一密码属于敏感数据，仅管理员可配置
- 查询接口返回值已做脱敏，不会返回明文密钥
- 建议定期轮换统一密码与 Mailcow API Key
