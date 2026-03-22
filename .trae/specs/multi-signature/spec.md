# 多邮件签名功能规范

## 1. 功能概述

本功能旨在为用户提供多邮件签名管理能力，允许每个邮件账户设置多个签名，并在发送邮件时选择使用哪个签名。

## 2. 技术需求

### 2.1 后端需求（Cloudflare Worker）

1. **数据结构变更**：
   - 修改账户实体，将单个 `signature` 字段改为 `signatures` 字段，使用 JSON 格式存储多个签名
   - 每个签名包含：id、name、content、isDefault 等属性
   - 符合 Cloudflare D1 数据库规范

2. **API 接口**：
   - 使用 Hono 框架实现签名管理接口：添加、编辑、删除、获取签名
   - 账户配置接口：更新以支持多签名
   - 符合 Cloudflare Worker 路由规范

3. **数据库迁移**：
   - 更新 `mail-worker/src/init/init.js`，添加 D1 数据库迁移逻辑
   - 确保现有数据的平滑迁移
   - 符合 Cloudflare D1 迁移规范

### 2.2 前端需求

1. **账户设置界面**：
   - 在 SMTP 配置对话框中添加多签名管理功能
   - 支持签名的添加、编辑、删除、设置默认
   - 符合 Vue 3 组件规范

2. **邮件编辑界面**：
   - 添加签名选择器，允许用户选择要使用的签名
   - 支持签名的实时预览
   - 符合 Vue 3 组件规范

3. **API 调用**：
   - 更新前端 API 调用，支持多签名操作
   - 符合 Cloudflare Worker API 调用规范

## 3. 数据结构

### 3.1 签名结构

```json
{
  "id": "string", // 签名唯一标识
  "name": "string", // 签名名称
  "content": "string", // 签名内容（HTML格式）
  "isDefault": "boolean" // 是否为默认签名
}
```

### 3.2 账户实体变更

- 将 `signature` 字段改为 `signatures` 字段
- `signatures` 字段类型为 JSON，存储签名数组
- 符合 Cloudflare D1 数据库类型规范

## 4. API 接口规范

### 4.1 获取签名列表

- **接口**：GET /api/account/{accountId}/signatures
- **响应**：
  ```json
  {
    "code": 200,
    "data": [
      {
        "id": "sig1",
        "name": "工作签名",
        "content": "<p>Best regards,<br>John Doe</p>",
        "isDefault": true
      }
    ]
  }
  ```

### 4.2 添加签名

- **接口**：POST /api/account/{accountId}/signatures
- **请求体**：
  ```json
  {
    "name": "新签名",
    "content": "<p>Regards,<br>John</p>",
    "isDefault": false
  }
  ```

### 4.3 编辑签名

- **接口**：PUT /api/account/{accountId}/signatures/{signatureId}
- **请求体**：
  ```json
  {
    "name": "更新的签名",
    "content": "<p>Best regards,<br>John Doe</p>",
    "isDefault": true
  }
  ```

### 4.4 删除签名

- **接口**：DELETE /api/account/{accountId}/signatures/{signatureId}

## 5. 界面设计

### 5.1 账户设置界面

- 在 SMTP 配置对话框中添加签名管理区域
- 显示签名列表，支持添加、编辑、删除操作
- 支持设置默认签名
- 响应式设计，适配不同屏幕尺寸

### 5.2 邮件编辑界面

- 在邮件编辑界面顶部添加签名选择器
- 下拉菜单显示所有可用签名
- 支持实时预览所选签名
- 响应式设计，适配不同屏幕尺寸

## 6. 实现步骤

1. 修改后端账户实体，添加多签名支持（符合 Cloudflare D1 规范）
2. 更新数据库初始化文件，添加 D1 数据库迁移逻辑
3. 使用 Hono 框架实现后端 API 接口（符合 Cloudflare Worker 规范）
4. 更新服务层逻辑，处理多签名业务逻辑
5. 修改前端 API 调用，支持多签名操作
6. 修改前端账户设置界面，添加多签名管理功能
7. 修改前端邮件编辑界面，添加签名选择功能
8. 测试功能完整性（符合 Cloudflare Worker 环境）
9. 优化用户体验

## 7. 测试要求

- 功能测试：验证所有签名管理操作在 Cloudflare Worker 环境中正常工作
- 兼容性测试：确保与现有功能兼容，在不同浏览器中正常工作
- 用户体验测试：验证界面操作流畅性，响应速度符合 Cloudflare Worker 限制
- 数据迁移测试：确保现有数据正确迁移到新结构
- 性能测试：确保在 Cloudflare Worker 30 秒请求限制内完成所有操作