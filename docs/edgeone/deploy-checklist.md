# 邮件 CDN 缓存改造 — 部署验证清单

> 改造分支：`feat/email-cdn-cache`
> 设计文档：`docs/superpowers/specs/2026-08-03-email-cdn-cache-design.md`
> EdgeOne 规则：`docs/edgeone/rule-mail.json`

## 部署前准备

- [ ] 确认 `feat/email-cdn-cache` 分支代码已 review
- [ ] `docs/edgeone/rule-mail.json` 中 `mail.example.com` 已替换为真实线上访问域名
- [ ] 前端构建已验证（`cd mail-vue && npx vite build --mode release` 通过）

## 部署（前后端一起发，避免窗口期）

- [ ] `cd mail-worker && wrangler deploy`（会自动触发前端 build 并一起部署）
- [ ] 部署成功，无报错

## EdgeOne 规则导入

- [ ] 登录 EdgeOne 控制台
- [ ] 站点 → 规则引擎 → 导入 `docs/edgeone/rule-mail.json`
- [ ] 规则状态为"已生效"

## 本地 curl 验证（部署前在 dev 环境验证，或部署后在线上验证）

> 需要有效的 JWT token。登录系统后从浏览器 Network 面板复制 `token` 请求头。

### 1. 列表接口：no-store + 不含 content

```bash
curl -i "http://localhost:8787/api/email/list?accountId=1&size=5&type=0" -H "token: <JWT>"
```
- [ ] 响应头含 `Cache-Control: no-store, no-cache, must-revalidate`
- [ ] 响应头含 `cdn-cache-control: no-store`
- [ ] 响应体 `data.list[0]` **不含** `content` 字段
- [ ] 响应体 `data.list[0]` **仍含** `text`、`subject`、`unread`、`isStar`、`emailId`

### 2. 正文接口：长缓存

```bash
curl -i "http://localhost:8787/api/email/content/1" -H "token: <JWT>"
```
- [ ] 200，响应头含 `Cache-Control: public, max-age=604800, immutable`
- [ ] 响应头含 `cdn-cache-control: public, max-age=604800`
- [ ] 响应体含 `content` 和 `text`

### 3. 不存在/无权 emailId：404 且不缓存

```bash
curl -i "http://localhost:8787/api/email/content/999999999" -H "token: <JWT>"
```
- [ ] 404，响应头含 `Cache-Control: no-store`
- [ ] 响应头含 `cdn-cache-control: no-store`

### 4. allEmail 列表：同样 no-store

```bash
curl -i "http://localhost:8787/api/allEmail/list?size=5" -H "token: <JWT>"
```
- [ ] 响应头含 `cdn-cache-control: no-store`
- [ ] 响应体列表项不含 `content`

## 线上 EdgeOne 缓存验证（curl -I 看缓存命中）

- [ ] `curl -I https://<域名>/api/email/list -H "token: <JWT>"` → `EO-Cache-Status: MISS`（每次回源）
- [ ] 首次 `curl -I https://<域名>/api/email/content/1 -H "token: <JWT>"` → `EO-Cache-Status: MISS`
- [ ] 二次 `curl -I https://<域名>/api/email/content/1 -H "token: <JWT>"` → `EO-Cache-Status: HIT`（边缘命中）

## 功能验证（浏览器）

- [ ] 打开邮件列表，列表正常加载（subject/发件人/时间/未读/星标/摘要预览显示正常）
- [ ] 列表加载速度明显变快（响应体从 MB 级降到 KB 级）
- [ ] 列表项的摘要预览（formatText）正常显示（纯文本邮件摘要）
- [ ] 点开一封邮件，正文正常显示（首次有轻微加载，第二次打开秒开）
- [ ] 正文中含图片的邮件，图片正常显示
- [ ] 标记已读后刷新列表，未读状态实时变化
- [ ] 删除一封邮件，列表立即移除（无 CDN 延迟）
- [ ] 收到新邮件，列表轮询能拉到新邮件
- [ ] 附件下载/预览正常
- [ ] 已发送邮件详情查看正常
- [ ] 草稿功能不受影响

## 回滚方案（如出现问题）

```bash
# 回到 main 分支重新部署
cd mail-worker && git checkout main && wrangler deploy
# EdgeOne 规则删除新增的 mail 规则
```
