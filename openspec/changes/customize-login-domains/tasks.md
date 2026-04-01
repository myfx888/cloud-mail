## 1. 数据模型与后端配置

- [x] 1.1 在 `setting` 实体与数据库迁移中新增 `login_domains` 字段
- [x] 1.2 在 `settingService.query` 中解析并返回 `loginDomains` 配置
- [x] 1.3 在 `settingService.update` 中保存管理员提交的 `loginDomains` 配置
- [x] 1.4 在 `websiteConfig` 返回 `domainList` 前按 `loginDomains` 做过滤并处理空配置回退

## 2. 后台设置页面

- [x] 2.1 在系统设置页增加“登录页域名后缀显示”多选 UI
- [x] 2.2 绑定设置数据模型并将 `loginDomains` 随保存请求提交后端
- [x] 2.3 增加基本校验与交互提示（如无可选域名、全部未勾选时的说明）

## 3. 前端消费与联动

- [x] 3.1 确保初始化流程将后端过滤后的 `domainList` 写入 `settingStore`
- [x] 3.2 校验登录/注册/绑定等页面的后缀下拉统一使用过滤后的 `domainList`
- [x] 3.3 校验系统内添加邮箱相关入口使用同一后缀来源并保持行为一致

## 4. 验证与回归

- [x] 4.1 验证管理员保存不同后缀组合后登录页展示正确
- [x] 4.2 验证 `loginDomains` 为空时默认展示全部域名
- [x] 4.3 运行构建与关键流程回归，确认不影响既有登录和邮箱添加逻辑
