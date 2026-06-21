# 共享邮箱（Shared Mailbox）设计

- 日期：2026-06-21
- 状态：已通过设计评审，待实现
- 适用项目：cloud-mail（mail-worker / mail-vue）

## 1. 背景与目标

当前 `account`（邮箱）与 `user` 是一对一归属：`account.userId` 为单一所有者，邮箱地址全局唯一，重复添加会抛 `isRegAccount`；签名以 JSON 存于 `account.signatures`，绑定所有者；邮件按 `accountId + userId` 归属，`unread`/`isDel`/`star` 状态均按用户隔离。

本设计目标：

1. **共享邮箱**：同一个邮箱地址可被多个用户添加共用。
2. **共享收件箱**：邮件只存一份，已读 / 删除 / 星标状态对所有成员即时同步（团队客服邮箱语义）。
3. **共享签名**：邮箱级共享签名池 + 每个成员的个人签名池。
4. **权限开关**：新增权限项 `mailbox:share`，由管理员分配给角色，有权限者方可使用共享功能。
5. **管理端可见性**：管理员后台可查看某邮箱的具体成员列表，可指派、可踢除。

## 2. 关键决策（已确认）

| 决策点 | 选择 |
|---|---|
| 邮件可见性 | 共享同一份（单条记录），已读/删除/星标全员同步 |
| 加入方式 | create-or-share：添加时「不存在则新建，存在则共享（成为成员）」，用户端与管理员端均适用 |
| 成员管理 | 仅管理员后台指派 / 踢除 |
| 成员权限 | 全员平等：读/发/删/改签名；邮箱级设置（allReceive、置顶、改名、SMTP）仅 creator 或管理员可改 |
| 签名 | 邮箱级共享池 + 每成员个人池各一套；发送时以「用户上次选择」为准并记忆 |
| 配额 | 加入一个共享邮箱即占用该成员的 `accountCount` 配额 |
| 退出/被踢 | 仅删成员关系；个人签名保留，重新加入自动恢复 |
| 数据模型 | 方案 A：成员关系表（account=邮箱，account_member 多对多） |

## 3. 数据结构

核心思路：`account` 从「单用户所有」升级为「邮箱」概念，成员关系用新表表达。个人邮箱 = 成员数为 1 的共享邮箱，模型统一。

### 3.1 新增表 `account_member`（成员关系）

```
account_member
  member_id    INTEGER PRIMARY KEY AUTOINCREMENT
  account_id   INTEGER NOT NULL          -- 所属邮箱 account.accountId
  user_id      INTEGER NOT NULL          -- 成员 user.userId
  role         INTEGER NOT NULL DEFAULT 0  -- 预留，当前全员平等=0
  last_sig_scope TEXT NOT NULL DEFAULT ''  -- 上次选用签名来源 'shared'|'personal'
  last_sig_id    TEXT NOT NULL DEFAULT ''  -- 上次选用签名 id
  create_time  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  UNIQUE(account_id, user_id)
```

- creator 建邮箱时同时写入第一条成员记录。
- 成员判断、配额计数、踢人、签名记忆均走此表。

### 3.2 新增表 `account_member_signature`（个人签名）

```
account_member_signature
  sig_id     INTEGER PRIMARY KEY AUTOINCREMENT
  account_id INTEGER NOT NULL
  user_id    INTEGER NOT NULL            -- 仅本人可见可改
  sig_uid    TEXT NOT NULL               -- 业务 id（兼容前端 sig_xxx 格式）
  name       TEXT NOT NULL DEFAULT ''
  content    TEXT NOT NULL DEFAULT ''
  is_default INTEGER NOT NULL DEFAULT 0
  INDEX(account_id, user_id)
```

- 共享签名池继续存在 `account.signatures`（JSON，语义变为「邮箱级共享」），代码改动最小。
- 个人签名走新表，按 `(accountId, userId)` 隔离。

### 3.3 既有表调整

