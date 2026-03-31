## 新增需求

### 需求:统一解析 SMTP 安全模式
系统必须根据 `smtpSecure` 显式解析 SMTP 连接参数，禁止在发送和验证链路中出现不一致的安全模式推导。

#### 场景:解析隐式 TLS
- **当** `smtpSecure` 为 `1`
- **那么** 连接参数必须为 `secure=true` 且 `startTls=false`

#### 场景:解析显式 STARTTLS
- **当** `smtpSecure` 为 `2`
- **那么** 连接参数必须为 `secure=false` 且 `startTls=true`

#### 场景:解析明文 SMTP
- **当** `smtpSecure` 为 `0`
- **那么** 连接参数必须为 `secure=false` 且 `startTls=false`

## 修改需求

## 移除需求
