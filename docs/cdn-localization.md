# CDN 依赖本地化说明（子项目①）

- 日期：2026-08-15
- 分支：`feat/email-cdn-cache`
- 关联设计：`docs/superpowers/specs/2026-08-03-email-cdn-cache-design.md`（子项目② 缓存策略）
- EdgeOne 规则：`docs/edgeone/rule-mail.json`（v2）
- 部署清单：`docs/edgeone/deploy-checklist.md`

## 目标

前端运行时**零外部 CDN 请求**，解决国内访问国外 CDN（googleapis / cdnjs / api.iconify.design）不稳定导致的：首屏字体阻塞、图标消失、表情图裂图。

## 治理前的外部依赖清单与处置

| # | 依赖 | 位置 | 处置 | 状态 |
|---|------|------|------|------|
| 1 | Google Fonts (Inter 400/600) | `index.html` | 本地化：woff2 下载到 `public/fonts/`，`@font-face` 自托管 | ✅ 已完成 |
| 2 | iconify 图标 22 个未注册 | 各视图/组件 | `npm pack @iconify-json/*` 提取 SVG，追加注册到 `src/icons/index.js` | ✅ 已完成 |
| 3 | `eosicons:` 前缀拼写错误 | `layout/aside/index.vue:69` | 修正为注册过的 `eos-icons:` 前缀（此图标此前一直显示不出来） | ✅ 已完成 |
| 4 | TinyMCE twemoji (cdnjs) | emoticons 插件默认值 | **验证为误报**：默认数据库 `emojis` 插入的是 unicode 字符，不请求图片 CDN。已在两处 `tinymce.init` 显式锁定 `emoticons_database: 'emojis'` 防止未来误开图片版 | ✅ 已锁定 |
| 5 | Cloudflare Turnstile | `index.html` | **刻意保留**：CF 自家服务 + 后端 siteverify 校验强耦合，属业务功能而非静态资源 | ⏸️ 保留 |

## 各项细节

### 1. Inter 字体

- 文件：`mail-vue/public/fonts/inter-latin-400-normal.woff2`（23KB）、`inter-latin-600-normal.woff2`（24KB）、`inter.css`
- 来源：npm 包 `@fontsource/inter@5.3.0`（latin 子集，与原 Google Fonts 请求的字重一致）
- `index.html` 的 `<link href="https://fonts.googleapis.com/...">` 已替换为 `<link href="/fonts/inter.css">`
- 字体用途：`shadow-html` 组件的邮件正文渲染 font-family 链（`-apple-system, Inter, ...`）
- 缓存：跟随 `public/_headers` 的通用策略；如需长缓存可在 `_headers` 加 `/fonts/*` 段

### 2. iconify 图标本地注册

- 背景：`@iconify/vue` 的 `<Icon icon="prefix:name">` 若未本地注册，运行时会回退请求 `api.iconify.design`（国内不稳，图标随机消失）
- 修复：22 个缺失图标的 SVG path 数据从 npm `@iconify-json/{ep,fluent,iconoir,ion,material-symbols-light,material-symbols,mdi}` 包提取，以 `addCollection` 形式追加到 `mail-vue/src/icons/index.js`（文件末尾"CDN 依赖治理补充"注释块）
- 现状：98 处图标引用 100% 本地注册，构建期打进 bundle，零在线请求
- **新增图标时务必同步注册**（跑 `pnpm check:cdn` 会拦截未注册引用）

### 3. TinyMCE 表情（twemoji 误报说明）

复查 emoticons 插件源码确认：`char` 转换函数仅在图片版数据库（`<img` 形式的 char，即 `emojiimages.min.js`）下才拼接 `emoticons_images_url`（默认指向 cdnjs 的 twemoji）；项目默认加载 `emojis.min.js`（unicode 字符版），**实际不请求 twemoji CDN**。防御性配置 `emoticons_database: 'emojis'` 已加到：
- `src/components/tiny-editor/index.vue`
- `src/components/signature-manager/index.vue`

若未来确实需要图片版表情：下载 twemoji 72x72 到 `public/twemoji/72x72/`，配置 `emoticons_database: 'emojiimages'` + `emoticons_images_url: '/twemoji/72x72/'`。

## 防回归检查

```bash
cd mail-vue && pnpm check:cdn
# 或 node scripts/check-cdn-localization.cjs
```

检查项（任一失败退出码非 0）：
1. `index.html` + `src/` 无外部 CDN 引用（白名单仅 `challenges.cloudflare.com`；注释中的说明文字会剥离）
2. iconify 图标引用 100% 本地注册
3. Inter 字体文件与 `@font-face` 就位
4. 两处编辑器已锁定 unicode 表情数据库

建议：发版 / CI 前运行；发现新图标缺失时按第 2 节方法补注册。

## 同分支的其他 CDN 相关产出（子项目②，供索引）

- 缓存头中间件：`mail-worker/src/middleware/cache-headers.js`（全局 no-store 双头 + 白名单路由长缓存）
- 列表/正文分离：`/email/list` 不再返回 content；新增 `/email/content/:emailId`（7 天边缘缓存）
- 附件长缓存：`/oss/*`、`/static/*`、`/attachments/*`（7 天，内容哈希寻址不可变）
- EdgeOne 规则 v2：**路径必须带 `/api` 前缀**（axios `baseURL='/api'`，Worker 内部才剥前缀；CDN 层看到的是原始路径）——这是 v1 规则的错误，已在 v2 修正
