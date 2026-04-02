# 一键开通 SMTP：多服务器独立记录

## 问题

当前一键开通 SMTP 逻辑（`applyMailcowSmtpConfig`）只查找默认 SMTP 账户，无论选择哪台 mailcow 服务器都直接覆盖。用户在 SMTP 管理界面选择不同服务器点击一键开通时，期望新建一条独立的 SMTP 记录，而非替换已有记录。

## 方案

- `smtp_account` 表新增 `mailcow_server_id` 列，标识该 SMTP 记录来自哪台 mailcow 服务器
- 一键开通时按 `(accountId, mailcowServerId)` 查找已有记录：
  - 同一服务器 → 更新（替换）
  - 不同服务器 → 新建
- 新建的记录名称带服务器标识，便于区分
- 只有第一条记录自动设为默认

## 非目标

- 不改变手动创建/编辑 SMTP 账户的逻辑
- 不改变前端 UI 布局
- 不改变 mailcow 账户创建逻辑本身
