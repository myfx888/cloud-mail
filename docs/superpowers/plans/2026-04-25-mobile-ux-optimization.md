# 移动端体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化移动端体验 — 添加底部导航栏、顶部账户切换器、写邮件底部布局折行

**Architecture:** 新建 `mobile-nav` 组件作为底部导航栏，修改 `header` 组件添加移动端账户切换器（hamburger 旁边），修改 `write` 组件的底部布局在移动端折行。通过 `window.innerWidth < 767` 判断移动端，与现有代码断点一致。

**Tech Stack:** Vue 3 + Element Plus + Iconify + Pinia + vue-router

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `mail-vue/src/components/mobile-nav/index.vue` | 新建 | 移动端底部导航栏组件 |
| `mail-vue/src/layout/index.vue` | 修改 | 引入 mobile-nav，调整移动端内容区域 padding |
| `mail-vue/src/layout/header/index.vue` | 修改 | 移动端添加账户切换器 |
| `mail-vue/src/store/account.js` | 修改 | 新增 accounts 数组缓存 |
| `mail-vue/src/layout/write/index.vue` | 修改 | 底部区域移动端折行 |
| `mail-vue/src/i18n/zh.js` | 修改 | 新增 i18n key |
| `mail-vue/src/i18n/en.js` | 修改 | 新增 i18n key |

---

### Task 1: 新增 i18n keys

**Files:**
- Modify: `mail-vue/src/i18n/zh.js:2-6`
- Modify: `mail-vue/src/i18n/en.js:2-6`

- [ ] **Step 1: 添加中文 i18n key**

在 `mail-vue/src/i18n/zh.js` 的现有 key 中，找到 `SystemSettings` 行之后添加：

```javascript
    compose: '写邮件',
    switchAccount: '切换账户',
```

- [ ] **Step 2: 添加英文 i18n key**

在 `mail-vue/src/i18n/en.js` 的对应位置添加：

```javascript
    compose: 'Compose',
    switchAccount: 'Switch Account',
```

- [ ] **Step 3: Commit**

```bash
git add mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat: add mobile nav i18n keys"
```

---

### Task 2: 更新 account store — 添加 accounts 缓存

**Files:**
- Modify: `mail-vue/src/store/account.js`

- [ ] **Step 1: 在 state 中新增 accounts 数组**

修改 `mail-vue/src/store/account.js`，在 state 中添加 `accounts` 和 `accountsLoaded`，并新增 `setAccounts` action：

```javascript
import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        accountListUpdated: 0,
        accounts: [],
        accountsLoaded: false
    }),
    actions: {
        triggerRefresh() {
            this.accountListUpdated++
        },
        setAccounts(list) {
            this.accounts = list
            this.accountsLoaded = true
        }
    }
})
```

这个替换整个文件内容。`accounts` 用于缓存账户列表供 Header 的下拉切换器使用，`accountsLoaded` 标记是否已加载避免重复请求。

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/store/account.js
git commit -m "feat: add accounts cache to account store"
```

---

### Task 3: 创建底部导航栏组件

**Files:**
- Create: `mail-vue/src/components/mobile-nav/index.vue`

- [ ] **Step 1: 创建 mobile-nav 组件**

创建 `mail-vue/src/components/mobile-nav/index.vue`：

```vue
<template>
  <div class="mobile-nav" v-if="isMobile">
    <div class="nav-item" :class="{ active: route.meta.name === 'email' }" @click="navigate('email')">
      <Icon icon="hugeicons:mailbox-01" width="22" height="22" />
      <span>{{ $t('inbox') }}</span>
    </div>
    <div class="nav-item" :class="{ active: route.meta.name === 'send' }" @click="navigate('send')" v-perm="'email:send'">
      <Icon icon="cil:send" width="20" height="20" />
      <span>{{ $t('sent') }}</span>
    </div>
    <div class="nav-item compose-item" @click="openCompose" v-perm="'email:send'">
      <div class="compose-btn">
        <Icon icon="material-symbols:edit-outline-sharp" width="22" height="22" />
      </div>
      <span>{{ $t('compose') }}</span>
    </div>
    <div class="nav-item" :class="{ active: route.meta.name === 'setting' }" @click="navigate('setting')">
      <Icon icon="fluent:settings-48-regular" width="22" height="22" />
      <span>{{ $t('settings') }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import router from '@/router/index.js'
import { useUiStore } from '@/store/ui.js'

const route = useRoute()
const uiStore = useUiStore()
const isMobile = ref(window.innerWidth < 767)

const handleResize = () => {
  isMobile.value = window.innerWidth < 767
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})

