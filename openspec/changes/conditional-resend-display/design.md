## 上下文

系统目前支持通过 Resend 和 SMTP 两种方式发信。虽然数据库 `setting` 表中有 `resend_enabled` 字段，且后台设置页可以切换该开关，但该状态并未完全透传至前端全局配置，导致前端 UI（如写信页的发信方式选择、系统设置页的 Token 管理）在 Resend 关闭时依然可见。

## 目标 / 非目标

**目标：**
- 实现 `resendEnabled` 状态从后端到前端的完整链路透传。
- 根据 `resendEnabled` 状态动态控制前端 Resend 相关 UI 的显示/隐藏。
- 确保 Resend 关闭时，写信页默认选择并只显示 SMTP 选项。
- 后端发信逻辑增加安全校验，防止绕过前端 UI 使用 Resend 发信。

**非目标：**
- 不涉及 SMTP 发信功能的修改。
- 不涉及 Resend Token 的有效性校验逻辑。

## 决策

1. **后端配置透传：** 修改 `settingService.websiteConfig` 接口，将 `resendEnabled` 包含在返回的配置对象中。
   - **理由：** `websiteConfig` 是前端初始化的公共接口，适合存放影响全局 UI 展示的开关。

2. **前端状态存储：** 在全局初始化流程（`init.js`）中，将 `resendEnabled` 同步至 `settingStore.settings`。
   - **理由：** 保持与现有配置存储模式一致，方便各组件通过 `settingStore` 访问。

3. **写信页联动：**
   - 使用 `v-if="settingStore.settings.resendEnabled === 1"` 控制发信方式单选框的显示。
   - 若 `resendEnabled` 为 0，在打开写信弹窗时强制设置 `form.sendMethod = 'smtp'`。
   - 调整 `showSmtpSelector` 计算属性，确保在 Resend 关闭且有 SMTP 账户时始终显示 SMTP 选择器。

4. **发信接口加固：** 在 `emailService.send` 中，即使 `sendMethod` 为 `resend`，也要检查全局 `resendEnabled` 开关。
   - **理由：** 深度防御，确保后端逻辑与配置一致。

## 风险 / 权衡

- **[风险] 前端缓存延迟** → **缓解措施：** 后端更新设置后会调用 `refresh` 更新 KV 缓存，前端 `init` 会重新拉取最新 `websiteConfig`。
- **[风险] 既有回复/转发逻辑影响** → **缓解措施：** 特别注意 `openReply` 和 `openForward` 中对 `sendMethod` 的初始赋值，需适配开关状态。
