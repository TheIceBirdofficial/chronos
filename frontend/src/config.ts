const isDev = process.env.NODE_ENV === 'development';
export const API_BASE = isDev 
  ? 'http://localhost:5000' 
  : (process.env.NEXT_PUBLIC_API_URL || 'https://chronos-backend-410257364704.europe-west1.run.app');

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  let uid = localStorage.getItem('chronos_user_id');
  if (!uid) {
    uid = generateUUID();
    localStorage.setItem('chronos_user_id', uid);
  }
  return uid;
}

export function isPlaceholderTwin(twin: string | null | undefined): boolean {
  if (!twin || !twin.trim()) return true;
  return /ONBOARDING\s+PENDING|Awaiting identity scan/i.test(twin);
}

export function isRealUsername(name: string | null | undefined): boolean {
  return !!name && name.trim().length > 0 && name.toLowerCase() !== 'user';
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// SSE streaming helper for AI chat
export async function streamAiChat(
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = localStorage.getItem('chronos-ai-config')
    ? JSON.parse(localStorage.getItem('chronos-ai-config')!).apiKey
    : '';
  const apiUrl = localStorage.getItem('chronos-ai-config')
    ? JSON.parse(localStorage.getItem('chronos-ai-config')!).apiUrl
    : 'https://integrate.api.nvidia.com/v1';
  const model = localStorage.getItem('chronos-ai-config')
    ? JSON.parse(localStorage.getItem('chronos-ai-config')!).model
    : 'meta/llama-3.1-8b-instruct';

  const res = await fetch(`${API_BASE}/api/ai/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'nvidia', apiUrl, apiKey, model, messages }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Stream request failed');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            fullContent += choice.delta.content;
            onChunk(choice.delta.content);
          }
          if (choice?.finish_reason === 'stop') break;
        } catch { /* skip malformed chunks */ }
      }
    }
  }

  return fullContent;
}

if (typeof window !== 'undefined') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : 'url' in input ? input.url : '';
    if (url && url.startsWith(API_BASE)) {
      const headers = new Headers(init?.headers);
      if (!headers.has('X-User-Id')) {
        headers.set('X-User-Id', getUserId());
      }
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}
