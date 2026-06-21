# 邮件回收站（Email Recycle Bin）设计

- 日期：2026-06-21
- 状态：已通过设计评审，待实现
- 适用项目：cloud-mail（mail-worker / mail-vue）
- 关联：与 `2026-06-21-shared-mailbox-design.md` 兼容（删除为邮箱级行级 `isDel`，回收站随之共享）

## 1. 背景与目标

当前删除语义：
- 用户 `/email/delete` → 软删（`email.isDel = 1`），但**无用户端「已删除」视图**（`email.list` 仅查 `isDel=0`），也无邮件级恢复接口。
- 管理员 `/allEmail/delete`、`/allEmail/batchDelete` → 物理删除（删行 + 附件），已限 `all-email:delete`。
- 邮件级「恢复」API 不存在（仅用户/账号恢复时有 `restoreByUserId`）。

本设计目标：

1. **删除即入回收站**：所有用户删除均为软删，进入回收站，不真正删除。
2. **用户可恢复**：用户在回收站查看（按邮箱）并一键恢复已删邮件。
3. **永久删除仅管理员**：物理删除保持管理员专属，用户无任何物理删除路径。
4. **不自动清理**：已删邮件留存至用户恢复或管理员永久删除。

## 2. 关键决策（已确认）

| 决策点 | 选择 |
|---|---|
| 删除语义 | 软删 `isDel=1` = 进入回收站（现状不变） |
| 恢复权限 | 用户可自行恢复（共享邮箱则全员可恢复） |
| 永久删除 | 仅管理员（现状不变，物理删除） |
| 自动清理 | 不自动清理，留存至恢复或管理员永久删除 |
| 展示范围 | 用户按邮箱；管理员全局 |
| 列表实现 | 方案 A：扩展 `email.list` 增加 `deleted` 模式 |

## 3. 行为模型（无新表，复用 `email.isDel`）

- 删除 = 软删 `isDel=1` → 即「进入回收站」。
- 恢复 = `isDel=0`，邮件回到原邮箱原类型（收件 / 已发送）。
- 永久删除 = 物理删行（仅管理员）。
- 不自动清理。

## 4. 用户端（按邮箱）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/email/list?deleted=1&accountId=…` | 扩展现有 `email.list`：`deleted=1` 时过滤 `isDel=1`，其余逻辑（按邮箱、allReceive、latestEmail、附件）复用；进入前 `assertMember` |
| PUT | `/email/restore` | `{ emailIds }` 恢复：`assertMember(email.accountId)` 后 `SET isDel=0 WHERE accountId=? AND emailId IN(…)` |

### 4.1 `email.list` 扩展

- 新增 `deleted` 参数：为真时 where 子句用 `eq(email.isDel, isDel.DELETE)`，正常列表仍 `eq(email.isDel, isDel.NORMAL)`。
- 其余查询逻辑（accountId 过滤、allReceive、分页、latestEmail、附件装配）完全复用。
- 与共享邮箱设计衔接：列表过滤改为按 `accountId`（成员身份），回收站随之按邮箱共享。

### 4.2 恢复接口

- `PUT /email/restore { emailIds }`：
  - 解析 `emailIds`（逗号分隔）。
  - 对涉及邮件 `assertMember(email.accountId)`（非成员抛 `noUserAccount`）。
  - `UPDATE email SET isDel = NORMAL WHERE accountId IN(…可见邮箱) AND emailId IN(…)`。

### 4.3 权限

- 查看回收站：沿用 `/email/list`（已登录即可，该路径未列入 `requirePerms`）。
- `/email/restore`：挂 `email:delete`（能删即可恢复）——写入 `security.js` 的 `requirePerms`，并在 `premKey['email:delete']` 追加 `/email/restore`。

## 5. 管理员端（全局）

- **已有**（无需后端改动）：
  - `allList` 支持 `type=delete` 全局查已删邮件。
  - `/allEmail/delete`（按 emailIds 物理删）、`/allEmail/batchDelete`（按条件物理删），均限 `all-email:delete`。
- **前端补充**：后台「邮件管理」暴露「回收站」入口（`type=delete`）+「永久删除」按钮（单条 / 批量），复用现有接口。

## 6. 前端（mail-vue）

- **用户**：选中邮箱时，邮件列表区新增「回收站」标签页；列表项提供「恢复」操作；不提供「永久删除」（灰置或隐藏，提示需联系管理员）。
- **管理员**：后台邮件管理新增「回收站」全局视图 + 永久删除（单条 / 批量）。
- **i18n**：新增「回收站 / 恢复 / 永久删除 / 已删除邮件」等文案（中 / 英），沿用现有 i18n 结构。

## 7. 边界规则

- 用户无任何物理删除路径（`/email/delete` 仅软删）。
- 账号 / 用户被删时的级联物理删除（`physicsDeleteByAccountId` / `physicsDeleteUserIds`）属管理员生命周期操作，保持不变，不在回收站语义内。
- 恢复时若原邮箱已被删（`account.isDel=1`），提示无法恢复（邮箱不存在）。
- 草稿（`status=SAVING`）走同一软删 / 恢复路径。
- 共享邮箱：回收站按邮箱共享，任一成员删除 / 恢复对全员即时同步（行级 `isDel`）。

## 8. 影响面与风险

- **`email.list` 分支增加**：新增 `deleted` 模式，需保证正常列表（`isDel=0`）行为不回归。
- **恢复的权属校验**：必须 `assertMember`，避免越权恢复他人邮箱邮件。
- **与共享邮箱的依赖**：用户端回收站按邮箱共享的前提是共享邮箱设计（Section 5）已将 `email.list` 改为按 `accountId` + 成员身份；两份 spec 需协同实现。
- **未覆盖项（本期不做）**：自动清理策略、恢复后的通知、回收站容量限制。