- `account.userId`：**保留**，语义改为「创建者（creator）」，用于归属展示与迁移兼容；访问控制改用 `account_member`。
- `email`：`accountId`/`userId` 不变。`accountId` 指向邮箱；`userId` 降级为「触发者/收件归属」仅作审计。`unread`、`isDel` 本就在行上，天然共享。
- `star`：当前按 `userId` 存，无法共享星标。**改为以 `emailId` 为准**（去掉 userId 维度，唯一约束改为 `emailId`），使星标对所有成员同步。
- `att`：`accountId` 不变，随邮箱共享。

### 3.4 权限项

- 新增 permKey `mailbox:share`，挂在「邮件账户」根权限节点下，名称「共享邮箱」。
- 管理员勾选后该角色用户才能使用共享功能（默认不开放）。

## 4. 接口与权限

### 4.1 权限种子

- `perm` 表「邮件账户」根节点下新增 `mailbox:share`（名称「共享邮箱」）。
- `init.js` 增加幂等播种逻辑（仿 `account:add` 写法），按需给默认角色分配（默认不开放）。

### 4.2 鉴权映射（`security.js`）

`security.js` 用 `requirePerms`（待校验路径）+ `premKey`（permKey → 授权路径）做路径级鉴权，admin（`c.env.admin`）直通。

- `/account/add` 同时挂到 `account:add` 和 `mailbox:share` 两个 key 的路径列表里——「有新建权」或「有共享权」的用户都能到达该端点，具体走哪个分支由 service 内部按 permKeys 精确判断：
  - 邮箱不存在 → 新建分支，校验 `account:add`
  - 邮箱已存在 → 共享分支，校验 `mailbox:share`（无权限则报 `unauthorized`）

### 4.3 端点设计

用户端（成员）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/account/add` | 改造为 create-or-share；命中已有邮箱则写入 `account_member` |
| GET | `/mailbox/:accountId/members` | 列出本邮箱成员（本人须为成员） |
| POST | `/mailbox/:accountId/leave` | 成员自行退出（仅删 `account_member`，不动邮件与个人签名） |
| GET/POST/PUT/DELETE | `/account/:accountId/signatures*` | 复用现有，改为共享签名池，权属校验由 owner 改为「成员」 |
| 同上 | `/account/:accountId/signatures/personal*` | 新增，个人签名，按 `(accountId, userId)` 隔离 |

管理端（admin）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/mailbox/:accountId/members` | 查看某邮箱成员列表 |
| POST | `/admin/mailbox/:accountId/members` | 指派成员 `{ userId }`（若邮箱不存在可一并 create-or-share） |
| DELETE | `/admin/mailbox/:accountId/members/:userId` | 踢除成员 |

### 4.4 统一权属校验

- 新增 helper `assertMember(c, accountId, userId)`：替换现有散落的 `accountRow.userId !== userId` 抛错点（`getSignatures`、`setName`、`delete`、`setAllReceive`、`setAsTop`、邮件读/删/星标等）。成员即放行；非成员抛 `noUserAccount`。

## 5. 收件归属与邮件可见性

### 5.1 收件路径（`HandleOnSiteEmail`）——几乎不变

- 仍按收件人邮箱查到唯一 `account`（邮箱），把邮件写入 `accountId = 邮箱`、`userId = 邮箱.creator`（仅作审计归属）。
- 邮件只存一份；`unread`/`isDel`/`star` 都在行级或按邮件，天然对所有成员同步。

### 5.2 可见性解析（新增 helper）

- `getVisibleAccountIds(c, userId)` → `account_member` 里该用户的所有 `accountId`。
- 列邮箱（`account.list`）：从 `account.userId = ?` 改为 `JOIN account_member WHERE account_member.userId = ?`。
- 配额（`countUserAccount`）：改为统计 `account_member` 行数（加入即 +1）。

### 5.3 邮件列表（`email.list`）——去掉 userId 维度

- 主键过滤由 `accountId = ? AND userId = ?` 改为**仅 `accountId = ?`**（进入前先 `assertMember`）。
  - 收件箱：全员看到该邮箱全部收件。
  - 已发送：全员看到任一成员从该邮箱发出的邮件（`email.userId` 仅记录发件人，不作过滤）。
