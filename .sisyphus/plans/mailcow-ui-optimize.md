# Mailcow 配置界面优化计划

## 项目概述

将 Mailcow 配置界面（`mail-vue/src/views/sys-setting/index.vue`) 从原始 JSON textarea 输入改造为结构化的表单界面，提升 UX/UX 和安全性。

使用 Element Plus 绡Vue3 + Hono 框术后端 (Cloudflare Workers + D1 + SQLite) 技术栈。

 Elm Plus、 Element Plus Vue。

3. 揯3.2 UI 组件设计约束已有 Vue 组件风格一致)
采用平铺式卡片式布局（card-grid），。

---

## 关键文件清单

| 区域 | 文件 | 说明 |
|------|------|------|
| `mail-vue/src/views/sys-setting/index.vue` | 主设置页面， 魯一个大文件（1700+ 行）， 包含所有设置对话框 |
 Mailcow 配置区域位于 223-224 行， 所有 UI 都硬编码中文 |
 |
| `mail-vue/src/request/setting.js` | API 请求文件（mailcowTestConnection) |
 mailcow 测试连接 API |
| `mail-worker/src/api/setting-api.js` | 后端设置 API |
| `mail-worker/src/service/mailcow-service.js` | Mailcow 服务 |
| `mail-worker/src/service/setting-service.js` | 设置服务（含 mailcow 配置解析/保存) |
| `mail-worker/src/entity/setting.js` | 设置实体 |

| **不涉及后端改动** | 所有后端逻辑保持不变，只修改前端 Vue 组件 |

| `mail-vue/src/views/sys-setting/index.vue` | 2024-03-31 17:00:00