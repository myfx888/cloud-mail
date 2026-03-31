## 1. 数据库迁移

- [x] 1.1 在 `mail-worker/src/entity/setting.js` 中添加新字段定义
  - `mailcowPasswordMode` (TEXT: 'fixed' | 'random', 默认 'random')
  - `mailcowProvisionPassword` (TEXT, 敏感)
  - `mailcowCreateStrict` (INTEGER: 0 | 1, 默认 0)
  - `mailcowGlobalSmtpTemplate` (TEXT, JSON)
  - `smtpServers` (TEXT, JSON，多 SMTP 服务器配置)

- [x] 1.2 在账户实体中添加服务器绑定字段
  - `smtpServerId` (TEXT, 账户绑定 SMTP 服务器)
  - `mailcowServerId` (TEXT, 账户绑定 Mailcow 服务器)

- [x] 1.3 在 `mail-worker/src/init/init.js` 中添加迁移脚本 `v3_7DB()`
  - 使用 `ALTER TABLE ADD COLUMN` 添加新字段
  - 设置默认值保证兼容性
  - 捕获已存在字段的错误并跳过

## 2. 后端设置服务

- [x] 2.1 在 `mail-worker/src/service/setting-service.js` 中添加新字段读写逻辑
  - `query()` 方法：处理新字段的默认值和 JSON 解析
  - `set()` 方法：处理新字段的保存和验证
  - 敏感字段脱敏：`mailcowProvisionPassword` 返回 `******`
  - API Key 脱敏：`mailcowServers[].apiKey` 显示 `key****xxx`

- [x] 2.2 添加全局 SMTP 模板字段验证
  - 验证 JSON 格式
  - 验证字段类型（`smtpHost`, `smtpPort`, `smtpSecure`, `smtpAuthType`）

- [x] 2.3 增加 SMTP 多服务器配置读写与校验
  - 支持 `smtpServers` 列表新增/编辑/禁用/默认服务器
  - 校验默认服务器唯一性
  - 校验字段完整性（`name`, `smtpHost`, `smtpPort`, `smtpSecure`, `smtpAuthType`）

## 3. 后端 Mailcow 服务

- [x] 3.1 在 `mail-worker/src/service/mailcow-service.js` 中添加重复账户检测
  - 新增 `accountExists(c, email, serverConfig)` 方法
  - 调用 Mailcow API `/api/v1/get/mailbox/{email}` 查询
  - 处理查询失败和异常格式

- [x] 3.2 修改 `createAccount()` 方法支持双密码模式
  - 从设置中读取 `mailcowPasswordMode`
  - `fixed` 模式：使用 `mailcowProvisionPassword`
  - `random` 模式：使用现有 `generatePassword()`

- [x] 3.3 添加 SMTP 配置合并逻辑
  - 新增 `getSmtpConfig(c, serverConfig)` 方法
  - 优先级：服务器配置 > 全局模板 > 硬编码默认值

- [x] 3.4 实现 SMTP 服务器池查询与按 ID 解析
  - 新增 `getSmtpServerById(c, smtpServerId)`
  - 新增 `getDefaultSmtpServer(c)`

## 4. 后端账户服务

- [x] 4.1 在 `mail-worker/src/service/account-service.js` 中集成重复账户检测
  - 创建前调用 `mailcowService.accountExists()`
  - 已存在则跳过创建，标记 `mailcowStatus = 'exists_as_success'`
  - 根据 `mailcowServerId` 或默认服务器选择 Mailcow 目标节点

- [x] 4.2 集成失败策略处理
  - 从设置中读取 `mailcowCreateStrict`
  - 宽松模式：失败仅记录状态，不阻断
  - 严格模式：失败则回滚本地账户创建

- [x] 4.3 集成 SMTP 配置回填
  - 使用 `mailcowService.getSmtpConfig()` 获取配置
  - 更新本地账户的 SMTP 字段

- [x] 4.4 集成账户 SMTP 服务器绑定与切换
  - 新建账户自动绑定默认 `smtpServerId`
  - 新增账户切换 SMTP 服务器接口并立即回填配置

- [x] 4.5 新增失败项重试接口
  - 在账户控制器新增 `POST /api/account/:accountId/mailcow/retry`
  - 仅允许 `mailcowStatus=failed` 的账户触发
  - 复用 Mailcow 创建与 SMTP 回填主流程

## 5. 前端系统设置 UI

- [x] 5.1 在 `mail-vue/src/views/sys-setting/index.vue` 中添加密码模式配置
  - 下拉选择：`fixed` / `random`
  - 固定密码输入框（仅 `fixed` 模式显示）
  - 密码字段脱敏显示

- [x] 5.2 添加创建失败策略开关
  - Switch 组件：宽松/严格模式切换
  - 提示文字说明两种模式的区别

- [x] 5.3 添加全局 SMTP 模板配置
  - 输入框：主机、端口、加密方式、认证类型
  - JSON 格式预览和验证

- [x] 5.4 增加 SMTP 多服务器配置面板
  - 支持新增/编辑/禁用 SMTP 服务器
  - 支持设置默认 SMTP 服务器
  - 支持按服务器维度测试连接

- [x] 5.5 更新 Mailcow 服务器配置弹窗
  - 显示当前 API Key 脱敏值
  - 支持更新 API Key（留空则不修改）
  - 支持设置默认 Mailcow 服务器

- [x] 5.6 添加测试连接按钮
  - 验证 Mailcow API 连接和认证
  - 显示成功/失败提示

- [x] 5.7 在账户列表为失败项添加重试按钮
  - 仅 `mailcowStatus=failed` 时显示“重试”按钮
  - 点击后调用重试接口并展示 loading 状态
  - 重试完成后刷新状态和错误信息

