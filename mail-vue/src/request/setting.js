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
