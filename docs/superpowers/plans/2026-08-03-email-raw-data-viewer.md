# 邮件原始数据查看器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在邮件查看页顶部工具栏增加"原始数据"按钮，点击弹出对话框展示邮件全部结构化字段与正文源码。

**Architecture:** 纯前端改动。复用 `emailStore.contentData.email`（列表传来的完整 email 对象）和 `emailBody`（按需加载的正文），拼合展示。新增一个 `el-dialog` + 两个 `el-tabs`（元数据 JSON / 正文源码）+ 复制全部按钮。零后端改动，零新增依赖。

**Tech Stack:** Vue 3 (Composition API, `<script setup>`)、Element Plus（el-dialog / el-tabs / ElMessage）、Iconify (`@iconify/vue`)、vue-i18n。

## Global Constraints

- 仅改前端文件，不碰 `mail-worker/`
- 不新增 npm 依赖（el-dialog / el-tabs / ElMessage 均已在用）
- i18n 必须同时更新 `zh.js` 和 `en.js`
- 遵循现有代码风格：`<script setup>`、SCSS scoped、iconify 图标

---

### Task 1: 新增 i18n 文案

**Files:**
- Modify: `mail-vue/src/i18n/zh.js`
- Modify: `mail-vue/src/i18n/en.js`

**Interfaces:**
- Produces: 6 个新 i18n key（`rawDataTitle` / `rawMetadata` / `rawBodySource` / `copyAll` / `copySuccess` / `copyFailed`），供 Task 2 的模板和脚本引用。

- [ ] **Step 1: 在 zh.js 的 `ops: '操作'` 后追加 5 个 key**

打开 `mail-vue/src/i18n/zh.js`，找到文件末尾对象闭合前的最后一行 `ops: '操作'`，在其后追加（注意逗号）：

```js
    ops: '操作',
    rawDataTitle: '邮件原始数据',
    rawMetadata: '元数据',
    rawBodySource: '正文源码',
    copyAll: '复制全部',
    copySuccess: '已复制到剪贴板',
    copyFailed: '复制失败'
}
```

- [ ] **Step 2: 在 en.js 的 `ops: 'Actions'` 后追加 5 个 key**

打开 `mail-vue/src/i18n/en.js`，同样在 `ops: 'Actions'` 后追加：

```js
    ops: 'Actions',
    rawDataTitle: 'Raw Email Data',
    rawMetadata: 'Metadata',
    rawBodySource: 'Body Source',
    copyAll: 'Copy All',
    copySuccess: 'Copied to clipboard',
    copyFailed: 'Copy failed'
}
```

- [ ] **Step 3: 构建前端验证无语法错误**

Run: `cd mail-vue && pnpm run build`
Expected: `✓ built in X.XXs`，无 error。

- [ ] **Step 4: Commit**

```bash
git add mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat(i18n): add raw email data viewer文案"
```

---

### Task 2: 邮件查看页增加原始数据按钮与对话框

**Files:**
- Modify: `mail-vue/src/views/content/index.vue`

**Interfaces:**
- Consumes: Task 1 的 5 个 i18n key；现有 `emailStore.contentData.email`（email 对象）、`emailBody` ref（{content, text}）、`bodyLoading` ref。
- Produces: 原始数据查看功能（按钮 + 对话框）。

- [ ] **Step 1: 在模板顶部工具栏加按钮**

在 `mail-vue/src/views/content/index.vue` 的 `<template>` 中，找到"下载"按钮这一行（约第 12 行）：

```html
<Icon class="icon" @click="exportEmail" icon="material-symbols-light:download" width="20" height="20" />
```

在其后、AI 分组 `<template v-if="settingStore.settings.aiEnabled">`（第 13 行）之前，插入原始数据按钮：

```html
      <Icon class="icon" @click="exportEmail" icon="material-symbols-light:download" width="20" height="20" />
      <Icon class="icon" @click="showRawDialog = true" icon="mdi:code-tags" width="20" height="20" :title="$t('rawDataTitle')" />
      <template v-if="settingStore.settings.aiEnabled">
```

