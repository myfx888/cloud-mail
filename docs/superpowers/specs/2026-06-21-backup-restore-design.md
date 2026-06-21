# 邮件备份恢复（Backup & Restore）设计

- 日期：2026-06-21
- 状态：已通过设计评审，待实现
- 适用项目：cloud-mail（mail-worker / mail-vue）

## 1. 背景与目标

### 1.1 现状

- 收信链路 `src/email/email.js` 已实现：「`postal-mime` 解析原始邮件 → 按收件地址 `message.to` 查 `account` → 写 `email` 表 → 附件按内容 hash 上传 R2（`key = ATTACHMENT_PREFIX + hash + ext`）」。
- **NOONE 机制**已存在：`email-service.js` 的 `HandleOnSiteEmail` 中，收件地址无对应 `account` → `userId=0, accountId=0, status=NOONE`；后台 `allList` 支持 `type=noone` 查看「全部邮件」列表。
- `claimHistoricalMails`：用户新建邮箱时，自动把历史 NOONE 邮件（按 `toEmail` 匹配）认领到新邮箱。
- `emailConst.sendMethod.IMPORTED = 'imported'` **已预留**。
- `email-service.js` 中已有半成品 `importEmail / exportEmail / generateEml / parseEml`——但均为**占位实现**：
  - `generateEml` 附件写死 `'SGVsbG8gV29ybGQ='`（base64 的 "Hello World"），未读取真实 R2 内容；
  - `parseEml` 为手写简易解析，不支持 base64 / quoted-printable 解码、编码主题、折叠头；
  - `importEmail` 按 `accountId` 参数导入（要求账户属于当前用户），而非按收件地址自动路由；
  - 以上方法**未被任何 API 调用**。
- 存储后端 `r2-service.js` 支持 **R2 / S3 / KV** 三态切换（`storageType` → 统一 `putObj / getObj / delete`）。
- 已有 cron `0 16 * * *`（每日 0 点），可用于定时备份。
- 后台鉴权：`userContext.isAdmin(c)`。

本设计将**重写上述占位方法并接线到新 API**，新增统一的备份/导入任务体系。

### 1.2 目标

1. **系统整体备份 / 恢复**：导出全部邮件（正文 + 附件）+ 系统配置（用户 / 账户 / 角色 / 权限 / 设置 / 凭据等），可整体还原实例状态。
2. **外部邮件导入恢复**：支持 EML（单封）与 MBOX（多封），**按收件地址自动归入对应邮箱**；找不到邮箱则进「全部邮件」（NOONE），日后建邮箱可自动认领。
3. **多文件批量上传**：恢复/导入支持**一次上传多个邮件文件**（多个 EML、多个 MBOX 可混合，大集合可分批累积）。
4. 一套「导入 / 导出引擎」复用于「整体备份恢复」与「外部导入」两场景，避免重复实现。

## 2. 关键决策（已确认）

| 决策点 | 选择 |
|---|---|
| 外部导入格式 | EML（单封 RFC822）+ MBOX（多封合一，Thunderbird / Gmail Takeout） |
| 多文件上传 | 支持；`/admin/restore/upload` 多文件，可多次累积，一个任务绑定多个源文件 |
| 目标邮箱不存在 | 落 NOONE（`accountId=0, userId=0, status=NOONE`）进「全部邮件」；日后建邮箱可 `claimHistoricalMails` 自动认领 |
| 整体备份范围 | 邮件正文 + 附件 + 系统配置（user / account / role / role_perm / perm / setting / smtp_account / reg_key / oauth / account_member） |
| 恢复冲突 | 合并去重：按 `Message-ID` + 归属范围判重，已存在则跳过；配置按唯一键跳过（不覆盖） |
| 备份载体 | R2 云留存（多版本）+ 本地下载 |
| 大批量处理 | 任务表 + 前端轮询分批，断点续传、进度可见 |
| 触发方式 | 手动为主 + 可选定时（复用现有 cron，加开关） |
| 权限 | 仅管理员（`userContext.isAdmin`） |

## 3. 数据结构

### 3.1 新增表 `backup_task`（统一备份 / 导入 / 恢复任务）

