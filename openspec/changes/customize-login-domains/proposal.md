## 为什么

目前，所有在 `domain` 环境变量中定义的域名都会在登录页面的下拉列表中显示。管理员可能出于隐私、品牌或安全考虑，希望限制哪些域名对终端用户可见。

## 变更内容

- 在 `setting` 表中新增 `login_domains` 字段，用于存储允许在前端显示的域名列表。
- 修改后端 `settingService`，在返回 `websiteConfig` 时，根据 `login_domains` 配置对 `domainList` 进行过滤。
- 在管理后台的“系统设置”页面增加域名选择 UI，允许管理员勾选要显示的后缀。
- 确保过滤后的域名列表在登录页和系统内添加邮箱页面同步生效。

## 功能 (Capabilities)

### 新增功能
- `login-domain-customization`: 允许管理员自定义前端显示的邮箱域名后缀列表。

### 修改功能
<!-- 现有功能，其需求发生变更（不仅仅是实现）。
     仅当规范级行为发生变更时才在此列出。每个都需要一个增量规范文件。
     使用项目目录中 specs/ 的现有规范名称。如果没有需求变更，请留空。 -->

## 影响

- **数据库**: `setting` 表新增 `login_domains` 字段。
- **API**: `settingService` 的 `query` 和 `update` 接口，以及公开的 `websiteConfig` 接口。
- **前端**: `sys-setting/index.vue`（设置页）、`login/index.vue`（登录页）、`store/setting.js`（设置存储）。
