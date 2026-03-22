# 邮件编辑页面 Resend 选项显示控制实现计划

## 项目背景
需要实现当后台关闭 resend 功能时，邮件编辑页面将不显示 resend 选项。

## 实现目标
- 当后台 resend 功能关闭时，邮件编辑页面只显示 SMTP 选项
- 当后台 resend 功能开启时，邮件编辑页面同时显示 resend 和 SMTP 选项
- 确保功能切换平滑，不影响现有功能

## 分解任务

### [ ] 任务 1: 分析现有代码结构
- **Priority**: P0
- **Depends On**: None
- **Description**:
  - 分析邮件编辑页面的 resend 选项显示逻辑
  - 确认后台 resend 功能开关的实现
  - 了解 settingStore 的使用方式
- **Success Criteria**:
  - 理解现有代码结构
  - 确认 resend 功能开关的存储位置
- **Test Requirements**:
  - `programmatic` TR-1.1: 确认 settingStore 中包含 resendEnabled 字段
  - `human-judgement` TR-1.2: 理解邮件编辑页面的 sendMethod 逻辑

### [ ] 任务 2: 修改邮件编辑页面，添加 resend 选项显示控制
- **Priority**: P0
- **Depends On**: 任务 1
- **Description**:
  - 修改邮件编辑页面的模板，根据 resendEnabled 字段控制 resend 选项的显示
  - 确保当 resend 功能关闭时，默认选择 SMTP 选项
  - 确保当 resend 功能开启时，保持原有默认值
- **Success Criteria**:
  - 当 resendEnabled 为 0 时，只显示 SMTP 选项
  - 当 resendEnabled 为 1 时，显示 resend 和 SMTP 选项
  - 默认值设置正确
- **Test Requirements**:
  - `programmatic` TR-2.1: 当 resendEnabled 为 0 时，只显示 SMTP 选项
  - `programmatic` TR-2.2: 当 resendEnabled 为 1 时，显示 resend 和 SMTP 选项
  - `programmatic` TR-2.3: 默认值设置正确

### [ ] 任务 3: 测试验证
- **Priority**: P1
- **Depends On**: 任务 2
- **Description**:
  - 测试后台关闭 resend 功能时的显示效果
  - 测试后台开启 resend 功能时的显示效果
  - 测试邮件发送功能是否正常
- **Success Criteria**:
  - 功能切换正常
  - 邮件发送功能正常
  - 用户体验良好
- **Test Requirements**:
  - `programmatic` TR-3.1: 后台关闭 resend 功能时只显示 SMTP 选项
  - `programmatic` TR-3.2: 后台开启 resend 功能时显示两个选项
  - `human-judgement` TR-3.3: 界面显示正常，用户体验良好

## 技术方案

### 1. 代码修改
- **文件**: `mail-vue/src/layout/write/index.vue`
- **修改点**: 
  - 在模板中添加条件判断，根据 `settingStore.settings.resendEnabled` 控制 resend 选项的显示
  - 在 `open` 方法中设置默认值，当 resend 功能关闭时默认选择 SMTP

### 2. 实现逻辑
- 当 `settingStore.settings.resendEnabled` 为 1 时，显示 resend 和 SMTP 选项
- 当 `settingStore.settings.resendEnabled` 为 0 时，只显示 SMTP 选项
- 在 `open` 方法中，根据 resendEnabled 的值设置默认的 sendMethod

## 风险评估

1. **功能兼容性**：修改后需要确保现有邮件发送功能不受影响
   - 缓解措施：保持 SMTP 选项始终可用

2. **用户体验**：需要确保界面切换平滑，不影响用户操作
   - 缓解措施：合理设置默认值，确保用户操作流程顺畅

3. **代码维护**：修改后需要确保代码易于维护
   - 缓解措施：添加清晰的注释，保持代码结构简洁

## 成功标准

- 后台关闭 resend 功能时，邮件编辑页面只显示 SMTP 选项
- 后台开启 resend 功能时，邮件编辑页面同时显示 resend 和 SMTP 选项
- 功能切换平滑，不影响现有功能
- 代码结构清晰，易于维护

## 实施时间估计

- 任务 1: 0.5 天
- 任务 2: 0.5 天
- 任务 3: 0.5 天

总计：1.5 天