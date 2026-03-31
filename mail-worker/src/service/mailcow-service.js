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
            
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new BizError(`mailcow API error: ${errorData.message || response.statusText}`, response.status);
            }
            
            return await response.json();
        } catch (error) {
            if (error instanceof BizError) {
                throw error;
            }
            throw new BizError(`mailcow API call failed: ${error.message}`);
        }
    },

    async createAccount(c, email, password = '', serverConfig = null) {
        try {
            const server = serverConfig || await this.getDefaultServer(c);
            const accountPassword = await this.resolvePassword(c, password);
            const data = {
                local_part: email.split('@')[0],
                domain: email.split('@')[1],
                password: accountPassword,
                name: email,
                active: true
            };
            
            const result = await this.callApi(c, 'add/mailbox', 'POST', data, server);
            
            if (!result || (!result.status && !Array.isArray(result))) {
                throw new BizError(t('mailcowAccountCreateFailed'));
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