function navigate(name) {
  router.push({ name })
}

function openCompose() {
  uiStore.writerRef.open()
}
</script>

<style scoped lang="scss">
.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  display: flex;
  justify-content: space-around;
  align-items: center;
  z-index: 200;

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex: 1;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    padding: 4px 0;
    user-select: none;
    -webkit-tap-highlight-color: transparent;

    &.active {
      color: var(--el-color-primary);
    }
  }

  .compose-item {
    .compose-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1890ff, #3a80dd);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: -16px;
      box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
    }
  }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/components/mobile-nav/index.vue
git commit -m "feat: create mobile bottom navigation component"
```

---

### Task 4: 集成底部导航栏到主布局

**Files:**
- Modify: `mail-vue/src/layout/index.vue`

- [ ] **Step 1: 引入 mobile-nav 并添加内容区域 padding**

在 `mail-vue/src/layout/index.vue` 中做以下修改：

**a) 在 template 中 `<writer>` 之后添加 `<MobileNav />`：**

找到：
```html
  <writer ref="writerRef" />
</template>
```

替换为：
```html
  <writer ref="writerRef" />
  <MobileNav />
</template>
```

**b) 在 script 的 import 区域添加：**

找到：
```javascript
import writer from '@/layout/write/index.vue'
```

在其后添加：
```javascript
import MobileNav from '@/components/mobile-nav/index.vue'
```

**c) 在 style 中给 `.main-container` 添加移动端底部 padding：**

找到：
```scss
.main-container {
  min-height: 100%;
  background: var(--el-bg-color);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

替换为：
```scss
.main-container {
  min-height: 100%;
  background: var(--el-bg-color);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  @media (max-width: 767px) {
    padding-bottom: calc(56px + env(safe-area-inset-bottom));
  }
}
```

- [ ] **Step 2: 隐藏移动端 Header 中的写邮件按钮**

在 `mail-vue/src/layout/header/index.vue` 的 `.writer-box` 样式中添加移动端隐藏：

找到：
```scss
.writer-box {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
```

替换为：
```scss
.writer-box {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
  @media (max-width: 767px) {
    display: none;
  }
```

- [ ] **Step 3: Commit**

```bash
git add mail-vue/src/layout/index.vue mail-vue/src/layout/header/index.vue
git commit -m "feat: integrate mobile bottom nav into layout"
```

---

### Task 5: 移动端 Header 添加账户切换器

**Files:**
- Modify: `mail-vue/src/layout/header/index.vue`

- [ ] **Step 1: 添加 import 和数据**

在 `mail-vue/src/layout/header/index.vue` 的 `<script setup>` 中添加所需 import 和响应式数据。

找到：
```javascript
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";
import {setExtend} from "@/utils/day.js"
```

替换为：
```javascript
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";
import {setExtend} from "@/utils/day.js"
import {useAccountStore} from "@/store/account.js"
import {accountList} from "@/request/account.js"
```

在 `const uiStore = useUiStore();` 行之后添加：

找到：
```javascript
const uiStore = useUiStore();
const logoutLoading = ref(false)
```

替换为：
```javascript
const uiStore = useUiStore();
const accountStore = useAccountStore();
const isMobile = ref(window.innerWidth < 767)
const logoutLoading = ref(false)
```

在 `function formatName` 之后添加 resize 监听和账户加载函数：

找到：
```javascript
function formatName(email) {
  return email[0]?.toUpperCase() || ''
}
```

替换为：
```javascript
function formatName(email) {
  return email[0]?.toUpperCase() || ''
}

const handleMobileResize = () => {
  isMobile.value = window.innerWidth < 767
}

onMounted(() => {
  window.addEventListener('resize', handleMobileResize)
  loadAccountsForSwitcher()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleMobileResize)
})

async function loadAccountsForSwitcher() {
  if (accountStore.accountsLoaded || !hasPerm('account:query')) return
  try {
    const list = await accountList(0, 100, null)
    accountStore.setAccounts(list)
  } catch (e) {
    console.error('加载账户列表失败:', e)
  }
}

function switchAccount(account) {
  accountStore.currentAccountId = account.accountId
  accountStore.currentAccount = account
}

function truncateEmail(email) {
  if (!email) return ''
  return email.length > 20 ? email.substring(0, 20) + '...' : email
}
```

需要同时在 import 区域添加 `onMounted` 和 `onBeforeUnmount`：

找到：
```javascript
import {computed, ref} from "vue";
```

替换为：
```javascript
import {computed, ref, onMounted, onBeforeUnmount} from "vue";
```

- [ ] **Step 2: 添加账户切换器 template**

在 Header template 中，找到 `<div class="header-btn">` 区域，在 breadcrumb 之后、`.writer-box` 之前添加账户切换器。

找到：
```html
    <div class="header-btn">
      <hanburger @click="changeAside"></hanburger>
      <span class="breadcrumb-item">{{ $t(route.meta.title) }}</span>
    </div>
```

替换为：
```html
    <div class="header-btn">
      <hanburger @click="changeAside"></hanburger>
      <span class="breadcrumb-item" v-if="!isMobile">{{ $t(route.meta.title) }}</span>
      <el-dropdown v-if="isMobile && hasPerm('account:query')" class="account-switcher" trigger="click" max-height="300px">
        <div class="account-switcher-trigger">
          <span class="current-account-name">{{ truncateEmail(accountStore.currentAccount?.email) }}</span>
          <Icon icon="mingcute:down-small-fill" width="16" height="16" />
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-for="account in accountStore.accounts"
              :key="account.accountId"
              :class="{ 'active-account': account.accountId === accountStore.currentAccountId }"
              @click="switchAccount(account)"
            >
              {{ account.email }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
```

- [ ] **Step 3: 添加账户切换器样式**

在 `<style lang="scss" scoped>` 中，`.header-btn` 样式块之后添加：

找到：
```scss
.breadcrumb-item {
  font-weight: bold;
  font-size: 14px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

在其后添加：
```scss

.account-switcher {
  margin-left: 4px;
  max-width: 160px;

  .account-switcher-trigger {
    display: flex;
    align-items: center;
    cursor: pointer;
    gap: 2px;
    padding: 4px 6px;
    border-radius: 6px;
    &:hover {
      background: var(--base-fill);
    }
  }

  .current-account-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
  }
}

