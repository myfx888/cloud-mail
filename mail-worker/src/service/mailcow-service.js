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
            // If it's a string and matches exactly, consider it a match (some APIs might return ID)
            if (typeof mailbox === 'string') {
                return this.normalizeEmail(mailbox) === this.normalizeEmail(email);
            }
            return false;
        }

        const targetEmail = this.normalizeEmail(email);
        
        // Check various possible fields for the email address
        const possibleFields = [
            mailbox.username, 
            mailbox.address, 
            mailbox.mailbox, 
            mailbox.email, 
            mailbox.id,
            mailbox.full_name // occasionally used
        ];

        for (const field of possibleFields) {
            if (field && this.normalizeEmail(field) === targetEmail) {
                return true;
            }
        }

        // Special case: if it's a single object result from get/mailbox/{id}, 
        // it might have the email as the key if returned as a map, though callApi parses JSON.
        return false;
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
                // 使用精确查询（对应 yaml: GET /api/v1/get/mailbox/{id}，id 为邮箱地址）
                const result = await this.callApi(c, `get/mailbox/${encodeURIComponent(email)}`, 'GET', null, serverConfig);
                console.log(`accountExists attempt ${attempt} for ${email} result:`, JSON.stringify(result));
                
                if (this.mailboxMatchesEmail(result, email)) {
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

            if (this.isEmptyApiResponse(result)) {
                // If direct lookup returns nothing, try checking all domains as a fallback
                try {
                    const allDomains = await this.callApi(c, 'get/domain/all', 'GET', null, serverConfig);
                    if (Array.isArray(allDomains)) {
                        return allDomains.some(item => {
                            const itemDomain = String(item?.domain_name || item?.domain || '').toLowerCase();
                            return itemDomain === String(domain).toLowerCase();
                        });
                    }
                } catch (e) {
                    console.warn(`Mailcow all-domains fallback check failed: ${e.message}`);
                }
                return false;
            }

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
            const apiKey = String(server.apiKey || '').trim();
            
            // Log API Key presence and length for debugging
            console.log(`Mailcow API Key info: length=${apiKey.length}, looks_masked=${apiKey.includes('****')}`);
            
            // Normalize apiUrl: remove trailing slash and redundant /api/v1
            let baseApiUrl = String(server.apiUrl || '').trim().replace(/\/+$/, '');
            if (baseApiUrl.toLowerCase().endsWith('/api/v1')) {
                baseApiUrl = baseApiUrl.substring(0, baseApiUrl.length - 7).replace(/\/+$/, '');
            }
            // 确保 apiUrl 包含协议
            if (!baseApiUrl.startsWith('http://') && !baseApiUrl.startsWith('https://')) {
                baseApiUrl = 'https://' + baseApiUrl;
            }
            const url = `${baseApiUrl}/api/v1/${endpoint}`;
            
            // Explicit check for masked API key
            if (server.apiKey && server.apiKey.includes('****')) {
                throw new BizError('Mailcow API Key is masked (contains ****). Please re-enter and save your correct API key in Settings.', 401);
            }

            // 最小化请求头，完全匹配 PHP 测试脚本，并增加 User-Agent 避免防火墙拦截
            const headers = {
                'X-API-Key': apiKey,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };

            const options = {
                method,
                headers,
                redirect: 'follow',
                cache: 'no-store'
            };
            
            if (data && (method === 'POST' || method === 'PUT')) {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(data);
            }
            
            console.log(`Mailcow API Call: ${method} ${url}`);
            // Log masked config for verification
            const maskedKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'null';
            console.log(`Mailcow Config Check: URL=${url}, Key=${maskedKey}, KeyLength=${apiKey.length}`);
            
            if (data) {
                const logData = { ...data };
                if (logData.password) logData.password = '[REDACTED]';
                if (logData.password2) logData.password2 = '[REDACTED]';
                console.log(`Mailcow API Request Body: ${JSON.stringify(logData)}`);
            }
            const response = await fetch(url, options);
            console.log(`Mailcow API Response: ${response.status} ${response.statusText} for ${method} ${url}`);
            
            const responseHeaders = {};
            response.headers.forEach((v, k) => { responseHeaders[k] = v; });
            console.log(`Mailcow API Response Headers: ${JSON.stringify(responseHeaders)}`);
            
            // Detect WAF/Security blocking (e.g. Cloudflare, Wallarm, etc.)
            const isCloudflare = responseHeaders['server']?.toLowerCase() === 'cloudflare';
            const hasCfRay = !!responseHeaders['cf-ray'];
            const hasSameOrigin = responseHeaders['x-frame-options']?.toUpperCase() === 'SAMEORIGIN';
            
            if (isCloudflare || hasCfRay || hasSameOrigin) {
                console.warn(`Potential Security/WAF blocking detected! Cloudflare=${isCloudflare}, CF-Ray=${hasCfRay}, SameOrigin=${hasSameOrigin}`);
                if (hasSameOrigin && !responseText.trim().startsWith('{') && !responseText.trim().startsWith('[')) {
                    console.error('CRITICAL: Response has X-Frame-Options: SAMEORIGIN and is not JSON. This usually means a firewall challenge (hCaptcha/Turnstile) or login page was returned instead of API response.');
                }
            }

            const responseText = await response.text().catch((e) => `[Read Body Error: ${e.message}]`);
            console.log(`Mailcow API Raw Response Body (first 500 chars): ${responseText.slice(0, 500)}`);

            if (!response.ok) {
                console.error(`Mailcow API Error Detail: Status=${response.status}, Body=${responseText}`);
                let errorMessage = response.statusText;
                try {
                    if (responseText && responseHeaders['content-type']?.includes('application/json')) {
                        const errorData = JSON.parse(responseText);
                        errorMessage = errorData.message || errorData.error || errorMessage;
                    }
                } catch (e) {
                    if (responseText) errorMessage = responseText;
                }
                throw new BizError(`mailcow API error: ${errorMessage}`, response.status);
            }
            
            if (!responseText) {
                console.warn(`Mailcow API returned completely empty body for ${method} ${url}`);
                return null;
            }

            if (responseHeaders['content-type']?.includes('application/json')) {
                try {
                    return JSON.parse(responseText);
                } catch (e) {
                    console.warn(`Failed to parse mailcow JSON response from ${url}:`, e.message);
                    return responseText;
                }
            }
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
            // 最小化请求体，符合 mailcow.yaml 规范 (POST /api/v1/add/mailbox)
            const data = {
                active: 1,
                domain: email.split('@')[1],
                local_part: email.split('@')[0],
                name: email, // 默认使用邮箱作为显示名称
                password: accountPassword,
                password2: accountPassword,
                quota: 2048, // 默认 2GB
                force_pw_update: 0,
                tls_enforce_in: 0,
                tls_enforce_out: 0
            };
            
            console.log(`Creating mailcow account ${email} on ${server.apiUrl}`);
            console.log(`Request payload for add/mailbox: ${JSON.stringify(data, null, 2).replace(/"password": ".*?"/, '"password": "[REDACTED]"').replace(/"password2": ".*?"/, '"password2": "[REDACTED]"')}`);
            let result = await this.callApi(c, 'add/mailbox', 'POST', data, server);
            console.log('Mailcow Create Account Result:', JSON.stringify(result));
            
            // mailcow 可能返回空 body（HTTP 200），不再重试，直接验证邮箱是否存在
            if (this.isEmptyApiResponse(result)) {
                console.log(`Mailcow add/mailbox returned empty response for ${email}, verifying mailbox existence...`);
                const existsAfterCreate = await this.accountExists(c, email, server, {
                    attempts: verifyAttempts,
                    delayMs: verifyDelayMs
                });

                if (!existsAfterCreate) {
                    const domainExistsNow = await this.domainExists(c, domain, server);
                    const errorMsg = domainExistsNow 
                        ? `API returned empty response and mailbox not found after ${verifyAttempts} attempts`
                        : `API returned empty response and domain ${domain} vanished or is unreachable`;
                    throw new BizError(`${t('mailcowAccountCreateFailed')}: ${errorMsg}`);
                }
                console.log(`Mailbox ${email} found after empty response, treating as success.`);
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
            
            const isSuccess = Array.isArray(result)
                ? result.some(r => r.type === 'success' || r.status === 'success' || r.status === true)
                : (result?.type === 'success' || result?.status === 'success' || result?.status === true);

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
            // 使用精确查询（对应 yaml: GET /api/v1/get/mailbox/{id}）
            const result = await this.callApi(c, `get/mailbox/${email}`, 'GET', null, serverConfig);
            
            if (!result || (Array.isArray(result) && result.length === 0)) {
                throw new BizError(t('mailcowAccountNotFound'));
            }
            
            // API 返回数组时取匹配项
            if (Array.isArray(result)) {
                const account = result.find(mailbox => mailbox.username === email);
                if (!account) {
                    throw new BizError(t('mailcowAccountNotFound'));
                }
                return account;
            }
            
            return result;
        } catch (error) {
            if (error instanceof BizError) throw error;
            throw new BizError(`Failed to get mailcow account: ${error.message}`);
        }
    },

    async deleteAccount(c, emailOrItems, serverConfig = null) {
        try {
            const items = Array.isArray(emailOrItems)
                ? emailOrItems.filter(item => !!item).map(item => String(item).trim())
                : [String(emailOrItems || '').trim()].filter(item => !!item);

            if (items.length === 0) {
                throw new BizError(t('mailcowAccountDeleteFailed'));
            }

            // yaml 规范：请求体直接是 JSON 数组
            const result = await this.callApi(c, 'delete/mailbox', 'POST', items, serverConfig);

            const isSuccess = Array.isArray(result)
                ? result.some(r => r?.type === 'success' || r?.status === 'success' || r?.status === true)
                : !!(result && (result.status === true || result.status === 'success' || result.type === 'success'));

            if (!isSuccess) {
                throw new BizError(t('mailcowAccountDeleteFailed'));
            }
            
            return true;
        } catch (error) {
            throw new BizError(`Failed to delete mailcow account: ${error.message}`);
        }
    },

    async testConnection(c, serverConfig) {
        try {
            // yaml 规范：使用 /api/v1/get/status/version 验证连接（最轻量）
            await this.callApi(c, 'get/status/version', 'GET', null, serverConfig);
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
