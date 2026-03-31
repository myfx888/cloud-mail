## 为什么

当前 Mailcow 集成仅支持随机密码创建邮箱账户，无法满足统一密码管理的运维需求。管理员需要手动配置每个 Mailcow 服务器的 API 参数，缺少全局 SMTP 模板和灵活的失败处理策略。这导致批量开通邮箱时效率低下，且无法与现有用户体系平滑对接。

## 变更内容

- 新增 **统一密码模式**：支持后台配置固定密码，用于自动创建 Mailcow 账户
- 新增 **密码双模式切换**：`fixed`（统一密码）/ `random`（随机密码）可配置
- 新增 **创建失败策略开关**：`mailcowCreateStrict` 控制失败是否阻断本地账户创建
- 新增 **失败重试能力**：配置失败项支持一键重试，重试后更新状态与错误信息
- 新增 **SMTP 多服务器配置**：支持维护多个 SMTP 服务器并在账户侧选择/切换
- 新增 **全局 SMTP 模板**：`mailcowGlobalSmtpTemplate` 作为服务器配置的 fallback
- 增强 **Mailcow 多服务器配置**：支持维护多个 Mailcow 服务器并配置默认服务器
- 新增 **重复账户处理规则**：Mailcow 已存在同名邮箱时视为成功并继续回填 SMTP
- 新增 **敏感字段脱敏**：API Key、统一密码在查询接口中脱敏返回
- 修改 **SMTP 回填逻辑**：优先使用服务器配置，缺省字段回退全局模板
- 修改 **账户界面操作区**：合并重复 SMTP 功能按钮，统一单一入口

## 功能 (Capabilities)

### 新增功能

- `mailcow-password-provisioning`: 统一密码开通模式，支持固定密码和随机密码双模式
- `mailcow-failure-policy`: 创建失败策略，支持宽松模式和严格模式切换
- `mailcow-retry-operation`: 失败项重试能力，支持手动触发重试并更新状态
- `mailcow-smtp-template`: 全局 SMTP 配置模板，作为服务器配置的 fallback
- `mailcow-duplicate-handling`: 重复账户处理，已存在邮箱视为成功并继续流程
- `smtp-multi-server-management`: SMTP 多服务器配置与账户绑定能力
- `account-ui-action-unification`: 账户界面 SMTP 重复按钮合并与统一交互

### 修改功能

- `mailcow-integration`: 扩展现有 Mailcow 集成，支持新的配置项和处理策略

## 影响

### 代码影响

- `mail-worker/src/service/setting-service.js`: 新增配置字段读写逻辑
- `mail-worker/src/entity/setting.js`: 新增数据库字段定义
- `mail-worker/src/service/mailcow-service.js`: 扩展账户创建逻辑，支持双密码模式和重复账户检测
- `mail-worker/src/service/account-service.js`: 修改 SMTP 回填逻辑，集成失败策略
- `mail-worker/src/controller/account-controller.js`: 新增失败项重试接口（按账号触发）
- `mail-worker/src/service/smtp-service.js`: 新增/扩展 SMTP 服务器池管理与账户绑定逻辑
- `mail-worker/src/init/init.js`: 新增数据库迁移脚本
- `mail-vue/src/views/sys-setting/index.vue`: 新增配置 UI（密码模式、统一密码、失败策略、全局 SMTP 模板）
- `mail-vue/src/views/account/index.vue`: 为失败项新增“重试”按钮与状态反馈
- `mail-vue/src/views/account/components/*`: 合并重复 SMTP 操作按钮为统一入口

### API 影响

- `POST /api/setting`: 新增字段 `mailcowPasswordMode`, `mailcowProvisionPassword`, `mailcowCreateStrict`, `mailcowGlobalSmtpTemplate`
- `GET /api/setting`: 敏感字段（`mailcowProvisionPassword`, API Key）脱敏返回
- `POST /api/account/:accountId/mailcow/retry`: 手动重试 Mailcow 配置失败项
- `POST /api/smtp/servers`: 新增/更新 SMTP 服务器列表配置
- `POST /api/account/:accountId/smtp/server`: 账户绑定或切换 SMTP 服务器

### 数据库影响

- `setting` 表新增字段：
  - `mailcow_password_mode` (TEXT: 'fixed' | 'random')
  - `mailcow_provision_password` (TEXT, 敏感)
  - `mailcow_create_strict` (INTEGER: 0 | 1)
  - `mailcow_global_smtp_template` (TEXT, JSON)
  - `smtp_servers` (TEXT, JSON，多 SMTP 服务器配置)
- `account` 表新增字段：
  - `smtp_server_id` (TEXT, 账户绑定的 SMTP 服务器)
  - `mailcow_server_id` (TEXT, 账户绑定的 Mailcow 服务器)

### 依赖影响

- 无外部依赖变更
- 需确保 Mailcow API 版本兼容性（已验证）