:deep(.active-account) {
  background: var(--el-color-primary-light-9) !important;
  color: var(--el-color-primary) !important;
  font-weight: bold;
}
```

- [ ] **Step 4: Commit**

```bash
git add mail-vue/src/layout/header/index.vue
git commit -m "feat: add mobile account switcher to header"
```

---

### Task 6: 写邮件底部移动端折行布局

**Files:**
- Modify: `mail-vue/src/layout/write/index.vue`

- [ ] **Step 1: 调整 send-actions 的 HTML 结构**

当前 `.button-item` 内的结构为 `grid-template-columns: auto auto 1fr auto`，附件按钮、清除按钮、附件列表、send-actions 并排。需要在移动端让 send-actions 独占一行。

在 `mail-vue/src/layout/write/index.vue` 的 style 中，找到 `.button-item` 的样式：

```scss
      .button-item {
        display: grid;
        grid-template-columns: auto auto 1fr auto;

        .send-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
```

替换为：

```scss
      .button-item {
        display: grid;
        grid-template-columns: auto auto 1fr auto;

        @media (max-width: 767px) {
          grid-template-columns: auto auto 1fr;
          grid-template-rows: auto auto;

          .send-actions {
            grid-column: 1 / -1;
            grid-row: 1;
            justify-content: flex-start;
            flex-wrap: wrap;
            margin-bottom: 6px;
          }
        }

        .send-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
```

- [ ] **Step 2: 调整签名和 SMTP 选择器的移动端宽度**

找到：

```scss
        .signature-select {
          min-width: 140px;
        }

        .smtp-account-select {
          min-width: 170px;
        }
```

替换为：

```scss
        .signature-select {
          min-width: 140px;
          @media (max-width: 767px) {
            min-width: 110px;
          }
        }

        .smtp-account-select {
          min-width: 170px;
          @media (max-width: 767px) {
            min-width: 130px;
          }
        }
```

- [ ] **Step 3: Commit**

```bash
git add mail-vue/src/layout/write/index.vue
git commit -m "feat: mobile responsive layout for compose bottom bar"
```

---

### Task 7: 调整 account 面板移动端高度

**Files:**
- Modify: `mail-vue/src/layout/account/index.vue`

- [ ] **Step 1: 更新 scrollbar 移动端高度**

`account/index.vue` 中 `.scrollbar` 有 `@media (max-width: 767px) { height: calc(100% - 98px) }`。这个 98px 需要加上底部导航栏的高度（56px）。

找到：

```scss
    .scrollbar {
    width: 100%;
    height: calc(100% - 38px);
    overflow: auto;
    @media (max-width: 767px) {
      height: calc(100% - 98px);
    }
```

替换为：

```scss
    .scrollbar {
    width: 100%;
    height: calc(100% - 38px);
    overflow: auto;
    @media (max-width: 767px) {
      height: calc(100% - 154px);
    }
```

说明：原 98px + 56px (底部导航) = 154px。

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/layout/account/index.vue
git commit -m "fix: adjust account panel height for mobile bottom nav"
```

---

### Task 8: 同步 account store 数据

**Files:**
- Modify: `mail-vue/src/layout/account/index.vue`

- [ ] **Step 1: 在 account 列表加载后同步到 store**

`layout/account/index.vue` 已经通过 `getAccountList()` 获取账户列表并放入 `accounts` reactive 数组。需要在加载完成后同步到 `accountStore.accounts`，这样 Header 的下拉切换器可以使用。

在 `layout/account/index.vue` 的 `<script setup>` 中，找到 `import` 区域，确认已有 `useAccountStore`：

```javascript
import {useAccountStore} from "@/store/account.js";
```

已存在，无需添加。

然后找到 `getAccountList()` 函数中 `accounts.push(...list)` 这一行，在其后添加同步逻辑：

找到：
```javascript
    accounts.push(...list)

    loading.value = false
    followLoading.value = false
    first = false
```

替换为：
```javascript
    accounts.push(...list)
    accountStore.setAccounts([...accounts])

    loading.value = false
    followLoading.value = false
    first = false
```

同样，在 `refresh()` 函数中 `accounts.splice(0, accounts.length)` 之后需要清空 store 的缓存：

找到：
```javascript
  scrollbarRef.value.setScrollTop(0)
  accounts.splice(0, accounts.length)
  getAccountList()
```

替换为：
```javascript
  scrollbarRef.value.setScrollTop(0)
  accounts.splice(0, accounts.length)
  accountStore.accountsLoaded = false
  getAccountList()
```

- [ ] **Step 2: Commit**

```bash
git add mail-vue/src/layout/account/index.vue
git commit -m "feat: sync account list to store for header switcher"
```

---

### Task 9: 最终验证和提交

- [ ] **Step 1: 运行前端开发服务器验证**

```bash
cd mail-vue
npm run dev
```

打开浏览器，使用 DevTools 切换到移动端模拟（iPhone SE 或 375px 宽度），验证：

1. 底部导航栏显示 4 项（收件箱、已发送、写邮件、设置）
2. 点击各导航项可以正确跳转
3. 写邮件按钮可以打开写邮件面板
4. Header 左侧显示 hamburger + 当前账户邮箱名
5. 点击账户名可以下拉切换账户
6. 写邮件底部区域折行显示正常
7. 切换到桌面端宽度（>767px）时底部导航隐藏、账户切换器隐藏

- [ ] **Step 2: 验证桌面端无回归**

切换到桌面端宽度（>1025px），验证：

1. 侧边栏正常展开/折叠
2. Header 的 hamburger 正常工作
3. 写邮件页面底部单行布局正常
4. 账户列表面板正常显示

- [ ] **Step 3: 最终提交并推送**

```bash
git push origin main
```
