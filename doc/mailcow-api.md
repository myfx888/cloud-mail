# Mailcow / SMTP 新增接口说明

## 1. Mailcow 连接测试

- 路径: `POST /setting/mailcow/testConnection`
- 请求体:

```json
{
  "serverId": "mailcow-default"
}
```

- 行为:
  - 根据 `serverId` 查找对应 Mailcow 服务器配置
  - 调用 Mailcow `get/status` 接口进行连通性检查
- 返回:

```json
{
  "code": 0,
  "data": {
    "success": true
  }
}
```

## 2. 账户 Mailcow 失败重试

- 路径: `POST /account/:accountId/mailcow/retry`
- 行为:
  - 对指定账户重新执行 Mailcow 开通流程
  - 包含重复账户检测（已存在视为成功）
  - 复用 SMTP 回填逻辑
- 返回示例:

```json
{
  "code": 0,
  "data": {
    "accountId": 1001,
    "mailcowStatus": "success",
    "mailcowAccount": {
      "email": "demo@example.com",
      "smtpHost": "smtp.example.com",
      "smtpPort": 587,
      "smtpUser": "demo@example.com"
    }
  }
}
```

## 3. 账户切换 SMTP 服务器

- 路径: `POST /account/:accountId/smtp/server`
- 请求体:

```json
{
  "smtpServerId": "smtp-main"
}
```

- 行为:
  - 将账户绑定到指定 SMTP 服务器
  - 立即按目标服务器回填账户 SMTP 参数
- 返回示例:

```json
{
  "code": 0,
  "data": {
    "accountId": 1001,
    "smtpServerId": "smtp-main"
  }
}
```

## 4. 设置项新增字段

`PUT /setting/set` 新增支持字段:

- `mailcowPasswordMode`: `fixed` / `random`
- `mailcowProvisionPassword`: 固定模式统一密码（敏感）
- `mailcowCreateStrict`: `0` 宽松 / `1` 严格
- `mailcowGlobalSmtpTemplate`: 全局 SMTP 模板对象
- `mailcowServers`: Mailcow 服务器列表（数组）
- `smtpServers`: SMTP 服务器列表（数组）

`GET /setting/query` 敏感字段脱敏:

- `mailcowProvisionPassword` 返回 `******`
- `mailcowServers[].apiKey` 返回前 4 后 3 的脱敏格式
