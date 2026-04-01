## 1. 后端权限定义与国际化

- [x] 1.1 在 `mail-worker/src/init/init.js` 中新增 `v3_9DB` 迁移，更新 `account:query` 的权限类型为菜单 (0)
- [x] 1.2 在 `mail-worker/src/i18n/zh.js` 的 `perms` 命名空间下补齐“邮件账户”、“账户查看”、“账户添加”、“账户删除”的翻译
- [x] 1.3 在 `mail-worker/src/i18n/en.js` 的 `perms` 命名空间下补齐对应的英文翻译

## 2. 前端路由与权限映射

- [x] 2.1 修改 `mail-vue/src/perm/perm.js`，在 `routers` 对象中添加 `account:query` 对应的路由配置
- [x] 2.2 修改 `mail-vue/src/router/index.js`，将 `/account` 从静态路由列表（`routes`）中移除
- [x] 2.3 验证 `init.js` 初始化流程能正确加载动态生成的 `/account` 路由

## 3. UI 按钮级权限联动

- [x] 3.1 在 `mail-vue/src/views/account/index.vue` 的“添加账户”按钮上应用 `v-perm="'account:add'"`
- [x] 3.2 在 `mail-vue/src/views/account/index.vue` 的“删除”操作列应用 `v-perm="'account:delete'"`

## 4. 验证与回归测试

- [ ] 4.1 使用普通用户账号登录，验证侧边栏是否根据权限动态显示“邮件账户”菜单
- [ ] 4.2 验证管理员角色在角色管理页面能看到完整的“邮件账户”权限树且翻译正确
- [ ] 4.3 模拟无权限用户手动输入 `/account` 路径，验证系统的重定向或报错处理
