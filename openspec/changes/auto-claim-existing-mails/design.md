## 上下文

系统目前在收到发往不存在账号的邮件时，如果 `noRecipient` 设置为 `OPEN`，会将邮件保存并标记为 `status = NOONE`，归属于 `userId = 0` 和 `accountId = 0`。当用户随后创建了对应的邮箱账号时，这些历史邮件依然处于“孤儿”状态，用户无法在收件箱中看到它们。

## 目标 / 非目标

**目标：**
- 在新账号创建成功后，自动将其名下的历史“孤儿”邮件（`NOONE` 状态）认领到新账号下。
- 同步更新关联的附件记录。
- 确保认领过程不影响账号创建的主流程性能和稳定性（选项 A：非阻塞/宽容处理）。

**非目标：**
- 处理被拒收（`BOUNCED`）的邮件。
- 自动重发认领后的邮件通知。

## 决策

### 1. 触发点选择
在 `accountService.add` 方法成功执行 `orm(c).insert(account)...` 并处理完 Mailcow/SMTP 初始化逻辑后调用认领方法。
- **理由**：确保账号已持久化且基础配置（如 `mailcow` 绑定）已完成，认领逻辑可以安全引用新生成的 `accountId`。

### 2. 数据库更新策略
在 `emailService` 中增加一个 `claimHistoricalMails` 方法，执行以下 SQL 操作：
- `UPDATE email SET userId = ?, accountId = ?, status = RECEIVE WHERE toEmail = ? AND status = NOONE AND userId = 0 AND accountId = 0`
- `UPDATE att SET userId = ?, accountId = ? WHERE emailId IN (SELECT emailId FROM email WHERE ...)`
- **优化**：使用事务或子查询确保一致性。考虑到 D1 的限制，将先查询出匹配的 `emailId` 列表，再批量更新 `email` 和 `att`。

### 3. 错误处理 (选项 A)
将认领逻辑包裹在 `try-catch` 中，失败仅打印错误日志，不抛出异常。
- **理由**：账号创建是高频核心业务，不能因为历史数据认领的非关键错误导致新用户无法注册。

## 风险 / 权衡

- **性能风险**：如果某个邮箱地址有极大量的历史堆积邮件，更新操作可能较慢。
  - **缓解**：通过 `LIMIT` 限制单次认领数量，或在后台异步处理（当前架构首选同步但带超时控制）。
- **数据一致性**：更新 `email` 后更新 `att` 之间如果发生中断。
  - **缓解**：认领状态变更应作为原子操作，或确保查询条件足够严谨。
