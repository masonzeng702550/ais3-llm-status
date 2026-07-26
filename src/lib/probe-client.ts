/**
 * The actual network probes.
 *
 * Hard rule: model output never leaves this module. Callers receive timings,
 * status codes and a boolean — never the response body. Everything this
 * module returns ends up in a public Git repository.
 */
import type { ComponentConfig, ErrorKind } from './types.ts';

export interface Attempt {
  ok: boolean;
  latencyMs: number | null;
  ttftMs: number | null;
  code: number | null;
  error: ErrorKind | null;
}

export interface ApiConfig {
  baseUrl: string;
  userAgent: string;
}

function classifyHttp(code: number): ErrorKind {
  if (code === 401) return 'http_401';
  if (code === 403) return 'http_403';
  if (code === 429) return 'http_429';
  if (code >= 500) return 'http_5xx';
  return 'http_4xx';
}

function classifyThrown(err: unknown): ErrorKind {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'network';
}

/**
 * Strip anything that looks like a bearer token out of a string before it can
 * reach a log line or a workflow annotation.
 */
export function redact(input: string): string {
  return input.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***').replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

export async function probeComponent(
  component: ComponentConfig,
  api: ApiConfig,
  apiKey: string,
): Promise<Attempt> {
  if (component.probeType === 'http') return httpProbe(component, api, apiKey);
  return chatProbe(component, api, apiKey);
}

async function httpProbe(c: ComponentConfig, api: ApiConfig, apiKey: string): Promise<Attempt> {
  const started = performance.now();
  const headers: Record<string, string> = { 'user-agent': api.userAgent };
  if (c.auth) headers.authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(c.url as string, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    const body = await res.text();
    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      return { ok: false, latencyMs, ttftMs: null, code: res.status, error: classifyHttp(res.status) };
    }
    if (body.trim().length === 0) {
      return { ok: false, latencyMs, ttftMs: null, code: res.status, error: 'bad_response' };
    }
    return { ok: true, latencyMs, ttftMs: null, code: res.status, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      ttftMs: null,
      code: null,
      error: classifyThrown(err),
    };
  }
}

async function chatProbe(c: ComponentConfig, api: ApiConfig, apiKey: string): Promise<Attempt> {
  const started = performance.now();
  const since = () => Math.round(performance.now() - started);

  const body = JSON.stringify({
    model: c.model,
    messages: [{ role: 'user', content: c.prompt }],
    max_tokens: c.maxTokens,
    temperature: c.temperature,
    stream: c.stream,
  });

  let res: Response;
  try {
    res = await fetch(`${api.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: c.stream ? 'text/event-stream' : 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': api.userAgent,
      },
      body,
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    return { ok: false, latencyMs: since(), ttftMs: null, code: null, error: classifyThrown(err) };
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, latencyMs: since(), ttftMs: null, code: res.status, error: classifyHttp(res.status) };
  }

  return c.stream ? readStream(res, since) : readJson(res, since);
}

/**
 * Pull whatever text a choice carries, in any of the shapes this gateway uses.
 *
 * Reasoning models (nemotron-cascade, gemma-4-12b) stream `reasoning_content`
 * and only switch to `content` once they finish thinking — which, at
 * max_tokens=16, they never do. Counting only `content` reported those models
 * as permanently down while they were working perfectly well.
 */
function extractText(choice: any): string {
  const candidates = [
    choice?.delta?.content,
    choice?.delta?.reasoning_content,
    choice?.message?.content,
    choice?.message?.reasoning_content,
    choice?.text,
  ];
  return candidates.find((c) => typeof c === 'string' && c.length > 0) ?? '';
}

async function readJson(res: Response, since: () => number): Promise<Attempt> {
  try {
    const json = (await res.json()) as any;
    const content = extractText(json?.choices?.[0]);
    const latencyMs = since();
    return content.trim().length > 0
      ? { ok: true, latencyMs, ttftMs: null, code: res.status, error: null }
      : { ok: false, latencyMs, ttftMs: null, code: res.status, error: 'bad_response' };
  } catch (err) {
    return { ok: false, latencyMs: since(), ttftMs: null, code: res.status, error: classifyThrown(err) };
  }
}

/**
 * Parse the SSE stream, measuring time-to-first-token.
 *
 * Availability is judged on "did any content come back at all", not on whether
 * the model said the magic word. A dead inference worker behind a healthy
 * gateway returns HTTP 200 with an empty completion — that is the failure this
 * check exists to catch. Penalising a chatty-but-working model would just
 * generate false alarms.
 */
async function readStream(res: Response, since: () => number): Promise<Attempt> {
  if (!res.body) {
    return { ok: false, latencyMs: since(), ttftMs: null, code: res.status, error: 'bad_response' };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let ttftMs: number | null = null;
  let sawData = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        sawData = true;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const chunk = JSON.parse(payload) as any;
          const piece = extractText(chunk?.choices?.[0]);
          if (piece.length > 0) {
            if (ttftMs === null) ttftMs = since();
            content += piece;
          }
        } catch {
          // A malformed chunk is not fatal on its own; an entirely unusable
          // stream is caught by the emptiness check below.
        }
      }
    }
  } catch (err) {
    // Dying part-way through a stream is a distinct failure from never
    // connecting: the gateway accepted us and then stopped feeding tokens.
    const kind = sawData ? 'sse_stall' : classifyThrown(err);
    return { ok: false, latencyMs: since(), ttftMs, code: res.status, error: kind };
  } finally {
    reader.releaseLock();
  }

  const latencyMs = since();
  if (content.trim().length === 0) {
    return { ok: false, latencyMs, ttftMs, code: res.status, error: 'bad_response' };
  }
  return { ok: true, latencyMs, ttftMs, code: res.status, error: null };
}
