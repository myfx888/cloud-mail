## 为什么

管理员当前只能在 `account/index.vue` 中查看和管理自己的邮件账户。要查看其他用户的邮箱，必须进入用户管理页面 (`user/index.vue`)，逐个用户点击「用户邮箱」弹窗查看，且弹窗中缺少 SMTP 状态展示和一键开通入口。当系统用户量增长后，管理员无法高效地总览全局邮箱配置状况、快速定位未配置 SMTP 的账户并统一处理。

## 变更内容

- **新增**：在管理员邮件账户页面 (`account/index.vue`) 下方，新增「所有用户邮箱」区域，以分页表格展示系统中所有用户的所有邮箱账户
- **新增**：表格中直接展示每个邮箱的 SMTP 配置状态（已配置/未配置，来源为 Mailcow 或手动）
- **新增**：每行操作下拉菜单包含：SMTP 设置、一键开通（Mailcow）、删除
- **新增**：支持按邮箱地址搜索、按 SMTP 配置状态过滤
- **新增**：后端管理员专用 API，跨用户分页查询邮箱列表并关联 SMTP 配置状态
- 该区域仅管理员可见，普通用户不受影响

## 功能 (Capabilities)

### 新增功能
- `admin-account-list`: 管理员全局邮箱列表功能，包括后端跨用户分页查询 API、前端表格展示、搜索过滤、SMTP 状态展示、以及对用户邮箱的 SMTP 配置/一键开通/删除操作

### 修改功能

## 影响

- **后端 API**：新增 `GET /admin/accounts` 端点（`admin-api.js`），`account-service.js` 新增 `adminListAccounts()` 方法
- **权限系统**：`security.js` 的 `requirePerms` 和 `premKey` 新增路由保护，复用 `user:query` 权限
- **前端页面**：`account/index.vue` 新增全局邮箱卡片区域
- **前端请求**：新增 `adminAccountList()` 请求函数
- **现有功能不受影响**：复用已有 `smtp-account-manager` 组件、`/smtp/provision-mailcow` API、`/user/deleteAccount` API
