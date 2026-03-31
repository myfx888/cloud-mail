import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import settingService from './setting-service';

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

    async accountExists(c, email, serverConfig = null) {
        try {
            const result = await this.callApi(c, 'get/mailbox/all', 'GET', null, serverConfig);
            if (!Array.isArray(result)) {
                return false;
            }
            return result.some(mailbox => mailbox.username === email);
        } catch (e) {
            return false;
        }
    },

    async domainExists(c, domain, serverConfig = null) {
        try {
            const result = await this.callApi(c, `get/domain/${encodeURIComponent(domain)}`, 'GET', null, serverConfig);

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
        } catch (e) {
            console.warn(`Mailcow domain precheck failed for ${domain}, continue with create flow: ${e.message}`);
            return true;
        }

        return false;
    },

    async callApi(c, endpoint, method = 'GET', data = null, serverConfig = null) {
        try {
            const server = serverConfig || await this.getDefaultServer(c);
            const url = `${server.apiUrl}/api/v1/${endpoint}`;
            
            const headers = {
                'Content-Type': 'application/json',
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
            const response = await fetch(url, options);
            console.log(`Mailcow API Response: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
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
                return null;
            }

            const contentType = response.headers.get('Content-Type');
            if (contentType && contentType.includes('application/json')) {
                try {
                    return JSON.parse(responseText);
                } catch (e) {
                    console.warn('Failed to parse mailcow JSON response:', e);
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
                name: email,
                quota: 3072,
                active: 1
            };
            
            console.log(`Creating mailcow account ${email} on ${server.apiUrl}`);
            const result = await this.callApi(c, 'add/mailbox', 'POST', data, server);
            console.log('Mailcow Create Account Result:', JSON.stringify(result));
            
            let createdWithEmptyResponse = false;
            if (!result) {
                console.warn(`Mailcow add/mailbox returned empty response for ${email}, verifying mailbox existence...`);
                const existsAfterCreate = await this.accountExists(c, email, server);
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
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }
};

export default mailcowService;