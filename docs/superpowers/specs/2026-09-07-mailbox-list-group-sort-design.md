# 邮箱列表分组与拖动排序 — 设计文档

日期：2026-09-07
状态：设计已与用户确认，待实现

## 1. 背景与目标

邮箱列表（`mail-vue/src/layout/account/index.vue`，主内容区旁边的邮箱面板）目前只支持"置顶"一种排序操作，且排序数据存在 `account.sort`（账号级），共享邮箱的顺序改动会影响所有成员。

目标：

1. 邮箱列表支持**用户级**的分组与拖动排序——每个用户对自己的列表（含共享邮箱）自由组织，互不影响。
2. 主邮箱永远置顶；聚合收信（allReceive）、回复时引用各自邮箱地址等现有行为不变。
3. "删除邮箱"语义改为**仅从自己列表移除**：其他添加了该邮箱的成员不受影响；仅当最后一个成员删除时才真正删除邮箱。

## 2. 需求结论（已与用户逐项确认）

| 决策点 | 结论 |
|---|---|
| 分组/排序归属级别 | 用户级（每人自己的视图，共享邮箱互不影响） |
| 界面形态 | 可折叠分组标题 + 组间拖动排序 + 组内拖动排序 + 邮箱跨组拖动 |
| 数据加载 | 一次性加载全部可见邮箱，去掉无限滚动分页 |
| 现有"置顶"菜单项 | 移除（拖到最顶部即等价置顶），后端 `setAsTop` 一并删除 |
| 主邮箱 | 永远第一（现有 `isPrimary` 逻辑保证），不参与分组和拖动 |
| 删除语义 | 删除 = 仅移出自己列表；最后成员删除时才真删整箱 |

## 3. 数据模型与迁移

存储方案：`account_member` 扩展列 + 新分组表（方案A）。每个用户可见的账户必有 `account_member` 行（自建与共享都会插入），因此用户级视图属性挂在 member 行上。

```sql
-- account_member 加两列（旧数据默认值即兼容，零迁移成本）
ALTER TABLE account_member ADD COLUMN view_sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_member ADD COLUMN view_group INTEGER NOT NULL DEFAULT 0;

-- 用户自定义分组表
CREATE TABLE account_group (
  group_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL,
  name     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0
);
```

约定：

- `view_group = 0` 表示"未分组"；`view_sort` / 组 `sort` 数值越大越靠前（与现有 `account.sort` 语义一致）。
- 主邮箱不存视图数据，排序永远由 `isPrimary` 保证第一。
- 排序规则（列表查询）：

```sql
ORDER BY isPrimary DESC, view_sort DESC, account.sort DESC, account.accountId ASC
```

- 旧数据兼容：全部 `view_sort = 0` 时退化为现有顺序（`account.sort DESC, accountId ASC`），列表初始顺序与改造前完全一致。
- 迁移方式：沿用仓库惯例，手工 SQL + `wrangler d1 execute` 对生产库执行。

实体层：`mail-worker/src/entity/account-member.js` 增加 `viewSort`、`viewGroup` 字段；新增 `mail-worker/src/entity/account-group.js`。

## 4. 后端 API（mail-worker）

| 接口 | 变化 |
|---|---|
| `GET /account/list` | 改为一次性全量返回（去掉 `lastSort` 游标分页与 `size` 截断），每行附带 `viewSort`/`viewGroup`；排序规则见第3节 |
| `PUT /account/view`（新增） | 整体保存当前用户的视图（分组 + 成员归属与排序），见下 |
| `DELETE /account/delete` | 语义改为"仅移出自己列表"，见 4.2 |
| `PUT /account/setAsTop` | 删除路由；同时清理 `account-service.js` 中两个重复定义的 `setAsTop` 函数（存量 bug，第二个覆盖第一个） |

### 4.1 PUT /account/view

请求体（整体覆盖式保存，前端每次拖动/建组/删组/重命名后全量提交）：

```json
{
  "groups": [
    { "id": 0, "name": "工作", "sort": 100 },
    { "id": 5, "name": "客户", "sort": 90 }
  ],
  "items": [
    { "accountId": 12, "viewGroup": 5, "viewSort": 80 },
    { "accountId": 13, "viewGroup": 0, "viewSort": 70 }
  ]
}
```

处理逻辑（D1 batch 单事务）：

1. 校验：`items` 中每个 `accountId` 当前用户必须是成员（`assertMember`），任一越权则整体拒绝。
2. 主邮箱的 item 直接过滤（`isPrimary` 强制第一，视图数据无意义）。
3. 分组 upsert：`id > 0` 且属于当前用户 → 更新 name/sort；`id = 0` 或缺省 → 插入；请求中未出现的该用户旧组 → 删除，其组内成员 `view_group` 置 0（回落未分组）。
4. `items` 批量更新 member 行的 `view_group` / `view_sort`。

分组管理不单独开 CRUD 接口——新建/重命名/删除分组都由前端改完视图后走本接口整体保存（YAGNI）。

### 4.2 DELETE /account/delete（新语义）

