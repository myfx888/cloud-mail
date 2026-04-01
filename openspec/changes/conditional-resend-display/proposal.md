## 为什么

当前系统虽然在后端有 `resendEnabled` 开关，但前端页面（特别是写信页和系统设置页）并未联动此开关。当 Resend 服务未启用时，普通用户仍能看到 Resend 发信选项，管理员仍能看到 Token 配置项，这会导致用户困惑及无效操作。我们需要实现 UI 与后端开关的严格联动，确保功能不可用时入口完全隐藏。

## 变更内容

- **后端扩展**: 修改 `settingService.websiteConfig` 接口，透传 `resendEnabled` 状态到前端。
- **前端状态同步**: 确保全局初始化流程将 `resendEnabled` 存入 `settingStore`。
- **UI 联动隐藏**:
  - 写信页 (`write/index.vue`)：当 `resendEnabled` 关闭时，隐藏 "Resend" 选项，默认强制使用 "SMTP"。
  - 系统设置页 (`sys-setting/index.vue`)：当 `resendEnabled` 关闭时，隐藏 Resend Token 相关配置入口。
- **后端逻辑加固**: 发信接口增加 `resendEnabled` 校验，防止绕过 UI 发送。

## 功能 (Capabilities)

### 新增功能
- `conditional-resend-display`: 实现全站 Resend 相关 UI 根据后端开关状态动态显示/隐藏的功能。

### 修改功能
- 无

## 影响

- **API**: `websiteConfig` 接口返回值增加字段。
- **前端**: `settingStore` 增加状态位，写信页和设置页 UI 逻辑变更。
- **后端**: 发信服务逻辑增加开关校验。
