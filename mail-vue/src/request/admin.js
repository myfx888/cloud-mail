import http from '@/axios/index.js'

export function adminAccountList(params) {
    return http.get('/admin/accounts', { params })
}

// ===== 共享邮箱成员管理 =====
export function adminMailboxMembers(accountId) {
    return http.get(`/admin/mailbox/${accountId}/members`)
}
export function adminAssignMember(accountId, userId) {
    return http.post(`/admin/mailbox/${accountId}/members`, { userId })
}
export function adminKickMember(accountId, userId) {
    return http.delete(`/admin/mailbox/${accountId}/members/${userId}`)
}