1. 权限从"创建者/admin（`assertCanManage`）"放宽为"是该邮箱成员（`assertMember`）"；前端菜单项也不再要求 `account:delete` 权限。
2. 拒绝删除主邮箱（沿用现有 `delMyAccount` 校验）。
3. 删除自己的 `account_member` 行 = 从自己列表移除，其他成员不受影响。
4. 若删除后该账户**无任何剩余成员** → 沿用现有真删流程（`isDel = 1` + 邮件/附件释放回 NOONE 可再认领 + 现有后续清理逻辑）。
5. 原 `leave` 接口的"创建者不能退出/最后成员不能退出"拦截保持不动（`leave` 及其调用方零改动）；新的删除语义在 `accountService.delete` 内实现，不受 `leave` 限制约束。
6. admin 后台账户管理页（`views/account`）的整箱删除能力不变。

## 5. 前端设计（mail-vue）

### 5.1 列表结构

```
[主邮箱卡片]        固定第一，不可拖，不参与分组
[组A 标题]（可折叠，标题行可拖动排序）
  [邮箱卡片]
  [邮箱卡片]
[组B 标题] ...
[未分组]            view_group=0 的邮箱；为空时隐藏该标题
```

### 5.2 拖动（引入 sortablejs）

- 多容器方案：所有组的容器与"未分组"区共用 `group: 'accounts'`（邮箱跨组拖、组内排序）；组标题列表容器 `group: 'groups'`（组间排序）。
- 主邮箱卡片通过 `filter` 排除，不可拖。
- 折叠状态的组容器不可作为拖入目标。
- 整卡拖动，点击与拖动由 sortablejs 阈值自然区分；`onEnd` 设抑制标志，防止拖放结束误触发卡片的 `changeAccount` 点击。
- 移动端：`delay: 200`（长按触发）避免与滚动冲突。
- 保存流程：任何拖动/建组/删组/重命名结束 → 本地立即生效（乐观更新）→ 静默 `PUT /account/view` → 失败则还原本次操作前快照并弹错误提示。

### 5.3 加载与渲染

- 删除无限滚动、骨架屏分页、`lastSort` 游标相关代码；改为进入面板时一次 `GET /account/list` 渲染全部（`el-scrollbar` 保留）。
- 折叠状态存 localStorage（纯 UI 偏好不入库），key 如 `account-group-collapsed`。
- 附带改善：`accountStore.accounts` 变为全量，写信页发件人选择等消费方不再受 30 条分页限制。

### 5.4 菜单与入口变化

- 下拉菜单：移除"置顶"项；"删除"项对**所有非主邮箱**显示（不再要求 `account:delete` 权限），确认弹窗文案区分两种影响：
  - 还有其他成员："删除后该邮箱将从你的列表移除，其他成员不受影响"
  - 你是最后一个成员："删除后该邮箱将被彻底删除"
- 列表头部新增"新建分组"图标按钮（现有"+"添加邮箱与刷新按钮不动），点击弹组名输入。
- 组标题右侧操作：重命名（弹窗）、删除组（确认后组内邮箱回落未分组）。
- 点击切换账户、allReceive 图标、复制地址、签名管理、SMTP 管理入口全部原样保留。

### 5.5 i18n

`mail-vue/src/i18n/zh.js` 与 `en.js` 同步新增：新建分组、未分组、组名、重命名分组、删除分组确认、移出列表确认（含两种文案）等 key。

## 6. 边界情况

- **共享邮箱被移除成员 / 账户被删**：列表查询 innerJoin member 自然过滤，列表即时不再显示。
- **member 行删除**（无论是自己移出还是被移除成员）：该用户此邮箱的视图排序/分组随行一并消失；重新被共享则回到默认排序（可接受）。
- **保存并发冲突**：整体覆盖保存，后保存者胜（单人单会话为主，可接受）。
- **admin**：列表同样由 member 关系驱动，行为与普通用户一致。
- **邮箱数量上限**：一次性全量加载在数百级别无压力；如未来需要，再引入按组懒加载（不在本期）。

## 7. 测试

- worker 单测（vitest，仓库已有设施）：
  - `GET /account/list`：全量返回；排序断言（主邮箱第一、`view_sort` 降序、旧数据全 0 时与旧顺序一致）。
  - `PUT /account/view`：正常保存；越权 `accountId` 整体拒绝；删除组后成员回落未分组；主邮箱视图数据被忽略；非成员请求整体拒绝。
  - `DELETE /account/delete` 新语义：普通成员移出自己；创建者移出后其他成员保留且数据完整；最后一个成员删除触发真删（邮件释放 NOONE）；主邮箱拒绝。
- 前端手工验收清单：组内/跨组/组间拖动、折叠记忆、刷新后持久化、保存失败回滚、删除两种文案、移动端长按拖动、写信页发件人列表全量。

## 8. 已知限制（记录在案，不处理）

- 创建者移出共享邮箱后，若想重新添加同一地址：账户仍被其他成员持有，`add` 会提示已存在，需请其他成员重新共享。
- 视图数据不纳入备份导出（`backup-service` 仅导出账号级 `account.sort`，个人视图属个人数据，本期不进备份）。
