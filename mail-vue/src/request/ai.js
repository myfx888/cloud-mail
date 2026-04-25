import http from '@/axios/index.js';

export function aiSummarize(emailId) {
    return http.post('/ai/summarize', { emailId })
}

export function aiTranslate(emailId, targetLang) {
    return http.post('/ai/translate', { emailId, targetLang })
}

export function aiConversationList() {
    return http.get('/ai/conversations')
}

export function aiConversationDelete(id) {
    return http.delete('/ai/conversations' + (id ? `?id=${id}` : ''))
}

export function aiTestConnection() {
    return http.post('/ai/test-connection')
}

// SSE chat — uses native fetch, not axios (axios doesn't support streaming)
export function aiChatStream(message, options = {}) {
    const baseUrl = import.meta.env.VITE_BASE_URL;
    const token = localStorage.getItem('token');

    const controller = new AbortController();

    const fetchPromise = fetch(`${baseUrl}/ai/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify({
            message,
            currentEmailId: options.currentEmailId,
            history: options.history || []
        }),
        signal: controller.signal
    });

    return { fetchPromise, controller };
}

// Parse SSE stream
export async function* parseSSEStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (!data) continue;
                    try {
                        const parsed = JSON.parse(data);
                        yield parsed;
                    } catch {}
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
