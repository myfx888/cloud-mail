import http from '@/axios/index.js';

export function settingSet(setting) {
    return http.put('/setting/set',setting)
}

export function settingQuery() {
    return http.get('/setting/query')
}

export function websiteConfig() {
    return http.get('/setting/websiteConfig')
}

export function setBackground(background) {
    return http.put('/setting/setBackground',{background})
}

export function deleteBackground() {
    return http.delete('/setting/deleteBackground')
}

export function verifySmtp(smtpConfig) {
    return http.post('/smtp/verify', smtpConfig)
}

export function getSmtpAccountConfig(accountId) {
    return http.get('/smtp/account-config', { params: { accountId } })
}

export function saveSmtpAccountConfig(accountId, smtpConfig) {
    return http.post('/smtp/account-config', { ...smtpConfig, accountId })
}

export function verifySmtpAccountConfig(accountId, smtpConfig) {
    return http.post('/smtp/verify-account', { ...smtpConfig, accountId })
}

export function mailcowTestConnection(serverId) {
    return http.post('/setting/mailcow/testConnection', { serverId })
}

// 签名管理相关 API 调用
export function getSignatures(accountId) {
    return http.get(`/account/${accountId}/signatures`)
}

export function addSignature(accountId, signatureData) {
    return http.post(`/account/${accountId}/signatures`, signatureData)
}

export function updateSignature(accountId, signatureId, signatureData) {
    return http.put(`/account/${accountId}/signatures/${signatureId}`, signatureData)
}

export function deleteSignature(accountId, signatureId) {
    return http.delete(`/account/${accountId}/signatures/${signatureId}`)
}

export function setDefaultSignature(accountId, signatureId) {
    return http.put(`/account/${accountId}/signatures/${signatureId}/setDefault`)
}


export function mailcowTestConnectionWithConfig(serverConfig) {
    return http.post('/setting/mailcow/testConnection', { serverConfig })
}

export function getMailcowServerDependencies(serverId) {
    return http.get(`/setting/mailcow/dependencies/${serverId}`)
}
