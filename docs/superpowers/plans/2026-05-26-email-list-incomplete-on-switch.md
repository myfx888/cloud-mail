# 邮箱切换邮件列表不全修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复快速切换邮箱时邮件列表不全的问题，使用 AbortController 取消旧请求并立即发新请求。

**Architecture:** 在 `email-scroll` 组件中引入 AbortController，refresh 场景下取消旧请求并释放锁；signal 通过 props 回调透传到 axios 请求层；axios 错误拦截器静默处理被取消的请求。

**Tech Stack:** Vue 3, Axios, AbortController (Web API)

---

### Task 1: Axios 错误拦截器 — 处理请求取消

**Files:**
- Modify: `mail-vue/src/axios/index.js:72-116`

- [ ] **Step 1: 在错误拦截器最前面添加 ERR_CANCELED 检查**

在 `(error) => {` 回调的第一行添加取消请求的静默处理：

```javascript
(error) => {

    // 被 AbortController 取消的请求，静默 reject，不弹任何提示
    if (error?.code === 'ERR_CANCELED') {
        return Promise.reject(error);
    }

    if (error.status === 403) {
```

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/axios/index.js
git commit -m "fix: silently handle canceled requests in axios error interceptor"
```

---

### Task 2: 请求函数 — 增加 signal 参数

**Files:**
- Modify: `mail-vue/src/request/email.js:3-4`
- Modify: `mail-vue/src/request/all-email.js:3-4`
- Modify: `mail-vue/src/request/star.js:11-12`

- [ ] **Step 1: 更新 `emailList` 函数签名**

`mail-vue/src/request/email.js` — 增加可选 `signal` 参数：

```javascript
export function emailList(accountId, allReceive, emailId, timeSort, size, type, signal) {
    return http.get('/email/list', {params: {accountId, allReceive, emailId, timeSort, size, type}, signal})
}
```

- [ ] **Step 2: 更新 `allEmailList` 函数签名**

`mail-vue/src/request/all-email.js` — 增加可选 `signal` 参数：

```javascript
export function allEmailList(params, signal) {
    return http.get('/allEmail/list', {params: {...params}, signal})
}
```

- [ ] **Step 3: 更新 `starList` 函数签名**

`mail-vue/src/request/star.js` — 增加可选 `signal` 参数：

```javascript
export function starList(emailId, size, signal) {
    return http.get('/star/list', {params: {emailId, size}, signal})
}
```

- [ ] **Step 4: Commit**

```bash
git add mail-vue/src/request/email.js mail-vue/src/request/all-email.js mail-vue/src/request/star.js
git commit -m "feat: add AbortController signal support to request functions"
```

---

### Task 3: email-scroll 组件 — AbortController 核心逻辑

**Files:**
- Modify: `mail-vue/src/components/email-scroll/index.vue:314` (reqLock 附近)
- Modify: `mail-vue/src/components/email-scroll/index.vue:938-998` (getEmailList 函数)

- [ ] **Step 1: 添加 abortController 变量**

在 `let reqLock = false` 下方（约第 314 行）添加：

```javascript
let reqLock = false
let abortController = null
```

- [ ] **Step 2: 重写 getEmailList 函数**

替换整个 `getEmailList` 函数（第 938-998 行）为：

```javascript
function getEmailList(refresh = false) {

  let emailId = emailList.length > 0 ? emailList.at(-1).emailId : 0;

  if (!refresh) {

    if (reqLock || loading.value || noLoading.value) {
      return
    }

  } else {
    // refresh 场景：取消旧请求，立即发新请求
    if (abortController) {
      abortController.abort()
      abortController = null
      reqLock = false
    }
    getSkeletonRows()
    emailId = 0
    loading.value = true
    scrollTop = 0
  }

  reqLock = true
  abortController = new AbortController()
  const signal = abortController.signal

  if (emailList.length === 0) {
    loading.value = true
  } else {
    followLoading.value = !refresh;
  }
  let start = Date.now();

  props.getEmailList(emailId, queryParam.size, signal).then(async data => {
    let end = Date.now();
    let duration = end - start;
    if (duration < 300 && !emailId) {
        await sleep(300 - duration)
    }
    firstLoad.value = false

    let list = data.list.map(item => ({
      ...item,
      checked: false
    }));


    if (refresh) {
      emailList.length = 0
    }

    latestEmail.value = data.latestEmail

    handleList(list);
    emailList.push(...list);
    if (refresh) scrollbarRef.value?.setScrollTop(0);

    noLoading.value = data.list.length < queryParam.size;
    followLoading.value = data.list.length >= queryParam.size;

    total.value = data.total;
  }).catch(err => {
    // 被 AbortController 取消的请求，静默忽略
    if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError' || err?.name === 'CanceledError') {
      return
    }
    console.error(err)
  }).finally(() => {
    loading.value = false
    reqLock = false
    abortController = null
  })
}
```

关键变化：
- `reqLock` 检查只在非 refresh 场景生效
- refresh 场景下先 `abort()` 旧请求再发新请求
- 将 `signal` 传给 `props.getEmailList`
- `.catch()` 静默处理取消错误

- [ ] **Step 3: Commit**

```bash
git add mail-vue/src/components/email-scroll/index.vue
git commit -m "fix: use AbortController to cancel stale requests on mailbox switch"
```

---

### Task 4: 父组件 — 透传 signal 参数

**Files:**
- Modify: `mail-vue/src/views/email/index.vue:141-149`
- Modify: `mail-vue/src/views/send/index.vue:74-82`
- Modify: `mail-vue/src/views/all-email/index.vue:291-293`
- Modify: `mail-vue/src/views/star/index.vue:5`

注意：`views/draft/index.vue` 使用本地 IndexedDB，`signal` 参数被自动忽略，无需修改。

- [ ] **Step 1: 更新 `views/email/index.vue` 的 getEmailList**

```javascript
function getEmailList(emailId, size, signal) {
  const accountId =  accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 0, signal).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}