```
backup_task
  task_id      INTEGER PRIMARY KEY AUTOINCREMENT
  type         TEXT NOT NULL                       -- 'backup' | 'restore' | 'import'
  status       TEXT NOT NULL DEFAULT 'pending'     -- pending/processing/completed/failed/cancelled
  source_keys  TEXT NOT NULL DEFAULT '[]'          -- JSON 数组：导入/恢复时上传到 R2 的暂存文件 key 列表（多文件）
  result_key   TEXT                                -- 备份时：生成的备份包 R2 前缀（backup/<taskId>/）
  file_index   INTEGER NOT NULL DEFAULT 0          -- 多文件处理进度：当前处理到第几个 source_key
  cursor       INTEGER NOT NULL DEFAULT 0          -- 单文件内邮件游标（MBOX 已读取字节数 / 已处理封数）
  total        INTEGER NOT NULL DEFAULT 0          -- 邮件总封数（预估或解析后更新）
  processed    INTEGER NOT NULL DEFAULT 0          -- 成功导入/导出
  skipped      INTEGER NOT NULL DEFAULT 0          -- 去重跳过
  failed       INTEGER NOT NULL DEFAULT 0          -- 失败
  params       TEXT NOT NULL DEFAULT '{}'          -- JSON：范围/筛选/去重策略/是否含配置/是否含凭据/批次大小/模式
  detail_log   TEXT NOT NULL DEFAULT '[]'          -- JSON：失败/跳过明细（截取前 100 条，含文件名+原因）
  create_time  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  update_time  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  expire_time  TEXT                                -- 暂存文件与已完成任务结果的清理时间
  INDEX(type, status)
```

- `params` 示例（导入）：`{ "mode": "import", "dedup": "skip", "batchSize": 20 }`
- `params` 示例（备份）：`{ "scope": "all", "filter": { "accountIds": [], "startTime": null, "endTime": null, "types": ["receive","send"] }, "includeConfig": true, "includeSecrets": false, "schedule": "once" }`

### 3.2 备份包结构

整体备份以 **R2 前缀 `backup/<taskId>/`** 下多对象存储：

```
backup/<taskId>/
  manifest.json   -- 版本、生成时间、邮件数、各配置表行数、includeSecrets 标记、checksum
  emails.mbox     -- 所有邮件聚合为标准 MBOX（附件 base64 内嵌）
  config.json     -- 系统配置各表数据（includeSecrets=false 时已脱敏）
```

- 下载端点流式合成单个 **`.tar`** 交付（512 字节 tar 头 + 拼接，项目内轻量实现，**不新增重依赖**）。
- 纯邮件导出（不含配置）可直接下载 `emails.mbox`。
- 附件**内嵌进 MBOX/EML**（base64），保证单包自包含、可移植到其他邮件系统。
- 接口中的 `backupId` 即生成该备份的 `task_id`，二者等价。

## 4. 接口（管理员）

