# 邮件原始数据查看器 设计文档

## 背景

邮件查看界面（`/message`）目前只展示渲染后的正文和部分元数据（发件人、收件人、主题、时间）。排查邮件问题（投递状态、地址解析、头部字段、正文源码）时，需要查看邮件在数据库中存储的完整结构化数据。

当前界面没有便捷入口查看这些原始信息，需要登录数据库或查接口返回，效率低。

## 目标

在邮件查看页顶部工具栏增加一个"原始数据"按钮，点击弹出对话框，展示该邮件的全部结构化字段（数据库存储的所有字段 + 正文源码）。所有用户可见。

## 现状分析

### 数据已就位，无需后端改动

前端 `emailStore.contentData.email` 持有列表接口传来的 email 对象。列表接口用 `emailListFields`（`email-service.js:35`）= email 实体**除 content 外的所有字段**：

```
emailId, sendEmail, name, accountId, userId, subject, text, cc, bcc,
recipient, toEmail, toName, inReplyTo, relation, messageId, type,
status, message, unread, createTime, isDel, sendMethod
```

正文通过 `/email/content/:id` 按需加载，已缓存在 `emailBody` ref（`content/index.vue:135`）和 `emailStore.contentMap`，含 `{ content, text }`。

两者拼合即覆盖 email 表的全部字段，足以满足"结构化原始数据"需求，**不需要新增后端接口**。

### 按钮落点已存在

`content/index.vue:3-30` 的 `header-actions` 工具栏已有一排图标按钮（返回/删除/星标/回复/转发/下载/AI）。新增按钮沿用同一风格即可。

## 设计

### 1. 按钮

- 位置：`header-actions` 内，"下载"按钮（`exportEmail`，第 12 行）之后、AI 分组（`v-if="settingStore.settings.aiEnabled"`，第 13 行）之前
- 图标：`mdi:code-tags`（代码标签图标，语义贴切）
- 行为：点击 → `showRawDialog = true`
- 所有用户可见，无 `v-perm` 限制

### 2. 对话框

用 `el-dialog`（Element Plus，项目已在用）：

- 标题：`$t('rawDataTitle')`（新增 i18n key）
- 宽度：`min(800px, 90vw)`，移动端自适应
- 顶部右侧一个"复制全部"按钮
- 内容由 `el-tabs` 分两个标签页：

**Tab 1：元数据（默认）**
- 展示 `emailStore.contentData.email` 对象的格式化 JSON
- 渲染方式：`<pre class="raw-pre">{{ JSON.stringify(email, null, 2) }}</pre>`
- 等宽字体 + 深色背景 + 横向滚动（长字段如 recipient、messageId 不换行截断）

**Tab 2：正文源码**
- 展示 `emailBody.content`（HTML 原文，未渲染）和 `emailBody.text`
- 渲染方式：`<pre>` 展示原始字符串
- 若正文尚未加载完成（`bodyLoading`），显示 loading 文案

### 3. 复制功能

"复制全部"按钮调用 `navigator.clipboard.writeText(serialized)`，把元数据 + 正文拼成一个 JSON 字符串复制到剪贴板。成功后 `ElMessage.success`，失败 `ElMessage.error`。

### 4. i18n

新增 key（zh.js / en.js）：
- `rawDataTitle`: '邮件原始数据' / 'Raw Email Data'
- `rawMetadata`: '元数据' / 'Metadata'
- `rawBodySource`: '正文源码' / 'Body Source'
- `copyAll`: '复制全部' / 'Copy All'
- `copySuccess`: '已复制到剪贴板' / 'Copied to clipboard'

## 改动范围

仅前端，单文件：

| 文件 | 改动 |
|------|------|
| `mail-vue/src/views/content/index.vue` | 加按钮、对话框模板、showRawDialog 状态、复制函数、样式 |
| `mail-vue/src/i18n/zh.js` | 新增 5 个 key |
| `mail-vue/src/i18n/en.js` | 新增 5 个 key |

零后端改动。零新增依赖（el-dialog、el-tabs 都是 Element Plus 已有组件）。

## 不做（YAGNI）

- 不新增后端接口（已有数据足够）
- 不持久化原始 MIME 源码（范围外的存储改造）
- 不做语法高亮（`<pre>` + 等宽字体已满足可读性，避免引入 highlight.js 等依赖）
- 不做字段级折叠/筛选（JSON 整体展示足够简单直接）
- 不限制仅管理员可见（所有用户均可，简化权限）
