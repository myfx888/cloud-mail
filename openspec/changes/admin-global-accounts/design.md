## 上下文

管理员当前通过 `account/index.vue` 管理自己的邮箱账户，通过 `user/index.vue` 逐用户查看邮箱。系统已有完整的 SMTP 多账户管理组件 (`smtp-account-manager`)、Mailcow 一键开通 API (`/smtp/provision-mailcow`)、管理员删除用户邮箱 API (`/user/deleteAccount`)。后端权限系统基于路径前缀匹配 + 权限 key 映射。

现有数据模型：
- `account` 表：含 `userId`, `email`, `smtpOverride`, `mailcowServerId` 等字段
- `smtp_account` 表：含 `accountId`, `host`, `port`, `user`, `isDefault` 等字段
- `user` 表：含 `userId`, `email`, `type`, `isDel` 等字段

## 目标 / 非目标

**目标：**
- 管理员在邮件账户页面一览所有用户邮箱及其 SMTP 配置状态
- 支持按邮箱地址搜索、按 SMTP 状态过滤
- 对任意用户邮箱可直接进行 SMTP 设置、一键开通、删除操作
- 复用现有组件和 API，最小化新代码量

**非目标：**
- 批量一键开通（本次仅支持单个邮箱）
- 修改现有用户管理页面 (`user/index.vue`) 的邮箱弹窗
- 新增邮箱账户的创建入口（创建仍通过现有流程）
- SMTP 配置的内联编辑（仍通过弹窗组件操作）

## 决策

### 1. 新建后端 API 而非复用现有 API

**选择**：新建 `GET /admin/accounts` 端点

**替代方案**：
- 复用 `/user/allAccount`：该 API 按单个 `userId` 查询，无法跨用户汇总，且不含 SMTP 状态信息
- 复用 `/account/list`：硬绑定当前用户 `userId`，无法查其他用户

**理由**：需要跨用户分页查询 + join `smtp_account` 表获取配置状态，现有 API 均不满足。

### 2. SMTP 状态通过子查询 COUNT 获取

**选择**：SQL 子查询 `(SELECT COUNT(*) FROM smtp_account WHERE account_id = a.account_id)` 作为 `smtpAccountCount`

**替代方案**：
- 前端逐条请求 SMTP 列表：N+1 问题，不可接受
- 在 account 表新增冗余字段：增加维护成本

**理由**：子查询在 SQLite 中性能足够，且无需修改数据模型。

### 3. 权限复用 `user:query`

**选择**：将 `/admin/accounts` 路由映射到已有的 `user:query` 权限 key

**替代方案**：新增 `admin:accounts` 权限 key

**理由**：查看全局邮箱列表本质上是用户管理的延伸，复用 `user:query` 避免增加权限配置复杂度。拥有用户查询权限的角色自然应能查看用户邮箱。

### 4. 前端复用 smtp-account-manager 组件

**选择**：直接在全局邮箱表格的操作中调用已有的 `smtp-account-manager` 组件

**理由**：该组件已支持通过 `accountId` prop 管理任意邮箱的 SMTP 配置，后端 SMTP API 已有 `isAdmin` 放行逻辑。零改动即可复用。

### 5. API 文件放置

**选择**：新建 `admin-api.js` 而非添加到 `account-api.js`

**理由**：语义上这是管理员专属功能，与普通用户的 account 操作分离，便于维护和权限审计。

## 风险 / 权衡

- **性能**：当邮箱数量很大时（万级），子查询 COUNT 可能变慢 → 缓解：分页限制 max 30 条/页，SQLite 对小表 COUNT 性能足够
- **权限粒度**：复用 `user:query` 意味着有用户查询权限就能看全局邮箱 → 可接受，因为 `user:query` 本身已是管理级权限
- **删除操作**：复用 `/user/deleteAccount` 会执行软删除 + 邮件归属重置 → 与现有用户管理页面行为一致，无额外风险
