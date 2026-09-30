import { setTimeout as sleep } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly retryable = false,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 PhoenixJobSearch/0.1';

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 30_000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, application/rss+xml, text/xml, text/html;q=0.8, */*;q=0.5',
          ...opts.headers,
        },
        body: opts.body,
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, url, true);
      if (!res.ok) throw new HttpError(res.status, url, false);
      return await res.text();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof HttpError ? err.retryable : true;
      if (!retryable || attempt === retries) break;
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
}
