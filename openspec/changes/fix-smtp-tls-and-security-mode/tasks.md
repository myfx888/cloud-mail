## 1. 配置与模式修复

- [x] 1.1 修复 `smtp-account-service.js` 中 `secure` 默认赋值逻辑，保留 `0` 值
- [x] 1.2 在 `smtp-service.js` 新增统一安全模式解析函数（`smtpSecure` -> `secure/startTls`）
- [x] 1.3 将发送与验证流程统一接入安全模式解析函数

## 2. 发送与验证链路修复

- [x] 2.1 修复 `formatAttachments` 字段映射，输出 `mimeType`
- [x] 2.2 修复 `verify()` 连接生命周期，确保连接关闭
- [x] 2.3 保留并增强 TLS 失败日志，便于区分模式错配与证书/SNI问题

## 3. 验证与收尾

- [ ] 3.1 执行针对 SMTP 验证链路的最小回归测试
- [x] 3.2 更新任务状态并输出修复结果与后续建议
