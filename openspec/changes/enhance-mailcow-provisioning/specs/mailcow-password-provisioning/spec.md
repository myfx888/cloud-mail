## 新增需求

### 需求:管理员可配置密码模式

系统必须允许管理员在系统设置中配置 Mailcow 账户创建的密码模式，支持 `fixed`（统一密码）和 `random`（随机密码）两种模式。

#### 场景:配置固定密码模式
- **当** 管理员在系统设置中选择 `fixed` 密码模式
- **那么** 系统显示统一密码输入框，并保存 `mailcowPasswordMode` 为 `fixed`

#### 场景:配置随机密码模式
- **当** 管理员在系统设置中选择 `random` 密码模式
- **那么** 系统隐藏统一密码输入框，并保存 `mailcowPasswordMode` 为 `random`

### 需求:管理员可设置统一密码

系统必须允许管理员在 `fixed` 模式下配置统一密码，用于所有 Mailcow 账户创建。

#### 场景:设置统一密码
- **当** 管理员输入统一密码并保存
- **那么** 系统将密码存储到 `mailcowProvisionPassword` 字段，并在查询时脱敏显示

#### 场景:查询时脱敏显示
- **当** 管理员查询系统设置
- **那么** `mailcowProvisionPassword` 字段返回 `******`，不显示明文

### 需求:使用统一密码创建账户

系统必须在 `fixed` 模式下创建 Mailcow 账户时使用统一密码，而非随机生成。

#### 场景:固定模式创建账户
- **当** 用户添加新邮箱且 `mailcowPasswordMode` 为 `fixed`
- **那么** 系统调用 Mailcow API 时使用 `mailcowProvisionPassword` 作为密码

#### 场景:随机模式创建账户
- **当** 用户添加新邮箱且 `mailcowPasswordMode` 为 `random`
- **那么** 系统调用 Mailcow API 时使用随机生成的密码

### 需求:统一密码字段安全存储

系统必须将 `mailcowProvisionPassword` 视为敏感字段，禁止在日志、错误信息中输出明文。

#### 场景:日志不输出密码
- **当** 系统记录 Mailcow 创建日志
- **那么** 日志中不包含 `mailcowProvisionPassword` 的明文值

## 修改需求

（无）

## 移除需求

（无）
