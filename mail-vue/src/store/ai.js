import { defineStore } from 'pinia'
import { aiChatStream, parseSSEStream } from '@/request/ai.js'

export const useAiStore = defineStore('ai', {
    state: () => ({
        sidebarOpen: false,
        messages: [],        // [{ role, content, toolCalls?, timestamp, isError? }]
        isStreaming: false,
        currentEmailId: null,
        abortController: null,
        streamingContent: '',
        streamingToolCalls: []
    }),
    actions: {
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
        },

        setCurrentEmail(emailId) {
            this.currentEmailId = emailId;
        },

        async sendMessage(text) {
            if (this.isStreaming) return;
            if (!text.trim()) return;

            // Add user message
            this.messages.push({
                role: 'user',
                content: text,
                timestamp: new Date().toISOString()
            });

            this.isStreaming = true;
            this.streamingContent = '';
            this.streamingToolCalls = [];

            // Build history (last 20 messages for context)
            const history = this.messages.slice(-21, -1).map(m => ({
                role: m.role,
                content: m.content
            }));

            const { fetchPromise, controller } = aiChatStream(text, {
                currentEmailId: this.currentEmailId,
                history
            });

            this.abortController = controller;

            try {
                const response = await fetchPromise;

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ message: 'AI request failed' }));
                    this.messages.push({
                        role: 'assistant',
                        content: errData.message || 'Error communicating with AI',
                        isError: true,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }

                for await (const event of parseSSEStream(response)) {
                    if (event.type === 'text') {
                        this.streamingContent += event.content;
                    } else if (event.type === 'tool_call') {
                        this.streamingToolCalls.push({
                            name: event.name,
                            status: event.status,
                            error: event.error
                        });
                    } else if (event.type === 'error') {
                        this.streamingContent += `\n\nError: ${event.message}`;
                    } else if (event.type === 'done') {
                        break;
                    }
                }

                // Commit assistant message
                if (this.streamingContent || this.streamingToolCalls.length) {
                    this.messages.push({
                        role: 'assistant',
                        content: this.streamingContent,
                        toolCalls: [...this.streamingToolCalls],
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                if (e.name !== 'AbortError') {
                    this.messages.push({
                        role: 'assistant',
                        content: 'Connection error: ' + e.message,
                        isError: true,
                        timestamp: new Date().toISOString()
                    });
                }
            } finally {
                this.isStreaming = false;
                this.streamingContent = '';
                this.streamingToolCalls = [];
                this.abortController = null;
            }
        },

        stopStreaming() {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
        },

        async sendQuickAction(text, emailId) {
            const { useUiStore } = await import('@/store/ui.js');
            const uiStore = useUiStore();
            this.currentEmailId = emailId;
            uiStore.aiSidebarOpen = true;
            await new Promise(r => setTimeout(r, 100));
            await this.sendMessage(text);
        },

        clearMessages() {
            this.messages = [];
            this.streamingContent = '';
            this.streamingToolCalls = [];
        }
    }
})
