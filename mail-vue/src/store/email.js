import { defineStore } from 'pinia'
import { emailContent } from '@/request/email.js'

export const useEmailStore = defineStore('email', {
    state: () => ({
        deleteIds: 0,
        starScroll: null,
        emailScroll: null,
        cancelStarEmailId: 0,
        addStarEmailId: 0,
        contentData: {
            email: null,
            delType: null,
            showStar: true,
            showReply: true,
            showUnread: false
        },
        sendScroll: null,
        // 正文内存缓存：emailId → { content, text } 或 Promise（加载中）
        contentMap: {},
    }),
    persist: {
        pick: ['contentData'],
    },
    actions: {
        // 按需加载正文，带去重（同 emailId 并发请求复用同一 Promise）
        async loadContent(emailId) {
            const id = Number(emailId);
            // 已缓存（含加载中的 Promise）直接返回
            if (this.contentMap[id]) {
                return this.contentMap[id];
            }
            // 发起请求并存 Promise，完成后替换为实际数据
            const promise = emailContent(id).then(res => {
                // axios 拦截器已解包：res 即 { content, text }，无需再取 .data
                const data = res || { content: '', text: '' };
                this.contentMap[id] = data;
                return data;
            }).catch(e => {
                // 失败时清除，允许重试
                delete this.contentMap[id];
                throw e;
            });
            this.contentMap[id] = promise;
            return promise;
        },
    },
})
