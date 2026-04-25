# 移动端体验优化设计规格

**日期**: 2026-04-25
**范围**: 移动端收件箱切换 + 导航优化 + 写邮件底部布局优化
**断点**: `< 767px` 为移动端，`≥ 767px` 为桌面端（与现有代码一致）

---

## 1. 移动端底部导航栏

### 1.1 功能描述

在移动端（`< 767px`）底部添加固定导航栏，包含四个入口：

| 位置 | 图标 | 标签 | 路由 |
|------|------|------|------|
| 1 | `hugeicons:mailbox-01` | 收件箱 | `/email` |
| 2 | `cil:send` | 已发送 | `/send` |
| 3 | `material-symbols:edit-outline-sharp` | 写邮件 | 触发 `uiStore.writerRef.open()` |
| 4 | `fluent:settings-48-regular` | 设置 | `/setting` |

### 1.2 视觉规格

- **高度**: 56px（含安全区域 padding）
- **位置**: 固定在视口底部 (`position: fixed; bottom: 0`)
- **z-index**: 200（高于内容和覆盖层）
- **背景**: `var(--el-bg-color)`，顶部 1px border `var(--el-border-color)`
- **写邮件按钮**: 突出显示，使用渐变背景 `linear-gradient(135deg, #1890ff, #3a80dd)`，圆形图标
- **激活状态**: 当前页面对应图标使用 `--el-color-primary` 高亮
- **安全区域**: 底部添加 `env(safe-area-inset-bottom)` padding，适配 iPhone 底部横条

### 1.3 显示条件

- 仅在 `window.innerWidth < 767` 时渲染
- 桌面端不渲染（不是隐藏，是 `v-if` 不渲染）
- 所有已登录页面均显示

### 1.4 对现有布局的影响

- 移动端内容区域底部需要增加 56px + safe-area padding，避免被导航栏遮挡
- `account/index.vue` 的 `.scrollbar` 已有 `@media (max-width: 767px) { height: calc(100% - 98px) }` 需要相应调整
- 移动端顶部 Header 的"写邮件"圆形按钮在移动端隐藏（底部导航已包含）

### 1.5 新建组件

新建 `mail-vue/src/components/mobile-nav/index.vue`：

- 使用 `window.innerWidth` 响应式判断是否渲染
- 监听 `resize` 事件
- 通过 `useRoute()` 判断当前激活项
- 通过 `useUiStore()` 触发写邮件
- 权限检查: 写邮件按钮使用 `v-perm="'email:send'"`

---

## 2. 顶部账户切换器

### 2.1 功能描述

在移动端 Header 左侧替换 hamburger 按钮为账户切换器：

- 显示当前账户邮箱名（截断，最大宽度约 150px）
- 右侧带下拉箭头图标
- 点击弹出下拉列表，展示所有账户

### 2.2 实现方式

修改 `layout/header/index.vue`：

- 添加 `isMobile` 响应式变量（`< 767px`）
- 移动端：在 hamburger 右侧增加 `el-dropdown` 账户切换器，显示当前 `accountStore.currentAccount.email`
- 下拉菜单中列出所有账户，点击触发 `accountStore.currentAccountId = account.accountId`
- 桌面端（`≥ 767px`）：保持现有 hamburger + 侧边栏模式不变，不显示账户切换器

### 2.3 账户数据来源

- 复用 `accountStore` 中的 `currentAccount` 和 `currentAccountId`
- 需要在 Header 组件中获取账户列表数据
- 使用 `accountList` API 获取，缓存在 `accountStore` 中避免重复请求
- 新增 `accountStore.accounts` 数组存储账户列表

### 2.4 视觉规格

- **文字**: 14px，单行截断，最大宽度 150px
- **箭头**: `mingcute:down-small-fill`，16px
- **下拉菜单**: 最大高度 300px，可滚动
- **当前账户**: 在列表中带高亮背景标识

### 2.5 显示条件

- 仅移动端显示账户切换器
- 仅在有 `account:query` 权限时显示
- 桌面端保持 hamburger

---

## 3. 写邮件底部布局优化

### 3.1 功能描述

移动端写邮件页面底部区域从单行改为折行布局：

- **第一行**: 签名选择 + 发送方式切换 + SMTP 账户选择
- **第二行**: 附件按钮 + 清除格式按钮 + 发送按钮（右对齐）

### 3.2 实现方式

修改 `layout/write/index.vue` 的 `.button-item` 样式：

```css
/* 桌面端保持现有 */
.button-item {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
}

/* 移动端折行 */
@media (max-width: 767px) {
  .button-item {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
  }
  
  .send-actions {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    order: 1;
  }
  
  .att-add, .att-clear {
    order: 2;
  }
  
  .att-list {
    width: 100%;
    order: 3;
  }
}
```

### 3.3 发送按钮

- 移动端发送按钮右对齐，保持足够的触控区域（最小高度 36px）
- 签名下拉和发送方式 radio 按钮使用 `size="small"` 保持紧凑

---

## 4. 侧边栏适配

### 4.1 变更

- 移动端（`< 767px`）：
  - Header 左侧布局变为：hamburger（缩小为 20px）+ 账户切换器（邮箱名+下拉箭头）
  - hamburger 保留，点击仍弹出侧边栏（管理员可访问管理功能）
  - 底部导航栏覆盖了普通用户的高频操作（收件箱、已发送、写邮件、设置），减少对侧边栏的依赖

### 4.2 不变

- 桌面端（`≥ 767px`）侧边栏行为完全不变
- 侧边栏的样式、内容、动画不做任何修改

---

## 5. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `mail-vue/src/components/mobile-nav/index.vue` | 新建 | 移动端底部导航栏组件 |
| `mail-vue/src/layout/index.vue` | 修改 | 引入底部导航栏，调整内容区域底部 padding |
| `mail-vue/src/layout/header/index.vue` | 修改 | 移动端 hamburger → 账户切换器 |
| `mail-vue/src/layout/write/index.vue` | 修改 | 底部区域移动端折行布局 |
| `mail-vue/src/store/account.js` | 修改 | 新增 `accounts` 数组缓存账户列表 |
| `mail-vue/src/store/ui.js` | 修改 | 新增 `isMobile` 响应式状态 |
| `mail-vue/src/layout/account/index.vue` | 修改 | 调整移动端高度计算 |
| `mail-vue/src/i18n/zh.js` | 修改 | 新增底部导航 i18n key |
| `mail-vue/src/i18n/en.js` | 修改 | 新增底部导航 i18n key |

---

## 6. 不在范围内

- 邮件阅读页面优化
- 触控手势（滑动删除等）
- PWA 支持
- 桌面端任何变更