- `allReceive` 模式：由「该用户全部 account」改为 `accountId IN (getVisibleAccountIds)`。
- `star` join 去掉 `star.userId = ?` 条件（配合第 3.3 节 star 改为按邮件），`isStar` 派生不变。

### 5.4 读 / 删 / 星标——改为成员级、按邮件

| 操作 | 现在 | 改为 |
|---|---|---|
| 标记已读 | `WHERE userId=? AND emailId IN(...)` | 先 `assertMember(email.accountId)`，再 `WHERE accountId=? AND emailId IN(...)` |
| 删除（软删） | `WHERE userId=? AND emailId IN(...)` | 同上，按 `accountId + emailId`；`isDel` 行级 → 全员同步可见 |
| 星标 | `star` 插入/删除按 `userId+emailId` | 按 `emailId`（唯一约束改 emailId） |

结果：A 读/删/星标 → B 立即同步，符合「单份共享」。

### 5.5 邮箱级设置权限边界

- `setAllReceive`/`setAsTop`/`setName`/SMTP 配置影响全员且含凭据，**仅 creator 或管理员可改**。
- 签名（共享 + 个人）全员可改。

## 6. 签名

### 6.1 存储分层

- 共享池：`account.signatures`（JSON，沿用现有结构 `{id,name,content,isDefault}`），语义变为邮箱级，全员共读共写。
- 个人池：`account_member_signature` 表，仅本人可见可改。

### 6.2 发送时签名解析（用户选择优先 + 记忆上次）

- 在 `account_member` 维持 `lastSigScope`（`shared`/`personal`）+ `lastSigId`，记忆该成员上次选用的签名。
- 写信时默认 = 上次选用的签名（若仍存在）；手动重选即更新记忆。
- 兜底链：记忆签名不存在（被删）→ 共享默认 → 无。
- 首次（尚无记忆）：共享默认 → 无。

即「上次选择」始终优先于「默认签名」，默认签名仅在无记忆或记忆失效时兜底。

### 6.3 接口

- 共享签名：复用 `/account/:accountId/signatures*`（GET/POST/PUT/DELETE/setDefault），权属校验由 owner 改为「成员」。
- 个人签名：新增 `/account/:accountId/signatures/personal*` 同结构 CRUD，按 `(accountId, userId)` 隔离。

### 6.4 默认互斥规则

- 共享池内仍仅 1 条 isDefault（沿用现有逻辑：设默认时清其他）。
- 个人池内同样仅 1 条 isDefault。
- 两池默认独立存在，互不干扰，仅发送时按 6.2 优先级取其一。

### 6.5 前端签名选择器

- 写信时下拉分两组：「共享签名」「我的签名」，标注来源；选中后记忆为该成员偏好（持久化到 `account_member`，跨设备生效）。

## 7. 管理端

### 7.1 成员视图（后台）

- `GET /admin/mailbox/:accountId/members` 返回该邮箱全部成员：`userId / 邮箱 / 是否 creator / 加入时间`。
- 现有「账户管理」列表（`adminListAccounts`）每行新增「成员数」列与「查看成员」入口；点开抽屉/弹窗显示成员明细。

### 7.2 指派成员

- `POST /admin/mailbox/:accountId/members { userId }`：
  - 校验目标邮箱存在、目标用户存在且未禁用。
  - 若该用户已是成员 → 幂等返回。
  - 校验配额（`accountCount`）：超限报 `accountLimit`。
  - 写入 `account_member`。
  - create-or-share 语义：若 `accountId` 不存在但管理员提供了邮箱，则先建邮箱再指派（沿用 `/account/add` 的 create-or-share 分支）。

### 7.3 踢除成员

- `DELETE /admin/mailbox/:accountId/members/:userId`：
  - 删除 `account_member` 记录，不动邮件（邮件仍属邮箱）。
  - **保留**被踢用户的个人签名（`account_member_signature` 不删），便于重新加入恢复。
  - creator 不可被踢（保证邮箱始终至少有所有者）；如需转让所有权另走流程（本期不做）。
  - 邮箱最后一名成员也不可清空——至少保留 creator。

