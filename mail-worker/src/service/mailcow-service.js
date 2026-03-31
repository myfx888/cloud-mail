import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import settingService from './setting-service';
import { sleep } from '../utils/time-utils';

const mailcowService = {

    async getServerById(c, serverId) {
        if (!serverId) {
            return this.getDefaultServer(c);
        }
        const settings = await settingService.query(c);
        const mailcowServers = settings.mailcowServers || [];
        
        // 1. 尝试通过 ID 匹配
        let target = mailcowServers.find(item => String(item.id) === String(serverId));
        
        // 2. 如果 ID 没匹配到，尝试通过 apiUrl 匹配（处理旧数据或误传域名的情况）
        if (!target) {
            target = mailcowServers.find(item => {
                if (!item.apiUrl) return false;
                const url = item.apiUrl.toLowerCase();
                const search = String(serverId).toLowerCase();
                return url.includes(search) || search.includes(url.replace(/^https?:\/\//, ''));
            });
        }

        if (!target) {
            throw new BizError(`${serverId}: mailcow server not found`);
        }
        return target;
    },

    async getDefaultServer(c) {
        const settings = await settingService.query(c);
        const mailcowServers = settings.mailcowServers || [];
        
        if (mailcowServers.length === 0) {
            throw new BizError(t('mailcowServerNotConfigured'));
        }
        
        const defaultServer = mailcowServers.find(server => server.isDefault);
        if (defaultServer) {
            return defaultServer;
        }
        
        return mailcowServers[0];
    },

    async resolvePassword(c, explicitPassword = '') {
        if (explicitPassword) {
            return explicitPassword;
        }
        const settings = await settingService.query(c);
        const mode = settings.mailcowPasswordMode || 'random';
        if (mode === 'fixed') {
            if (!settings.mailcowProvisionPassword) {
                throw new BizError('mailcow fixed password is empty');
            }
            return settings.mailcowProvisionPassword;
        }
        return this.generatePassword();
    },

    async getSmtpConfig(c, serverConfig = null) {
        const settings = await settingService.query(c);
        const server = serverConfig || await this.getDefaultServer(c);
        const globalTemplate = settings.mailcowGlobalSmtpTemplate || {};

        return {
            smtpHost: server?.smtpHost || globalTemplate.smtpHost || 'smtp.mailcow.email',
            smtpPort: Number(server?.smtpPort || globalTemplate.smtpPort || 587),
            smtpSecure: Number(server?.smtpSecure ?? globalTemplate.smtpSecure ?? 0),
            smtpAuthType: server?.smtpAuthType || globalTemplate.smtpAuthType || 'plain'
        };
    },

    normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    },

    mailboxMatchesEmail(mailbox, email) {
        if (!mailbox) return false;
        
        // Handle array response if API returns a list even for single query
        if (Array.isArray(mailbox)) {
            return mailbox.some(m => this.mailboxMatchesEmail(m, email));
        }

        if (typeof mailbox !== 'object') {
            return false;
        }

        const targetEmail = this.normalizeEmail(email);
        const mailboxEmail = this.normalizeEmail(mailbox.username || mailbox.address || mailbox.mailbox || mailbox.email);
        return !!targetEmail && mailboxEmail === targetEmail;
    },

    isEmptyApiResponse(result) {
        return !result
            || (Array.isArray(result) && result.length === 0)
            || (typeof result === 'object' && result !== null && Object.keys(result).length === 0);
    },

    async accountExists(c, email, serverConfig = null, options = {}) {
        const attemptsRaw = Number(options.attempts ?? 1);
        const attempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? Math.floor(attemptsRaw) : 1;
        const delayMsRaw = Number(options.delayMs ?? 0);
        const delayMs = Number.isFinite(delayMsRaw) && delayMsRaw > 0 ? Math.floor(delayMsRaw) : 0;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                // Try targeted query first for better performance
                const result = await this.callApi(c, `get/mailbox/${encodeURIComponent(email)}`, 'GET', null, serverConfig);
                console.log(`accountExists attempt ${attempt} for ${email} result:`, JSON.stringify(result));
                
                if (this.mailboxMatchesEmail(result, email)) {
                    return true;
                }
                
                // Fallback: If targeted API returns nothing but get/mailbox/all might have it
                const allMailboxes = await this.callApi(c, 'get/mailbox/all', 'GET', null, serverConfig);
                if (this.mailboxMatchesEmail(allMailboxes, email)) {
                    return true;
                }
            } catch (e) {
                console.warn(`accountExists attempt ${attempt} failed: ${e.message}`);
                if (e instanceof BizError && (e.status === 401 || e.status === 403)) {
                    throw e; // Don't swallow auth errors
                }
            }

            if (attempt < attempts && delayMs > 0) {
                await sleep(delayMs);
            }
        }

        return false;
    },

    async domainExists(c, domain, serverConfig = null) {
        try {
            const result = await this.callApi(c, `get/domain/${encodeURIComponent(domain)}`, 'GET', null, serverConfig);
            console.log(`Mailcow domainExists check for ${domain} result:`, JSON.stringify(result));

            if (Array.isArray(result)) {
                return result.some(item => {
                    const itemDomain = String(item?.domain_name || item?.domain || '').toLowerCase();
                    return itemDomain === String(domain).toLowerCase();
                });
            }

            if (result && typeof result === 'object') {
                const itemDomain = String(result.domain_name || result.domain || '').toLowerCase();
                if (itemDomain) {
                    return itemDomain === String(domain).toLowerCase();
                }
            }
        } catch (error) {
            console.warn(`Mailcow domain precheck failed for ${domain}, continue with create flow: ${error.message}`);
            return true;
        }

        return false;
    },

    async callApi(c, endpoint, method = 'GET', data = null, serverConfig = null) {
        try {
            const server = serverConfig || await this.getDefaultServer(c);
            
            // Normalize apiUrl: remove trailing slash and redundant /api/v1
            let baseApiUrl = String(server.apiUrl || '').trim().replace(/\/+$/, '');
            if (baseApiUrl.toLowerCase().endsWith('/api/v1')) {
                baseApiUrl = baseApiUrl.substring(0, baseApiUrl.length - 7).replace(/\/+$/, '');
            }
            const url = `${baseApiUrl}/api/v1/${endpoint}`;
            
            // Explicit check for masked API key
            if (server.apiKey && server.apiKey.includes('****')) {
                throw new BizError('Mailcow API Key is masked (contains ****). Please re-enter and save your correct API key in Settings.', 401);
            }

            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-API-Key': server.apiKey
            };
            
            const options = {
                method,
                headers,
                cf: {
                    cacheTtl: 0
                }
            };
            
            if (data && (method === 'POST' || method === 'PUT')) {
                options.body = JSON.stringify(data);
            }
            
            console.log(`Mailcow API Call: ${method} ${url}`);
            const keyLength = server.apiKey ? server.apiKey.length : 0;
            const isKeyMasked = server.apiKey && server.apiKey.includes('****');
            console.log(`Mailcow API Key info: length=${keyLength}, looks_masked=${isKeyMasked}`);
            
            if (data) {
                const logData = { ...data };
                if (logData.password) logData.password = '[REDACTED]';
                if (logData.password2) logData.password2 = '[REDACTED]';
                console.log(`Mailcow API Request Body: ${JSON.stringify(logData)}`);
            }
            const response = await fetch(url, options);
            console.log(`Mailcow API Response: ${response.status}, ${response.statusText}`);
            
            // Log important headers for debugging
            console.log(`Mailcow API Response Content-Type: ${response.headers.get('Content-Type')}`);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.error(`Mailcow API Error Detail: Status=${response.status}, Body=${errorText}`);
                let errorMessage = response.statusText;
                try {
                    if (errorText) {
                        const errorData = JSON.parse(errorText);
                        errorMessage = errorData.message || errorMessage;
                    }
                } catch (e) {
                    // Ignore JSON parse error for error response
                    if (errorText) errorMessage = errorText;
                }
                throw new BizError(`mailcow API error: ${errorMessage}`, response.status);
            }
            
            const responseText = await response.text().catch(() => '');
            if (!responseText) {
                console.warn(`Mailcow API returned completely empty body for ${method} ${url}`);
                return null;
            }

            const contentType = response.headers.get('Content-Type');
            if (contentType && contentType.includes('application/json')) {
                try {
                    return JSON.parse(responseText);
                } catch (e) {
                    console.warn(`Failed to parse mailcow JSON response from ${url}:`, e.message);
                    console.warn('Response preview:', responseText.slice(0, 200));
                    return responseText;
                }
            }
            console.log(`Mailcow API returned non-JSON response (${contentType || 'no-content-type'}) for ${url}. Preview:`, responseText.slice(0, 200));
            return responseText;
        } catch (error) {
            if (error instanceof BizError) {
                throw error;
            }
            throw new BizError(`mailcow API call failed: ${error.message}`);
        }
    },

    async createAccount(c, email, password = '', serverConfig = null) {
        try {
            // Ensure we have a full server configuration
            let server = serverConfig;
            if (!server || !server.apiUrl || !server.apiKey) {
                server = await this.getServerById(c, server?.id);
            }

            const settings = await settingService.query(c);
            const verifyAttemptsRaw = Number(settings.mailcowRetryCount ?? 3);
            const verifyAttempts = Number.isFinite(verifyAttemptsRaw) && verifyAttemptsRaw > 0 ? Math.floor(verifyAttemptsRaw) : 3;
            const verifyWindowRaw = Number(settings.mailcowTimeout ?? 30000);
            const verifyWindow = Number.isFinite(verifyWindowRaw) && verifyWindowRaw > 0 ? verifyWindowRaw : 30000;
            const verifyDelayMs = Math.max(300, Math.floor(verifyWindow / Math.max(verifyAttempts, 1)));
            
            const domain = email.split('@')[1];
            
            // 1. Check if domain exists
            const domainOk = await this.domainExists(c, domain, server);
            if (!domainOk) {
                console.warn(`Mailcow domain precheck returned false for ${domain} on ${server.apiUrl}, continue to add/mailbox and rely on API result`);
            }

            const accountPassword = await this.resolvePassword(c, password);
            const data = {
                local_part: email.split('@')[0],
                domain: email.split('@')[1],
                password: accountPassword,
                password2: accountPassword,
                name: '',
                quota: '3072',
                active: '1',
                force_pw_update: '0',
                force_tfa: '0',
                sogo_access: ['0', '1'],
                protocol_access: ['0', 'imap', 'pop3', 'smtp', 'sieve'],
                authsource: 'mailcow',
                tags: '',
                tagged_mail_handler: 'none',
                quarantine_notification: 'hourly',
                quarantine_category: 'reject',
                acl: [
                    'spam_alias', 'tls_policy', 'spam_score', 'spam_policy', 
                    'delimiter_action', 'eas_reset', 'pushover', 'quarantine', 
                    'quarantine_attachments', 'quarantine_notification', 
                    'quarantine_category', 'app_passwds'
                ],
                rl_value: '',
                rl_frame: 's'
            };
            
            console.log(`Creating mailcow account ${email} on ${server.apiUrl}`);
            console.log(`Request payload for add/mailbox: ${JSON.stringify(data, null, 2).replace(/"password": ".*?"/, '"password": "[REDACTED]"').replace(/"password2": ".*?"/, '"password2": "[REDACTED]"')}`);
            let result = await this.callApi(c, 'add/mailbox', 'POST', data, server);
            console.log('Mailcow Create Account Result:', JSON.stringify(result));
            console.log(`Result check: result=${!!result}, typeof result=${typeof result}, Array.isArray=${Array.isArray(result)}, length=${Array.isArray(result) ? result.length : 'N/A'}, Object.keys=${typeof result === 'object' && result !== null ? Object.keys(result).length : 'N/A'}`);
            
            if (this.isEmptyApiResponse(result)) {
                console.log(`Mailcow add/mailbox returned empty response for ${email}, retrying with minimal parameters after 500ms...`);
                await sleep(500);
                const minimalData = {
                    local_part: email.split('@')[0],
                    domain: email.split('@')[1],
                    password: accountPassword,
                    password2: accountPassword,
                    name: '',
                    quota: '3072',
                    active: '1'
                };
                console.log(`Retrying with minimal payload: ${JSON.stringify(minimalData, null, 2).replace(/"password": ".*?"/, '"password": "[REDACTED]"').replace(/"password2": ".*?"/, '"password2": "[REDACTED]"')}`);
                const retryResult = await this.callApi(c, 'add/mailbox', 'POST', minimalData, server);
                console.log('Mailcow Retry Create Account Result:', JSON.stringify(retryResult));
                result = retryResult;
                
                if (this.isEmptyApiResponse(result)) {
                    console.log(`Mailcow add/mailbox retry also returned empty response for ${email}, verifying mailbox existence with retry (${verifyAttempts} attempts, delay ${verifyDelayMs}ms)...`);
                    const existsAfterEmptyResponse = await this.accountExists(c, email, server, {
                        attempts: verifyAttempts,
                        delayMs: verifyDelayMs
                    });

                    if (existsAfterEmptyResponse) {
                        console.log(`Mailbox ${email} found after empty response verification, treating as success.`);
                        const smtpConfig = await this.getSmtpConfig(c, server);
                        return {
                            email,
                            password: accountPassword,
                            smtpHost: smtpConfig.smtpHost,
                            smtpPort: smtpConfig.smtpPort,
                            smtpSecure: smtpConfig.smtpSecure,
                            smtpAuthType: smtpConfig.smtpAuthType,
                            smtpUser: email,
                            mailcowServerId: server?.id || ''
                        };
                    }

                    throw new BizError(`${t('mailcowAccountCreateFailed')}: API returned empty response and mailbox not found`);
                }
            }
            
            let createdWithEmptyResponse = false;
            if (!result) {
                console.warn(`Mailcow add/mailbox returned empty response for ${email}, verifying mailbox existence...`);
                const existsAfterCreate = await this.accountExists(c, email, server, {
                    attempts: verifyAttempts,
                    delayMs: verifyDelayMs
                });
                if (!existsAfterCreate) {
                    throw new BizError(`${t('mailcowAccountCreateFailed')}: API returned empty response`);
                }
                createdWithEmptyResponse = true;
                console.log(`Mailcow mailbox exists after empty response: ${email}`);
            }

            const isSuccess = createdWithEmptyResponse
                ? true
                : (Array.isArray(result)
                    ? result.some(r => r.type === 'success' || r.status === 'success' || r.status === true)
                    : (result?.type === 'success' || result?.status === 'success' || result?.status === true));

            if (!isSuccess) {
                // Extract error details from result
                let errorDetail = '';
                if (Array.isArray(result)) {
                    errorDetail = result
                        .filter(r => r.type === 'danger' || r.type === 'error' || r.status === 'error')
                        .map(r => r.msg || r.message || JSON.stringify(r))
                        .join(', ');
                    if (!errorDetail && result.length > 0) {
                        errorDetail = JSON.stringify(result);
                    }
                } else {
                    errorDetail = result?.msg || result?.message || JSON.stringify(result);
                }
                
                throw new BizError(`${t('mailcowAccountCreateFailed')}${errorDetail ? ': ' + errorDetail : ''}`);
            }

            const smtpConfig = await this.getSmtpConfig(c, server);
            
            return {
                email,
                password: accountPassword,
                smtpHost: smtpConfig.smtpHost,
                smtpPort: smtpConfig.smtpPort,
                smtpSecure: smtpConfig.smtpSecure,
                smtpAuthType: smtpConfig.smtpAuthType,
                smtpUser: email,
                mailcowServerId: server?.id || ''
            };
        } catch (error) {
            if (error instanceof BizError) {
                throw error;
            }
            throw new BizError(`Failed to create mailcow account: ${error.message}`);
        }
    },

    async getAccount(c, email, serverConfig = null) {
        try {
            const result = await this.callApi(c, 'get/mailbox/all', 'GET', null, serverConfig);
            
            if (!Array.isArray(result)) {
                throw new BizError(t('mailcowAccountQueryFailed'));
            }
            
            const account = result.find(mailbox => mailbox.username === email);
            if (!account) {
                throw new BizError(t('mailcowAccountNotFound'));
            }
            
            return account;
        } catch (error) {
            throw new BizError(`Failed to get mailcow account: ${error.message}`);
        }
    },

    async deleteAccount(c, email, serverConfig = null) {
        try {
            const data = {
                items: [email]
            };
            
            const result = await this.callApi(c, 'delete/mailbox', 'POST', data, serverConfig);
            
            if (!result || !result.status) {
                throw new BizError(t('mailcowAccountDeleteFailed'));
            }
            
            return true;
        } catch (error) {
            throw new BizError(`Failed to delete mailcow account: ${error.message}`);
        }
    },

    async testConnection(c, serverConfig) {
        try {
            await this.callApi(c, 'get/status', 'GET', null, serverConfig);
            return true;
        } catch (error) {
            throw new BizError(`Connection test failed: ${error.message}`);
        }
    },

    async generatePassword(length = 16) {
        // Use a more conservative character set to avoid issues with some Mailcow versions/filters
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^*()_+-=[]{}|;:,./?';
        let password = '';
        
        for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }
};

export default mailcowService;