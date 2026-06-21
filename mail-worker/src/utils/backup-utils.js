const SECRET_USER_KEYS = ['password', 'salt', 'createIp', 'activeIp'];
const SECRET_ACCOUNT_KEYS = ['smtpPassword', 'smtpUser'];

export function sanitizeUsers(list, includeSecrets) {
	return (list || []).map(u => {
		const o = { ...u };
		if (!includeSecrets) {
			SECRET_USER_KEYS.forEach(k => { if (k in o) o[k] = ''; });
		}
		return o;
	});
}

export function sanitizeAccounts(list, includeSecrets) {
	return (list || []).map(a => {
		const o = { ...a };
		if (!includeSecrets) {
			SECRET_ACCOUNT_KEYS.forEach(k => { if (k in o) o[k] = ''; });
		}
		return o;
	});
}

export default { sanitizeUsers, sanitizeAccounts };
