## 新增需求

### 需求:Resend 开关状态同步
系统必须将后端的 `resendEnabled` 设置状态透传至前端，确保前端能实时感知 Resend 服务是否启用。

#### 场景:后端配置成功透传
- **当** 前端调用 `websiteConfig` 接口进行初始化时
- **那么** 返回的 JSON 对象中必须包含 `resendEnabled` 字段，且其值反映数据库中 `setting.resend_enabled` 的实际数值

### 需求:写信页发信方式动态隐藏
当 Resend 服务未启用时，写信页禁止展示 Resend 发信选项，并默认且唯一可选 SMTP。

#### 场景:Resend 已禁用时打开写信弹窗
- **当** `settingStore.settings.resendEnabled` 为 0 时用户点击“写信”
- **那么** 写信弹窗内的发信方式单选组（Resend/SMTP）必须隐藏，且 `form.sendMethod` 必须被初始化为 'smtp'

#### 场景:Resend 已启用时打开写信弹窗
- **当** `settingStore.settings.resendEnabled` 为 1 时用户点击“写信”
- **那么** 写信弹窗内的发信方式单选组必须可见，用户可自由切换

### 需求:设置页 Resend 配置入口联动
当 Resend 服务未启用时，系统设置页必须隐藏所有与 Resend Token 相关的维护入口。

#### 场景:Resend 已禁用时查看系统设置
- **当** `settingStore.settings.resendEnabled` 为 0 时访问系统设置页
- **那么** “Resend Token” 列表按钮及新增按钮必须隐藏

### 需求:后端发信兜底校验
后端在执行发信操作时，必须根据全局开关进行二次验证，禁止在关闭状态下使用 Resend 引擎。

#### 场景:非法绕过 UI 调用 Resend 发信
- **当** 全局 `resendEnabled` 为 0，但接口请求中 `sendMethod` 设为 'resend' 时
- **那么** `emailService.send` 必须抛出异常或自动降级为 SMTP（若配置了有效账户）