- [x] 5.8 合并账户界面重复 SMTP 按钮
  - 列表行内仅保留一个“SMTP 设置”入口
  - 统一弹窗整合服务器选择、参数预览、测试连接
  - 列表页与详情页入口名称和行为保持一致

- [x] 5.9 在回复编辑窗口右下角增加 SMTP 下拉切换
  - 可用 SMTP 服务器数大于 1 时显示下拉框
  - 默认选中账户绑定服务器或默认服务器
  - 切换仅作用于当前回复会话，不修改账户长期绑定
  - 无可用服务器时禁用并显示提示

## 6. 测试验证

- [ ] 6.1 测试数据库迁移
  - 验证新字段添加成功
  - 验证默认值正确
  - 验证旧数据兼容
  - 验证 `smtpServerId` 和 `mailcowServerId` 字段迁移

- [ ] 6.2 测试密码模式
  - 固定模式创建账户，验证密码一致
  - 随机模式创建账户，验证密码随机
  - 敏感字段脱敏显示

- [ ] 6.3 测试失败策略
  - 宽松模式：Mailcow 失败，本地账户创建成功
  - 严格模式：Mailcow 失败，本地账户创建失败

- [ ] 6.4 测试重复账户处理
  - 已存在邮箱：跳过创建，回填 SMTP
  - 不存在邮箱：正常创建

- [ ] 6.5 测试 SMTP 配置优先级
  - 服务器配置完整：使用服务器配置
  - 服务器配置部分缺失：使用全局模板补充
  - 均缺失：使用硬编码默认值

- [ ] 6.6 测试 SMTP 多服务器能力
  - 新建账户默认绑定默认 SMTP 服务器
  - 账户切换 SMTP 服务器后配置即时更新
  - 禁用服务器后不可被新账户选择

- [ ] 6.7 测试失败项重试流程
  - 失败项显示重试按钮，非失败项不显示
  - 重试成功后状态更新为 `success` 或 `exists_as_success`
  - 重试失败后保持 `failed` 并更新错误信息

- [ ] 6.8 测试账户界面按钮统一
  - SMTP 重复按钮已移除，仅保留统一入口
  - 列表与详情入口命名一致

- [ ] 6.9 测试回复窗口 SMTP 下拉切换
  - 右下角下拉框显示条件正确（多服务器显示）
  - 切换后发送走所选 SMTP 服务器
  - 切换不改写账户长期绑定的 `smtpServerId`
  - 无可用服务器时禁用并有提示

## 7. 文档更新

- [x] 7.1 更新 API 文档
  - 新增字段说明
  - 敏感字段脱敏规则

- [x] 7.2 更新用户手册
  - Mailcow 配置步骤
  - 密码模式选择建议
  - 失败策略说明

## 8. Mailcow 配置中心化 UI 重构（方案 C）

- [x] 8.1 将 Mailcow 设置从单弹窗改为配置中心布局
  - 前端：将现有弹窗拆分为“全局策略区 + Mailcow 服务器列表 + 服务器详情区”
  - 前端：服务器列表支持默认标记、启用状态、最近测试状态展示
  - 前端：服务器详情支持基础参数、SMTP 覆盖参数编辑
  - 验收：管理员可在一个页面完成全局配置与单服务器配置，无需切换多个弹窗

- [x] 8.2 增加按服务器粒度测试连接
  - 前端：每个服务器行提供“测试连接”入口
  - 后端：测试接口支持按 serverId 或临时参数执行
  - 前端：展示最近一次测试结果（成功/失败、时间、摘要）
  - 验收：测试结果与所选服务器一一对应，失败信息可用于复现排查

- [x] 8.3 增加服务器操作护栏
  - 后端：禁用默认服务器前校验是否已存在新的默认服务器
  - 后端：删除服务器前校验绑定账户依赖（阻止删除并返回依赖数量）
  - 前端：在详情区展示“影响范围”（绑定账户数量）
  - 验收：高风险操作均有拦截与明确提示，不会产生无默认服务器或悬空绑定

- [x] 8.4 保留高级模式导入导出
  - 前端：提供 JSON 导入/导出入口（高级模式）
  - 前端：普通模式默认使用结构化表单
  - 后端：导入内容沿用现有字段校验逻辑
  - 前端：校验失败时可定位到具体项（索引、字段名、错误原因）
  - 验收：高级模式与普通模式互不破坏，配置可双向还原

- [ ] 8.5 配置中心回归验证
  - 验证旧配置数据可无损加载到新界面
  - 验证默认服务器切换、禁用与删除护栏生效
  - 验证按服务器测试连接与状态展示一致
  - 验证高级模式导入导出与结构化表单互转一致
  - 验收：核心路径（配置、测试、默认切换、依赖拦截）全部通过

- [x] 8.6 迭代交付顺序（建议）
  - 第 1 迭代：完成 8.1（布局与编辑）
  - 第 2 迭代：完成 8.2（按服务器测试）
  - 第 3 迭代：完成 8.3（护栏与依赖拦截）
  - 第 4 迭代：完成 8.4 与 8.5（高级模式与回归）
  - 验收：每个迭代可独立演示并具备回滚点

- [x] 8.7 阶段门禁评审（Go/No-Go）
  - M1 门禁：旧配置回显正确，且保存后持久化一致
  - M2 门禁：按服务器测试结果不串线，失败信息可定位
  - M3 门禁：默认切换/禁用/删除拦截可阻断危险路径
  - M4 门禁：普通模式与高级模式互转不损坏配置
  - 验收：任一门禁失败即暂停进入下一迭代并执行回滚评估
