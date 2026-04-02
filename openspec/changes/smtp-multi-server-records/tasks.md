# 任务列表

- [x] 1. `smtp_account` 实体添加 `mailcow_server_id` 列（text, 默认空字符串）
- [x] 2. DB 初始化迁移：为 `smtp_account` 表添加 `mailcow_server_id` 列
- [x] 3. `smtpAccountService` 新增 `findByMailcowServer(c, accountId, mailcowServerId)` 方法
- [x] 4. `smtpAccountService.create` 和 `update` 支持保存 `mailcowServerId` 字段
- [x] 5. `account-service.applyMailcowSmtpConfig` 改为按 `mailcowServerId` 查找匹配记录，同服务器更新，不同服务器新建
- [x] 6. 新建记录时：名称带服务器名称标识；只有无已有记录时才设为默认
