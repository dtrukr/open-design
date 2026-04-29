/**
 * Google Generative Language API streaming client (Gemini direct). The
 * REST surface is at generativelanguage.googleapis.com and the key is
 * sent via the `x-goog-api-key` header — putting it in the URL query
 * string would leak it into DevTools Network, browser history on
 * redirect, the HTTP referer chain, and any logging proxy in between.
 * We hit `:streamGenerateContent` with `alt=sse` so the response arrives
 * as a server-sent event stream we can pump like the OpenAI one.
 *
 * Today this client is text-only: `parts[*].text` is bridged through and
 * `parts[*].functionCall` (Gemini tool use) plus `parts[*].inlineData`
 * (vision/audio) are dropped on the floor. The same limitation applies
 * to the OpenAI client. Surfaced in Settings (`settings.providerHint`)
 * and the README provider table.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';
import { classifyHttpError } from './openai';

export async function streamGoogle(
  cfg: AppConfig,
  system: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  if (!cfg.apiKey) {
    handlers.onError(new Error('Missing API key — open Settings and paste one in.'));
    return;
  }
  if (!cfg.model) {
    handlers.onError(new Error('Missing model — set one in Settings.'));
    return;
  }

  const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;

  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // `systemInstruction` on Gemini's REST surface takes `{ parts: [...] }`
  // — `role` is generally ignored at this position and some endpoints
  // reject it outright, so we leave it off.
  const body: Record<string, unknown> = { contents };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  let acc = '';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      handlers.onError(new Error(classifyHttpError(resp.status, text)));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE permits CRLF between frames — split on /\r?\n\r?\n/ so
      // CRLF-emitting upstreams (Cloudflare-fronted proxies, certain
      // LiteLLM configs) are handled the same as bare-LF ones.
      while (true) {
        const m = buf.match(/\r?\n\r?\n/);
        if (!m || m.index === undefined) break;
        const idx = m.index;
        const frame = buf.slice(0, idx).replace(/\r/g, '').trim();
        buf = buf.slice(idx + m[0].length);
        if (!frame) continue;
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = extractGeminiText(parsed);
          if (delta) {
            acc += delta;
            handlers.onDelta(delta);
          }
        }
      }
    }
    handlers.onDone(acc);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handlers.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    if (typeof p?.text === 'string') out += p.text;
  }
  return out;
}
