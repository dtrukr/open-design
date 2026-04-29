/**
 * OpenAI-compatible streaming client. Covers any endpoint that speaks the
 * `/chat/completions` SSE wire format — OpenAI proper, OpenRouter,
 * LiteLLM proxy, DeepSeek, Groq, Together, Mistral. Azure has its own
 * URL shape and lives in azure.ts.
 *
 * Browser fetch is fine here for the same BYOK reason streamMessage()
 * uses dangerouslyAllowBrowser: this is a local-first tool, the key is
 * the user's, it never leaves their machine. Move to a server proxy if
 * you ever ship a hosted build.
 */
import type { AppConfig, ChatMessage } from '../types';
import type { StreamHandlers } from './anthropic';

export async function streamOpenAI(
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
  if (!cfg.baseUrl) {
    handlers.onError(new Error('Missing base URL — open Settings and set one.'));
    return;
  }

  const url = joinUrl(cfg.baseUrl, '/chat/completions');
  const body = {
    model: cfg.model,
    stream: true,
    max_tokens: 8192,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  await streamChatCompletions(url, cfg.apiKey, body, signal, handlers, 'bearer');
}

// Shared SSE pump between the OpenAI and Azure clients — they only differ
// in URL shape and auth header.
export async function streamChatCompletions(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  handlers: StreamHandlers,
  auth: 'bearer' | 'azure',
): Promise<void> {
  let acc = '';
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
    else headers['api-key'] = apiKey;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
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

    streamLoop: while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line. The SSE spec permits LF or
      // CRLF, so split on /\r?\n\r?\n/ — splitting on '\n\n' alone breaks
      // for any upstream that emits CRLF (some Cloudflare-fronted proxies,
      // certain LiteLLM configs, Azure on a bad day). The trailing partial
      // frame stays in buf for the next read.
      while (true) {
        const m = buf.match(/\r?\n\r?\n/);
        if (!m || m.index === undefined) break;
        const idx = m.index;
        const frame = buf.slice(0, idx).replace(/\r/g, '').trim();
        buf = buf.slice(idx + m[0].length);
        if (!frame) continue;
        // Each frame is one or more `data: ...` lines plus optional
        // `event:` / comments. We only care about `data:` payloads.
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            // Stop reading — a misbehaving / proxied endpoint may keep
            // the SSE socket open after [DONE] and we don't want the
            // client to block on a half-open stream.
            break streamLoop;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = extractDelta(parsed);
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

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { delta?: { content?: unknown }; text?: unknown };
  if (first?.delta && typeof first.delta.content === 'string') {
    return first.delta.content;
  }
  // Some legacy / completion-style proxies emit `text` instead of delta.
  if (typeof first?.text === 'string') return first.text;
  // Non-text deltas (delta.tool_calls, delta.function_call,
  // delta.reasoning_content for DeepSeek-R1 / OpenAI o-series) are not
  // bridged into the Anthropic-shaped message stream the rest of the app
  // consumes — the OpenAI/Azure/Google paths are text-only today. The
  // limitation is documented in Settings (`settings.providerHint`) and
  // the README provider table.
  return '';
}

// Map upstream HTTP failures to a one-line message a BYOK user can act on
// without scrolling a JSON wall. The raw status + body are preserved as
// a tail so the developer console still has the full context.
export function classifyHttpError(status: number, body: string): string {
  const tail = body ? ` — ${truncate(body, 240)}` : '';
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}) — check the API key in Settings.${tail}`;
  }
  if (status === 404) {
    return `Endpoint not found (404) — verify the Base URL and model id.${tail}`;
  }
  if (status === 429) {
    return `Rate-limited (429) — try a smaller model or wait a moment.${tail}`;
  }
  if (status >= 500) {
    return `Upstream error (${status}) — try again.${tail}`;
  }
  return `upstream ${status}: ${body || 'no body'}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
