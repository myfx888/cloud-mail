import http from '@/axios/index.js'

export function backupCreate(params) {
	return http.post('/admin/backup/create', params)
}
export function backupProcess(taskId) {
	return http.post(`/admin/backup/${taskId}/process`)
}
export function backupProgress(taskId) {
	return http.get(`/admin/backup/${taskId}/progress`)
}
export function fetchBackupList() {
	return http.get('/admin/backup/list')
}
export function backupDownload(taskId) {
	return http.get(`/admin/backup/${taskId}/download`, { responseType: 'blob' })
}
export function backupDelete(taskId) {
	return http.delete(`/admin/backup/${taskId}`)
}

export function restoreUpload(formData, onProgress) {
	return http.post('/admin/restore/upload', formData, {
		onUploadProgress: (e) => {
			if (e.total && onProgress) onProgress(e.loaded / e.total)
		}
	})
}
export function restoreCreate(sourceKeys, mode, dedup) {
	return http.post('/admin/restore/create', { sourceKeys, mode, dedup })
}
export function restoreProcess(taskId) {
	return http.post(`/admin/restore/${taskId}/process`)
}
export function restoreProgress(taskId) {
	return http.get(`/admin/restore/${taskId}/progress`)
}
export function restoreTaskList(type) {
	return http.get('/admin/restore/task/list', { params: { type } })
}

export function cancelTask(taskId) {
	return http.post(`/admin/backup-task/${taskId}/cancel`)
}
