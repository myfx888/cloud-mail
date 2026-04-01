## 1. 后端 API 与服务层

- [x] 1.1 在 `account-service.js` 中新增 `adminListAccounts(c, params)` 方法：跨用户分页查询 account 表，JOIN user 表获取 `userEmail`，子查询 smtp_account 表获取 `smtpAccountCount`，支持按 email 模糊搜索和按 smtpStatus 过滤
- [x] 1.2 新建 `src/api/admin-api.js`，实现 `GET /admin/accounts` 端点，调用 `adminListAccounts`，校验管理员身份
- [x] 1.3 在 `security.js` 的 `requirePerms` 数组中添加 `/admin/accounts`，在 `premKey` 的 `user:query` 中添加 `/admin/accounts`

## 2. 前端请求层

- [x] 2.1 在 `src/request/admin.js`（新建）中添加 `adminAccountList(params)` 函数，调用 `GET /admin/accounts`

## 3. 前端页面

- [x] 3.1 在 `account/index.vue` 中新增「所有用户邮箱」卡片区域（仅管理员可见），包含搜索框、SMTP 状态下拉过滤、分页表格
- [x] 3.2 表格列实现：邮箱、所属用户、SMTP 状态（标签展示：已配置 Mailcow / 已配置 手动 / 未配置）、操作下拉
- [x] 3.3 操作下拉实现：SMTP 设置（复用 smtp-account-manager 组件）、一键开通（调用 `/smtp/provision-mailcow`，仅 mailcowEnabled 时显示）、删除（调用 `/user/deleteAccount`，带确认弹窗）
- [x] 3.4 搜索与过滤逻辑：输入搜索关键词或切换 SMTP 状态过滤后，重置分页到第一页并重新请求数据
- [x] 3.5 加载 Mailcow 配置状态（复用 `settingQuery` 获取 `mailcowEnabled` 和 `mailcowServers`），控制一键开通按钮可见性

## 4. 验证

- [x] 4.1 验证管理员登录后邮件账户页面下方显示全局邮箱列表，普通用户不可见
- [x] 4.2 验证搜索、过滤、分页功能正常工作
- [x] 4.3 验证 SMTP 设置弹窗、一键开通、删除操作均正常执行并刷新列表
