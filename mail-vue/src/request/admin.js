import http from '@/axios/index.js'

export function adminAccountList(params) {
    return http.get('/admin/accounts', { params })
}