### 7.4 权限

- `/admin/mailbox/*` 走管理员鉴权（沿用现有 admin 路径模式，admin 直通）；普通成员的 `/mailbox/:accountId/members`、`/leave` 挂 `mailbox:share`。

### 7.5 统计/分析兼容

- `selectUserEmailCountList` 等按 `email.userId` 统计的逻辑保持不变（审计归属仍准确）；管理端「用户邮件数」按用户维度统计不受影响。

## 8. 迁移、边界与前端

### 8.1 数据库迁移 `v4_3DB(c)`（幂等）

```sql
-- 成员关系表
CREATE TABLE IF NOT EXISTS account_member (
  member_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role INTEGER NOT NULL DEFAULT 0,
  last_sig_scope TEXT NOT NULL DEFAULT '',
  last_sig_id TEXT NOT NULL DEFAULT '',
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_member_unique ON account_member(account_id, user_id);

-- 个人签名表
CREATE TABLE IF NOT EXISTS account_member_signature (
  sig_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sig_uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ams_lookup ON account_member_signature(account_id, user_id);
```

- **数据回填**：`INSERT OR IGNORE INTO account_member(account_id, user_id) SELECT account_id, user_id FROM account WHERE is_del = 0;`（现有 owner 全部成为单成员邮箱，模型统一）。
- **star 改造**：先按 `email_id` 去重 `DELETE FROM star WHERE rowid NOT IN (SELECT MIN(rowid) FROM star GROUP BY email_id);`，再 `CREATE UNIQUE INDEX IF NOT EXISTS idx_star_email ON star(email_id);`（使星标按邮件共享）。
- **权限播种**：在「邮件账户」根下插入 `perm_key='mailbox:share'`（幂等），按需给默认角色分配（默认不开放）。

### 8.2 边界规则

- **主邮箱不可共享**：`user.email` 对应的账号（登录身份）禁止 create-or-share 加入他人；该限制在 `add()` 内拦截。
- **退出/被踢**：仅删 `account_member`；**个人签名保留**，下次重新加入自动恢复。
- **删除邮箱**（软删 `account`）：连带置 `account_member` 失效（成员全部失去访问）；邮件按现有逻辑重置为 NOONE。仅 creator/管理员可删。
- **成员保护**：creator 与「最后一名成员」不可被踢/退出，保证邮箱不悬空。
- **配额**：加入即占配额；退出/被踢释放。
- **mailcow/SMTP**：邮箱级 SMTP 凭据仅 creator/管理员可改（第 5.5 节）；成员发信沿用邮箱已配置的凭据。

### 8.3 前端（mail-vue）改动点

- 账户列表接口已含共享邮箱（后端自动）；侧栏无需大改。
- 写信签名选择器：分「共享/我的」两组，记忆上次（第 6 节）。
- 账户设置页：新增「成员」入口（成员查看列表、退出）；标注哪些设置仅 creator 可改。
- 后台「账户管理」：新增「成员数」列 +「成员管理」抽屉（查看/指派/踢除）。
- 权限：前端按 `userPermKeys` 含 `mailbox:share` 才显示「加入共享邮箱」相关入口；无权限时添加已存在邮箱给出友好提示。

### 8.4 国际化

- 新增 `perms.mailbox:share` 及共享相关文案（中/英），沿用现有 i18n 结构。

## 9. 影响面与风险

- **查询重写面广**：`account.list`、`email.list`、读/删/星标、配额计数等均需从 `userId` 维度迁移到「成员身份」维度，需逐一覆盖并回归。
- **star 表结构变更**：由按用户改为按邮件，需迁移去重 + 唯一索引；个人邮箱星标语义不变（单人即单星）。
- **向后兼容**：现有 1:1 账号经回填后变为「单成员共享邮箱」，行为不变。
- **权限粒度**：邮箱级设置仅 creator/管理员可改，需在相关 service 入口做角色判断。
- **未覆盖项（本期不做）**：所有权转让、成员分级（owner/member/readonly）、邀请审批流。
