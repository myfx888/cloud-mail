import http from '@/axios/index.js'

// 获取SMTP账户列表
export function smtpAccountList(accountId) {
  return http.get('/smtp/accounts', { params: { accountId } })
}

// 创建SMTP账户
export function smtpAccountCreate(data) {
  return http.post('/smtp/accounts', data)
}

// 更新SMTP账户
export function smtpAccountUpdate(smtpAccountId, data) {
  return http.put(`/smtp/accounts/${smtpAccountId}`, data)
}

// 删除SMTP账户
export function smtpAccountDelete(smtpAccountId, accountId) {
  return http.delete(`/smtp/accounts/${smtpAccountId}`, { params: { accountId } })
}

// 获取Mailcow服务器列表（一键开通用）
export function smtpMailcowServers() {
  return http.get('/smtp/mailcow-servers')
}

// 删除Mailcow服务器上的邮箱账户
export function smtpDeleteMailcowAccount(accountId) {
  return http.post('/smtp/delete-mailcow-account', { accountId })
}

// 验证SMTP账户配置
export function smtpAccountVerify(accountId, data) {
  return http.post('/smtp/accounts/verify', {
    ...data,
    accountId
  })
}