全部走 `userContext.isAdmin(c)`，admin 直通；非管理员抛 `unauthorized`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/backup/create` | 创建备份任务，body：`{ scope, filter, includeConfig, includeSecrets, schedule }` → 返回 `taskId` |
| POST | `/admin/backup/:taskId/process` | 推进一批导出（前端轮询），返回进度 |
| GET | `/admin/backup/:taskId/progress` | 查进度 / 明细 |
| GET | `/admin/backup/list` | 列出 R2 历史备份（`backup/*` 前缀）+ 任务记录 |
| GET | `/admin/backup/:backupId/download` | 流式下载备份包（tar） |
| DELETE | `/admin/backup/:backupId` | 删除某份备份（R2 前缀下对象 + 任务记录） |
| POST | `/admin/restore/upload` | **多文件**上传 EML/MBOX/备份包到 R2 暂存，body：multipart 多 file → 返回本次 `sourceKeys[]`（可多次调用累积） |
| POST | `/admin/restore/create` | 建恢复/导入任务，body：`{ sourceKeys: [...], mode: 'import'\|'restore', dedup: 'skip' }` → 返回 `taskId` |
| POST | `/admin/restore/:taskId/process` | 推进一批解析入库（前端轮询） |
| GET | `/admin/restore/:taskId/progress` | 进度 + imported/skipped/failed 明细 |
| GET | `/admin/restore/task/list` | 历史恢复/导入任务 |
| POST | `/admin/backup-task/:taskId/cancel` | 取消任务（置 `cancelled`，后续批次不再执行） |

- 上传与建任务分离：前端可多次 `/restore/upload` 累积多个文件，再 `/restore/create` 统一建一个任务，天然支持「一次上传多个邮件文件」且不受单请求体大小限制。
- 单次 `upload` 受 Worker 单请求体上限约束（约 100MB）；超出由前端自动分多次上传。

## 5. 组件划分

- **`service/backup-service.js`（新）**：任务管理（建 / 推进 / 进度 / 取消）、备份导出、配置 dump / restore、MBOX 聚合、备份包 tar 打包与解析、多文件遍历调度。
- **`service/email-service.js`（改造）**：
  - 新增 `importSingleEmail(c, parsed, opts)`——单封邮件「路由 + 去重 + 入库 + 附件入 R2」核心注入函数，供 backup-service 调用；
  - **重写** `parseEml`（改用 `postal-mime`）、`generateEml`（附件读真实 R2 内容做 base64）、`importEmail`（改为按收件地址路由）、`exportEmail`。
- **`utils/mbox-utils.js`（新）**：MBOX 切分（按 `From ` 分隔符 + `>From` 转义还原，流式按字节游标）与聚合（标准 `From ` 行分隔 + 转义）。
- **`utils/tar-utils.js`（新）**：轻量 tar 打包（manifest/mbox/config → 单 tar 流）。
- **`entity/backup-task.js`（新）**：任务表实体。
- **`api/backup-api.js`（新）**：上述接口，挂到 hono app。

## 6. 备份导出流程

1. `create` → 建 `backup_task(type=backup)`，初始化 `cursor=0`；若 `schedule=cron` 则登记定时（复用现有 cron，开关存 `setting` 表新 key `backup_cron`，默认关闭）。
2. `process` 一批（按 `emailId` 游标 `cursor`）：
   - 每封：从 R2 读真实附件字节 → 生成标准 EML（正确 base64 / quoted-printable 编码，保留原 `Date` / `Message-ID` / 头域）→ 追加进 `emails.mbox`（`From ` 分隔符 + 转义）。
   - 增量写 R2（`backup/<taskId>/emails.mbox`，追加写，避免单请求内存爆炸）。
   - 更新 `cursor / processed`。
3. 邮件遍历完成后，配置 dump：导出 user / account / role / role_perm / perm / setting / smtp_account / reg_key / oauth / account_member（若存在）；`includeSecrets=false` 时剔除 `password / salt / token / smtpPassword / smtpUser` 等敏感字段 → `config.json`。
4. 写 `manifest.json`（版本、生成时间、邮件数、各表行数、`includeSecrets` 标记、checksum、`sensitivity` 标记）。
5. 完成 → `result_key = backup/<taskId>/`；提供下载；R2 按时间保留最近 N 份（默认 10，可配，超额由 cron 清理最旧）。

## 7. 恢复 / 导入流程

### 7.1 上传（多文件）

1. 前端 `/admin/restore/upload` 一次传一个或多个文件（`el-upload multiple` + 拖拽）；大集合自动分多次上传。
2. 每个文件落 R2 暂存（key 前缀 `restore/<random>/`），返回 `sourceKeys[]` 累积到前端。
3. 前端 `/admin/restore/create { sourceKeys, mode, dedup }` 建一个任务，`backup_task.source_keys = [...]`。

### 7.2 处理（分批 + 多文件遍历）

`process` 每次处理一批（默认 20 封，`batchSize` 可配）：

1. 按 `file_index` 取当前源文件，按 `cursor` 读取本批：
   - **EML**：单封，一次处理完即 `file_index++`、`cursor=0`；
   - **MBOX**：流式按 `From ` 行切分，取本批 N 封，记录读取到的字节偏移到 `cursor`；文件读完 `file_index++`、`cursor=0`；
   - **备份包**（检测到 `manifest.json`）：`mode=restore`，先恢复配置（见 7.3），再把 `emails.mbox` 作为 MBOX 走邮件恢复。
2. 每封 `postal-mime.parse` → **按 `toEmail` 路由**：查 `account`（含 `isDel`）；命中且正常 → `accountId / userId` 归属；未命中 → `0 / 0 + status=NOONE`。
3. **去重**（`dedup=skip`）：
   - 有 `Message-ID` → 归入 account 时查 `(accountId, messageId)`；NOONE 时查 `(toEmail, messageId)`；存在则 `skipped++`；
   - 无 `Message-ID` → 用 `(sendEmail, toEmail, subject, Date)` 元组查重；仍空则新增。
4. 入库：调 `emailService.importSingleEmail`，`type=RECEIVE, sendMethod=IMPORTED, status=RECEIVE/NOONE`，**保留原始 `createTime` / `Date`**；附件按内容 hash 上传 R2（相同 hash 自动复用，天然去重），CID 内嵌图片走 `imgReplace` 替换。
5. 单封失败 → `failed++` 并记 `detail_log`（文件名 + 原因），**不中断整批**。
6. 所有文件处理完 → `status=completed`；产出 `imported / skipped / failed` 报告。

### 7.3 整体备份恢复的配置还原（mode=restore）

- 先恢复配置，再恢复邮件。
- **合并语义，已存在一律跳过，不覆盖**：
  - `user` / `account`：按 `email` 唯一去重，已存在跳过；
  - `role` / `role_perm` / `perm`：按主键 / 唯一键去重，已存在跳过（避免破坏现有权限配置）；
  - `setting`：按 key 去重跳过；
  - `smtp_account` / `reg_key` / `oauth` / `account_member`：按各自唯一键去重跳过；`account_member` 按 `(accountId, userId)` 去重。
- 配置恢复后，邮件恢复时按 `toEmail` 路由能命中刚还原的邮箱。
- `includeSecrets=false` 的备份包恢复时，敏感字段以占位/空值还原（user 无法直接登录，需管理员重置密码）——manifest 标注，前端给出提示。

## 8. 边界与错误处理

- **Worker 体积 / 内存**：上传走 R2 暂存；MBOX 流式按字节游标切割，不全量入内存；每批 N 封（默认 20）。
- **CPU / 时长**：前端轮询驱动分批，单请求只处理一批；`cursor / file_index` 持久化，**断点续传**。
- **去重兜底**：`Message-ID` 缺失走 `(sendEmail, toEmail, subject, Date)` 元组指纹。
- **附件过大**：单附件超后端单值上限（KV 后端）时，存 R2/S3 后端或记警告跳过该附件，邮件仍入库。
- **配置冲突**：合并语义，已存在跳过，绝不覆盖现有数据。
- **凭据安全**：`includeSecrets` 默认 `false`；含 secrets 的备份包仅 admin 可下载与访问；manifest 标注 `sensitivity`。
- **取消**：`cancel` 置 `status=cancelled`，后续批次不再执行；已写入数据保留（合并语义，不回滚）。
- **清理**：暂存文件（`restore/*`）与已完成/取消任务的 `expire_time` 由 cron 清理。
- **域名校验**：导入邮件 `toEmail` 域名不在 `env.domain` 时不强制拒绝，直接落 NOONE，与现有收信一致。

## 9. 前端（mail-vue）

后台新增「备份恢复」页（管理员可见）：

- **备份**：
  - 创建表单：范围（全部 / 按邮箱 / 按时间 / 按收发类型）、是否含配置、是否含凭据、立即或定时；
  - 历史备份列表（R2 留存）：下载 / 删除，标注是否含凭据；
  - 实时进度条（processed / total）。
- **恢复 / 导入**：
  - 拖拽上传区（`el-upload multiple`）：支持一次选多个 `.eml` / `.mbox` / 备份包，显示已选文件清单，支持移除；
  - 大集合自动分批上传，显示上传进度；
  - 模式选择：纯邮件导入 / 备份包恢复；
  - 处理实时进度（imported / skipped / failed）；
  - 完成后查看明细报告（失败列表 + 原因）。
- 复用 Element Plus 上传组件 + 轮询 + 进度条；i18n 中英文案。

## 10. 迁移与清理

- 新增 `backup_task` 表（幂等迁移函数，命名沿用现有约定，如 `v4_4DB(c)`，`CREATE TABLE IF NOT EXISTS` + 索引）。
- **重写** `email-service.js` 占位方法（`parseEml / generateEml / importEmail / exportEmail`）并接线到新 `backup-api`；删除写死的假附件数据。
- 新增 i18n 文案（中 / 英），沿用现有结构。

## 11. 测试

- **vitest**（项目已用）：
  - 单封 EML 导入（含附件、CID 内嵌图）；
  - MBOX 多封切分（`From ` 分隔符、`>From` 转义还原、跨批次续读）；
  - 去重：有 / 无 `Message-ID` 两种路径；
  - NOONE 路由：收件地址无 account 时落 NOONE；
  - 附件入库与内容 hash dedup；
  - 配置 dump → restore 往返一致性（含 / 不含 secrets）；
  - 多文件任务：多个 EML + MBOX 混合，`file_index` 推进正确。
- **wrangler-test** 集成：端到端「备份 → 清库 → 恢复 → 校验邮件与配置」。

## 12. 影响面与风险

- **大批量性能**：依赖前端在线驱动分批；超大规模（十万级邮件）需评估 R2 配额与总耗时，必要时调大 `batchSize` 或接受长时间运行。
- **备份包体积**：附件内嵌使包变大；超大附件场景可考虑后续分卷（本期不做）。
- **凭据泄露面**：含 secrets 的备份包需严格控制访问与传输，建议生产环境配合最小授权。
- **与 shared-mailbox（`account_member`）关系**：配置 dump 一并导出 `account_member`（若该表存在），恢复时按 `(accountId, userId)` 去重跳过；不冲突。
- **打包实现**：tar 为项目内轻量自实现，需正确处理文件名与大小字段，覆盖测试。
- **未覆盖项（本期不做）**：增量备份、跨实例自动同步、PST/MSG 解析、备份包加密、压缩。
