import http from '@/axios/index.js'

export function accountList(accountId, size, lastSort) {
    return http.get('/account/list', {params: {accountId, size, lastSort}});
}

export function accountAdd(email,token) {
    return http.post('/account/add', {email,token})
}

export function accountSetName(accountId,name) {
    return http.put('/account/setName', {name,accountId})
}

export function accountDelete(accountId) {
    return http.delete('/account/delete', {params: {accountId}})
}

export function accountSetAllReceive(accountId) {
    return http.put('/account/setAllReceive', {accountId})
}

export function accountSetAsTop(accountId) {
    return http.put('/account/setAsTop', {accountId})
}

export function accountRetryMailcow(accountId) {
    return http.post(`/account/${accountId}/mailcow/retry`)
}

export function accountProvisionSmtpByMailcowServer(accountId, mailcowServerId) {
    return http.post('/smtp/provision-mailcow', { accountId, mailcowServerId })
}

export function accountSwitchSmtpServer(accountId, smtpServerId) {
    return http.post(`/account/${accountId}/smtp/server`, { smtpServerId })
}

// ===== 共享邮箱成员 =====
export function mailboxMembers(accountId) {
    return http.get(`/mailbox/${accountId}/members`)
}
export function mailboxLeave(accountId) {
    return http.post(`/mailbox/${accountId}/leave`)
}
export function setSignatureChoice(accountId, scope, sigId) {
    return http.put(`/mailbox/${accountId}/signature-choice`, { scope, sigId })
}
export function resolveSignature(accountId) {
    return http.get(`/account/${accountId}/signatures/resolve`)
}

// ===== 个人签名 =====
export function getPersonalSignatures(accountId) {
    return http.get(`/account/${accountId}/signatures/personal`)
}
export function addPersonalSignature(accountId, data) {
    return http.post(`/account/${accountId}/signatures/personal`, data)
}
export function updatePersonalSignature(accountId, signatureId, data) {
    return http.put(`/account/${accountId}/signatures/personal/${signatureId}`, data)
}
export function deletePersonalSignature(accountId, signatureId) {
    return http.delete(`/account/${accountId}/signatures/personal/${signatureId}`)
}
export function setDefaultPersonalSignature(accountId, signatureId) {
    return http.put(`/account/${accountId}/signatures/personal/${signatureId}/setDefault`)
}