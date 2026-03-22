# Mailcow 服务器配置连接测试功能实现计划

## [x] 任务 1: 在后端添加 Mailcow 连接测试 API 端点
- **优先级**: P0
- **依赖**: 无
- **描述**:
  - 在 `mail-worker/src/api/setting-api.js` 中添加一个新的 API 端点，用于测试 Mailcow 服务器连接
  - 该端点应该接受服务器配置参数（API 地址、API 密钥等）并调用 `mailcowService.testConnection` 方法
- **成功标准**:
  - API 端点能够正确处理连接测试请求
  - 当连接成功时返回成功状态
  - 当连接失败时返回错误信息
- **测试要求**:
  - `programmatic` TR-1.1: API 端点返回 200 状态码表示连接成功
  - `programmatic` TR-1.2: API 端点返回 400 或 500 状态码表示连接失败
  - `human-judgement` TR-1.3: API 端点的实现代码清晰可读

## [x] 任务 2: 在前端修改 testMailcowConnection 函数
- **优先级**: P0
- **依赖**: 任务 1
- **描述**:
  - 修改 `mail-vue/src/views/sys-setting/index.vue` 中的 `testMailcowConnection` 函数
  - 添加 API 调用逻辑，将当前服务器配置发送到后端 API
  - 添加加载状态和错误处理
- **成功标准**:
  - 点击测试连接按钮时，显示加载状态
  - 连接成功时显示成功消息
  - 连接失败时显示错误消息
- **测试要求**:
  - `programmatic` TR-2.1: 点击测试连接按钮后显示加载状态
  - `programmatic` TR-2.2: 连接成功时显示成功消息
  - `programmatic` TR-2.3: 连接失败时显示错误消息
  - `human-judgement` TR-2.4: 界面响应及时，用户体验良好

## [x] 任务 3: 修复 Mailcow 服务器配置保存后消失的问题
- **优先级**: P0
- **依赖**: 无
- **描述**:
  - 检查 `mail-vue/src/views/sys-setting/index.vue` 中的 `saveMailcowServer` 函数
  - 确保保存后服务器配置正确添加到列表中且不会消失
  - 检查 `getSettings` 函数，确保配置在刷新后能正确加载
- **成功标准**:
  - 点击保存后服务器配置立即出现在列表中
  - 刷新页面后服务器配置仍然存在
  - 服务器配置列表显示正确
- **测试要求**:
  - `programmatic` TR-3.1: 保存服务器配置后，列表中立即显示新配置
  - `programmatic` TR-3.2: 刷新页面后，服务器配置仍然存在
  - `human-judgement` TR-3.3: 保存操作响应及时，用户体验良好

## [x] 任务 4: 测试连接测试功能
- **优先级**: P1
- **依赖**: 任务 1 和任务 2
- **描述**:
  - 启动开发服务器
  - 进入系统设置页面的 Mailcow 服务器配置部分
  - 输入有效的 Mailcow 服务器配置并测试连接
  - 输入无效的 Mailcow 服务器配置并测试连接
- **成功标准**:
  - 有效配置时连接测试成功
  - 无效配置时连接测试失败并显示错误信息
- **测试要求**:
  - `programmatic` TR-4.1: 有效配置时返回连接成功
  - `programmatic` TR-4.2: 无效配置时返回连接失败
  - `human-judgement` TR-4.3: 错误信息清晰明了

## [/] 任务 5: 提交代码到 GitHub
- **优先级**: P2
- **依赖**: 任务 1、任务 2、任务 3 和任务 4
- **描述**:
  - 提交修改的文件到 GitHub
  - 确保代码质量和提交信息清晰
- **成功标准**:
  - 代码成功提交到 GitHub
  - 提交信息清晰描述了实现的功能和修复的问题
- **测试要求**:
  - `programmatic` TR-5.1: 代码成功推送到 GitHub
  - `human-judgement` TR-5.2: 提交信息清晰明了