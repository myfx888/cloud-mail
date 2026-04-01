## 1. 核心 Service 实现

- [x] 1.1 在 `email-service.js` 中实现 `claimHistoricalMails` 方法，用于批量更新 `NOONE` 状态邮件及附件的归属
- [x] 1.2 在 `account-service.js` 的 `add` 方法中集成认领逻辑，确保账号创建后自动触发

## 2. 验证与测试

- [ ] 2.1 验证新建邮箱后，历史 `NOONE` 邮件是否正确出现在收件箱
- [ ] 2.2 验证关联附件是否也能正常访问
- [ ] 2.3 验证认领逻辑失败时（如故意制造 SQL 错误）不影响账号正常创建
