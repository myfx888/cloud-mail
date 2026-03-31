## 新增需求

### 需求:管理员可配置全局 SMTP 模板

系统必须允许管理员在系统设置中配置全局 SMTP 模板，作为 Mailcow 服务器配置的 fallback。

#### 场景:配置全局 SMTP 模板
- **当** 管理员填写全局 SMTP 模板（主机、端口、加密方式、认证类型）并保存
- **那么** 系统将模板存储到 `mailcowGlobalSmtpTemplate` 字段（JSON 格式）

#### 场景:查询全局 SMTP 模板
- **当** 管理员查询系统设置
- **那么** 系统返回 `mailcowGlobalSmtpTemplate` 的完整内容

### 需求:SMTP 配置优先级

系统必须按优先级确定 SMTP 配置来源：服务器配置优先，全局模板 fallback，硬编码默认值兜底。

#### 场景:服务器配置完整
- **当** Mailcow 服务器配置包含完整的 `smtpHost`, `smtpPort`, `smtpSecure`, `smtpAuthType`
- **那么** 系统使用服务器配置填充账户 SMTP 设置

#### 场景:服务器配置部分缺失
- **当** Mailcow 服务器配置缺少部分字段（如 `smtpPort`）
- **那么** 系统从 `mailcowGlobalSmtpTemplate` 中获取缺失字段

#### 场景:服务器和全局模板均缺失
- **当** 服务器配置和全局模板均缺少某字段
- **那么** 系统使用硬编码默认值（`smtpHost: smtp.mailcow.email`, `smtpPort: 587`, `smtpSecure: 0`, `smtpAuthType: plain`）

### 需求:全局 SMTP 模板字段定义

系统必须支持以下全局 SMTP 模板字段：
- `smtpHost`: SMTP 服务器主机名
- `smtpPort`: SMTP 服务器端口
- `smtpSecure`: 加密方式（`0`: 无加密, `1`: STARTTLS, `2`: SSL/TLS）
- `smtpAuthType`: 认证类型（`plain`, `login`, `cram-md5`）

#### 场景:模板字段验证
- **当** 管理员保存全局 SMTP 模板
- **那么** 系统验证字段格式，无效字段返回错误提示

## 修改需求

（无）

## 移除需求

（无）
