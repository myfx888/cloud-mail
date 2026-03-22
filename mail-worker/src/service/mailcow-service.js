import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import settingService from './setting-service';

const mailcowService = {

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
                let errorData = {};
                try {
                    errorData = await response.json();
                } catch (e) {
                    // 如果响应不是有效的 JSON，使用状态文本作为错误信息
                    throw new BizError(`mailcow API error: ${response.statusText}`, response.status);
                }
                throw new BizError(`mailcow API error: ${errorData.message || response.statusText}`, response.status);
            }
            
            // 检查响应是否为空
            const responseText = await response.text();
            if (!responseText) {
                throw new BizError('mailcow API returned empty response');
            }
            
            // 尝试解析 JSON 响应
            try {
                return JSON.parse(responseText);
            } catch (e) {
                throw new BizError(`mailcow API returned invalid JSON: ${e.message}`);
            }
        } catch (error) {
            if (error instanceof BizError) {
                throw error;
            }
            throw new BizError(`mailcow API call failed: ${error.message}`);
        }
    },

    async createAccount(c, email, password, serverConfig = null) {
        try {
            const data = {
                local_part: email.split('@')[0],
                domain: email.split('@')[1],
                password,
                name: email,
                active: true
            };
            
            const result = await this.callApi(c, 'add/mailbox', 'POST', data, serverConfig);
            
            if (!result || !result.status) {
                throw new BizError(t('mailcowAccountCreateFailed'));
            }
            
            return {
                email,
                password,
                smtpHost: serverConfig?.smtpHost || 'smtp.mailcow.email',
                smtpPort: 587,
                smtpSecure: 0,
                smtpUser: email
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