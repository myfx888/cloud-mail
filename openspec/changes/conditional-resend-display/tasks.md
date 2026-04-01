## 1. 后端配置透传

- [x] 1.1 修改 `settingService.websiteConfig`，将 `resendEnabled` 包含在返回的配置对象中
- [x] 1.2 修改 `emailService.send`，在发信逻辑开始处增加对全局 `resendEnabled` 开关的强制校验

## 2. 前端状态同步

- [x] 2.1 修改 `mail-vue/src/init/init.js`，确保初始化时从后端配置中解析并保存 `resendEnabled`
- [x] 2.2 更新 `settingStore` 定义，确保 `settings` 响应式对象包含 `resendEnabled` 初始值

## 3. UI 联动实现

- [x] 3.1 修改 `mail-vue/src/layout/write/index.vue`，使用 `v-if` 根据 `resendEnabled` 动态隐藏发信方式切换单选组
- [x] 3.2 优化写信页初始化逻辑，若 `resendEnabled` 为关闭状态，则强制设置 `form.sendMethod = 'smtp'`
- [x] 3.3 修改 `mail-vue/src/views/sys-setting/index.vue`，根据开关状态隐藏 Resend Token 列表及新增按钮入口

## 4. 验证与回归

- [ ] 4.1 验证关闭 Resend 后，普通用户写信界面仅展示 SMTP 且无法切换
- [ ] 4.2 验证关闭 Resend 后，管理员设置页面隐藏 Resend 维护入口
- [x] 4.3 运行前端构建，确保逻辑变更不影响既有打包流程
