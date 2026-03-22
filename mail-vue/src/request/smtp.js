import { request } from './request'

// 获取SMTP账户列表
export function smtpAccountList(accountId) {
  return request({
    url: `/smtp/accounts`,
    method: 'get',
    params: { accountId }
  })
}

// 创建SMTP账户
export function smtpAccountCreate(data) {
  return request({
    url: `/smtp/accounts`,
    method: 'post',
    data
  })
}

// 更新SMTP账户
export function smtpAccountUpdate(smtpAccountId, data) {
  return request({
    url: `/smtp/accounts/${smtpAccountId}`,
    method: 'put',
    data
  })
}

// 删除SMTP账户
export function smtpAccountDelete(smtpAccountId, accountId) {
  return request({
    url: `/smtp/accounts/${smtpAccountId}`,
    method: 'delete',
    params: { accountId }
  })
}

// 验证SMTP账户配置
export function smtpAccountVerify(accountId, data) {
  return request({
    url: `/smtp/accounts/verify`,
    method: 'post',
    data: {
      ...data,
      accountId
    }
  })
}