- [ ] **Step 2: 在模板底部 el-image-viewer 之后加 el-dialog**

找到 `</el-image-viewer>` 闭合标签（约第 98 行）及其后的 `</div>`（`.box` 闭合）。在 `</el-image-viewer>` 之后、`.box` 的 `</div>` 之前，插入对话框：

```html
    <el-image-viewer
        v-if="showPreview"
        :url-list="srcList"
        show-progress
        @close="showPreview = false"
    />
    <el-dialog v-model="showRawDialog" :title="$t('rawDataTitle')" width="min(800px, 90vw)" class="raw-dialog">
      <div class="raw-toolbar">
        <el-button size="small" @click="copyRawAll">{{ $t('copyAll') }}</el-button>
      </div>
      <el-tabs>
        <el-tab-pane :label="$t('rawMetadata')">
          <pre class="raw-pre">{{ JSON.stringify(email, null, 2) }}</pre>
        </el-tab-pane>
        <el-tab-pane :label="$t('rawBodySource')">
          <div v-if="bodyLoading" class="no-content">{{ $t('loading') }}</div>
          <pre v-else class="raw-pre">{{ emailBody.content }}</pre>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>
```

- [ ] **Step 3: 在 `<script setup>` 加状态与函数**

在 `<script setup>` 中，找到 `const attList = computed(...)` 一行（约第 130 行）之后，加入 `showRawDialog` 状态：

```js
const attList = computed(() => email.attList || [])
const showRawDialog = ref(false)
```

然后在 `exportEmail` 函数（约第 306 行）之后，加入 `copyRawAll` 函数：

```js
const exportEmail = () => {
  window.location.href = `/api/email/export?emailId=${email.emailId}`
}

async function copyRawAll() {
  const payload = JSON.stringify({ metadata: email, body: emailBody.value }, null, 2)
  try {
    await navigator.clipboard.writeText(payload)
    ElMessage.success(t('copySuccess'))
  } catch (e) {
    ElMessage.error(t('copyFailed'))
  }
}
```

注意：`ref`、`ElMessage`、`t` 都已在文件顶部 import（`ref` 来自 vue 第 103 行，`ElMessage` 第 105 行，`t` 第 158 行 `useI18n`），无需新增 import。

- [ ] **Step 4: 加样式**

在 `<style scoped lang="scss">` 块末尾的 `@keyframes spin { ... }` 之后、`</style>` 之前，追加对话框与 pre 的样式：

```scss
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

:deep(.raw-dialog) {
  .raw-toolbar {
    margin-bottom: 12px;
  }
  .raw-pre {
    background: var(--el-fill-color-dark);
    color: var(--el-color-success);
    padding: 12px;
    border-radius: 6px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    line-height: 1.5;
    max-height: 60vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
}
```

- [ ] **Step 5: 构建前端验证**

Run: `cd mail-vue && pnpm run build`
Expected: `✓ built in X.XXs`，无 error。

- [ ] **Step 6: Commit**

```bash
git add mail-vue/src/views/content/index.vue
git commit -m "feat(email): 邮件查看页增加原始数据按钮与对话框"
```

---

### Task 3: 部署与验证

**Files:** 无代码改动，部署现有改动。

- [ ] **Step 1: 部署到生产**

Run: `cd mail-worker && node_modules/.bin/wrangler deploy`
Expected: `Deployed cloudmail triggers` + 新 Version ID（`[build]` 会自动重新打包前端）。

- [ ] **Step 2: 人工验证**

强制刷新前端（Ctrl+Shift+R），打开一封邮件：
1. 顶部工具栏"下载"图标后出现新图标（`mdi:code-tags`）
2. 点击 → 弹出"邮件原始数据"对话框
3. "元数据" tab 显示 email 对象的格式化 JSON（含 sendEmail/recipient/messageId/status 等）
4. "正文源码" tab 显示 HTML 原文
5. 点"复制全部"→ 提示"已复制到剪贴板"，粘贴验证内容完整
6. 关闭对话框回到正常视图

- [ ] **Step 3: 推送到 GitHub**

```bash
git push origin feat/email-cdn-cache
```
