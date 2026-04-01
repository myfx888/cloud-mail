## 为什么

当前应用已内置中英文 i18n 支持，header 组件中也已存在 `changeLang()` 函数，但没有对应的 UI 入口。用户只能通过浏览器语言或初始化逻辑自动选择语言，无法手动切换。需要在右上角工具栏（主题切换按钮左侧）添加一个语言切换按钮，让用户可以随时在中文和英文之间切换。

## 变更内容

- 在 `layout/header/index.vue` 的 `.toolbar` 区域，主题切换图标（太阳/月亮）左侧，新增一个语言切换按钮
- 按钮显示当前语言标识（如 "中" / "EN"），点击后切换到另一种语言
- 复用已有的 `changeLang()` 函数和 `settingStore.lang` 状态
- 样式与现有 `.icon-item` 保持一致

## 功能 (Capabilities)

### 新增功能
- `locale-switcher`: 右上角工具栏中的中英文切换按钮，点击即可在中/英之间切换

### 修改功能

## 影响

- `mail-vue/src/layout/header/index.vue` — 模板和样式新增语言切换按钮
- 无后端变更、无 API 变更、无依赖变更
