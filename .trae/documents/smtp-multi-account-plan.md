# Cloud Mail - SMTP多账户配置功能实现计划

## [ ] 任务1: 在系统设置中添加SMTP用户配置权限开关
- **优先级**: P0
- **依赖项**: None
- **描述**:
  - 在系统设置实体中添加新字段 `smtpUserConfig`，控制用户是否可以修改SMTP配置
  - 更新系统设置相关的API和前端组件
- **成功标准**:
  - 系统设置中新增SMTP用户配置权限开关
  - 开关默认值为1（允许用户配置）
  - 管理员可以通过后台修改此设置
- **测试要求**:
  - `programmatic` TR-1.1: 系统设置API返回新增的smtpUserConfig字段
  - `programmatic` TR-1.2: 管理员可以成功修改smtpUserConfig设置
  - `human-judgment` TR-1.3: 系统设置界面显示SMTP用户配置权限开关
- **备注**: 需修改setting.js实体文件和相关API

## [ ] 任务2: 后端API权限控制
- **优先级**: P0
- **依赖项**: 任务1
- **描述**:
  - 在SMTP相关API中添加权限检查
  - 当smtpUserConfig为0时，阻止用户修改SMTP配置
  - 管理员不受此限制
- **成功标准**:
  - 当smtpUserConfig为0时，普通用户无法修改SMTP配置
  - 当smtpUserConfig为0时，管理员仍可以修改用户SMTP配置
  - 当smtpUserConfig为1时，用户可以正常修改SMTP配置
- **测试要求**:
  - `programmatic` TR-2.1: 普通用户在smtpUserConfig为0时无法修改SMTP配置
  - `programmatic` TR-2.2: 管理员在smtpUserConfig为0时可以修改用户SMTP配置
  - `programmatic` TR-2.3: 普通用户在smtpUserConfig为1时可以修改SMTP配置
- **备注**: 需修改smtp-api.js文件，添加权限检查逻辑

## [ ] 任务3: 前端SMTP配置权限控制
- **优先级**: P1
- **依赖项**: 任务1, 任务2
- **描述**:
  - 在前端账户设置页面添加权限检查
  - 当用户无权限时，禁用SMTP配置相关控件
  - 显示相应的提示信息
- **成功标准**:
  - 当smtpUserConfig为0时，用户界面的SMTP配置控件被禁用
  - 当smtpUserConfig为0时，用户界面显示权限提示
  - 当smtpUserConfig为1时，用户界面的SMTP配置控件正常可用
- **测试要求**:
  - `human-judgment` TR-3.1: 无权限时SMTP配置控件显示为禁用状态
  - `human-judgment` TR-3.2: 无权限时显示清晰的权限提示信息
  - `human-judgment` TR-3.3: 有权限时SMTP配置控件正常可用
- **备注**: 需修改account/index.vue文件

## [ ] 任务4: 管理员用户管理页面添加SMTP配置功能
- **优先级**: P1
- **依赖项**: 任务1, 任务2
- **描述**:
  - 在管理员用户管理页面添加SMTP配置功能
  - 允许管理员为指定用户配置SMTP设置
  - 支持SMTP配置验证
- **成功标准**:
  - 管理员用户管理页面显示SMTP配置选项
  - 管理员可以为用户修改SMTP配置
  - 管理员可以验证SMTP配置
- **测试要求**:
  - `human-judgment` TR-4.1: 管理员用户管理页面显示SMTP配置区域
  - `programmatic` TR-4.2: 管理员可以成功为用户保存SMTP配置
  - `programmatic` TR-4.3: 管理员可以验证SMTP配置
- **备注**: 需修改user/index.vue文件

## [ ] 任务5: 系统设置页面添加SMTP用户配置权限开关
- **优先级**: P1
- **依赖项**: 任务1
- **描述**:
  - 在系统设置页面添加SMTP用户配置权限开关
  - 管理员可以通过此开关控制用户是否可以修改SMTP配置
- **成功标准**:
  - 系统设置页面显示SMTP用户配置权限开关
  - 管理员可以修改此开关状态
  - 修改后设置立即生效
- **测试要求**:
  - `human-judgment` TR-5.1: 系统设置页面显示SMTP用户配置权限开关
  - `programmatic` TR-5.2: 管理员可以成功修改开关状态
  - `programmatic` TR-5.3: 修改后的设置正确保存到数据库
- **备注**: 需修改sys-setting/index.vue文件

## [ ] 任务6: 测试和验证
- **优先级**: P2
- **依赖项**: 所有任务
- **描述**:
  - 测试所有功能的正常运行
  - 验证权限控制的正确性
  - 测试边界情况
- **成功标准**:
  - 所有功能正常运行
  - 权限控制正确生效
  - 无错误或异常
- **测试要求**:
  - `programmatic` TR-6.1: 所有API调用正常
  - `human-judgment` TR-6.2: 界面操作流畅，无明显bug
  - `programmatic` TR-6.3: 权限控制逻辑正确
- **备注**: 需进行全面测试