```

- [ ] **Step 2: 更新 `views/send/index.vue` 的 getEmailList**

```javascript
function getEmailList(emailId, size, signal) {
  const accountId =  accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 1, signal).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}
```

- [ ] **Step 3: 更新 `views/all-email/index.vue` 的 getEmailList**

```javascript
function getEmailList(emailId, size, signal) {
  return allEmailList({emailId, size, ...params}, signal)
}
```

- [ ] **Step 4: 更新 `views/star/index.vue` — 包装 starList**

`starList` 当前直接作为 prop 传入，签名为 `starList(emailId, size)`，需要包装以透传 signal。

在 `<script setup>` 中添加包装函数，并更新模板：

模板修改：
```html
<emailScroll type="star" ref="scroll"
             :allow-star="false"
             :cancel-success="cancelStar"
             :getEmailList="getStarList"
             :emailDelete="emailDelete"
```

脚本中添加：
```javascript
function getStarList(emailId, size, signal) {
  return starList(emailId, size, signal)
}
```

- [ ] **Step 5: Commit**

```bash
git add mail-vue/src/views/email/index.vue mail-vue/src/views/send/index.vue mail-vue/src/views/all-email/index.vue mail-vue/src/views/star/index.vue
git commit -m "feat: pass AbortController signal through parent getEmailList callbacks"
```

---

### Task 5: 手动验证

- [ ] **Step 1: 启动开发服务器**

```bash
cd mail-vue && npm run dev
```

- [ ] **Step 2: 验证场景 — 快速切换邮箱**

1. 打开浏览器 DevTools → Network 面板
2. 快速连续点击 3 个不同邮箱
3. 预期：Network 面板中旧请求显示 `(canceled)` 状态，最终列表显示最后选中邮箱的邮件
4. 预期：不弹任何错误提示

- [ ] **Step 3: 验证场景 — 正常使用**

1. 正常点击一个邮箱，等待加载完成
2. 滚动到底部触发加载更多
3. 预期：邮件正常分页加载，无异常

- [ ] **Step 4: 验证场景 — 已发送 / 收藏 / 全部邮件**

1. 切换到已发送页面，快速切换邮箱
2. 切换到收藏页面，正常使用
3. 切换到全部邮件页面，正常使用
4. 预期：所有页面的邮件列表行为正常
