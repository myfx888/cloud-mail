## 1. 元信息英文化能力准备

- [x] 1.1 在 `mail-vue/src/utils/day.js` 增加回复/转发专用的英文时间格式化方法（不依赖 `settingStore.lang`）
- [x] 1.2 为回复与转发主题前缀整理统一的去重/标准化工具（兼容 `Re:`/`回复:` 与 `Fwd:`/`Fw:`/`转发:`）

## 2. 回复模板改造

- [x] 2.1 修改 `mail-vue/src/layout/write/index.vue` 的 `openReply`，将引用头中的时间改为英文专用格式化输出
- [x] 2.2 修改 `openReply` 引用头文案为固定英文 `wrote:`，移除该处对 `t('wrote')` 的依赖
- [x] 2.3 验证回复场景下原始正文（HTML/纯文本）渲染路径保持不变

## 3. 转发模板改造

- [x] 3.1 修改 `mail-vue/src/layout/write/index.vue` 的 `openForward`，补充英文标准转发头（`Forwarded message`、`From`、`Date`、`Subject`、`To`）
- [x] 3.2 将 `openForward` 主题前缀统一为英文 `Fwd: `，并应用前缀去重逻辑
- [x] 3.3 验证转发场景下原始正文内容未被翻译或重写

## 4. 回归验证

- [ ] 4.1 在中文界面验证回复和转发模板中的元信息均为英文
- [ ] 4.2 在英文界面验证回复和转发模板输出与中文界面一致（除正文本身）
- [x] 4.3 执行前端构建或关键页面回归，确认改造未影响写信弹窗正常发送流程
