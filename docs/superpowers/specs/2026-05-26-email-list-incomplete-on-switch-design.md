# 邮箱切换后邮件列表不全 — 修复设计

## 问题描述

用户在邮箱列表中快速切换不同邮箱账号时，邮件列表有时显示不全（为空或只有少量邮件），需要手动刷新才能恢复正常。快速连续切换时必现。

## 根因分析

`email-scroll/index.vue` 中 `getEmailList()` 使用 `reqLock` 布尔值防止并发请求。当 `refresh=true`（邮箱切换触发）时，如果上一次请求尚未完成，新请求被 `if (reqLock) return;` 直接丢弃，且无重试机制。

**时序复现：**

1. 点击邮箱 A → `refreshList()` → `getEmailList(true)` → `reqLock = true` → 发起请求
2. 立即点击邮箱 B → `refreshList()` → `getEmailList(true)` → `reqLock` 为 true → **直接 return**
3. 邮箱 A 的请求返回 → 渲染邮箱 A 的邮件到列表
4. 用户看到邮箱 B 被选中，但显示邮箱 A 的邮件

## 修复策略

使用 `AbortController` 取消旧请求 + 立即发起新请求。

### 涉及文件及修改

#### 1. `mail-vue/src/components/email-scroll/index.vue`（核心修改）

- 新增 `abortController` 变量替代 `reqLock` 对 refresh 请求的阻塞逻辑
- **refresh 场景（邮箱切换）**：如果有正在进行的请求，调用 `abortController.abort()` 取消旧请求，释放 `reqLock`，立即发新请求
- **滚动加载场景**：保持现有 `reqLock` 行为不变
- 将 `AbortController.signal` 作为第三参数传给 `props.getEmailList(emailId, size, signal)`
- `.catch()` 中忽略 `ERR_CANCELED` 错误，被取消的请求不触发 UI 副作用

#### 2. 父组件 `getEmailList` 回调（4 处透传 signal）

| 文件 | 修改内容 |
|------|----------|
| `views/email/index.vue` | `getEmailList(emailId, size, signal)` → 透传 signal 给 `emailList()` |
| `views/send/index.vue` | 同上 |
| `views/all-email/index.vue` | `getEmailList(emailId, size, signal)` → 透传 signal 给 `allEmailList()` |
| `views/star/index.vue` | `starList` 直接作为 prop，需包装为接受 signal 的函数 |
| `views/draft/index.vue` | 本地 IndexedDB 读取，signal 参数被忽略即可 |

#### 3. 请求函数

| 文件 | 修改内容 |
|------|----------|
| `request/email.js` — `emailList()` | 增加可选 `signal` 参数，传入 axios config |
| `request/all-email.js` — `allEmailList()` | 增加可选 `signal` 参数 |
| `request/star.js` — `starList()` | 增加可选 `signal` 参数 |

#### 4. `mail-vue/src/axios/index.js`

- 在错误拦截器最前面增加 `error.code === 'ERR_CANCELED'` 检查
- 被取消的请求静默 reject，不弹任何错误提示

### 不变的部分

- 后端 API 无需改动
- 滚动加载更多（非 refresh）保持原有 `reqLock` 行为
- `latest()` 轮询机制保持不变
- `existIds` Set 去重机制保持不变

## 测试验证

- 快速连续切换 3+ 个邮箱，最终显示的应始终是最后选中邮箱的邮件
- 正常切换邮箱，列表完整加载
- 滚动加载更多功能不受影响
- 被取消的请求不弹错误提示
