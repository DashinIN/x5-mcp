import { z } from 'zod';
import { dateSchema, type Config } from '../config/env.js';
import { decodeHistory } from './decoder.js';
import { AppError, X5AuthenticationError, X5RateLimitError, X5RequestError } from './errors.js';
import type { X5Client, X5HistoryRequest } from './types.js';

const requestSchema = z.object({ page: z.number().int().nonnegative(), type: z.literal('receipts'),
  from: dateSchema, to: dateSchema, codeTc: z.string().regex(/^(D|S|VK|SL|VP)(,(D|S|VK|SL|VP))*$/),
}).refine(v => v.from <= v.to);

export class HttpX5Client implements X5Client {
  constructor(private readonly config: Config, private readonly fetcher: typeof fetch = fetch) {}
  async getReceiptHistory(input: X5HistoryRequest, signal?: AbortSignal) {
    return (await this.probe(input, signal)).history;
  }
  async probe(input: X5HistoryRequest, signal?: AbortSignal) {
    if (!this.config.cookie) throw new X5AuthenticationError();
    if (!requestSchema.safeParse(input).success) throw new AppError('INPUT', 'Неверный диапазон дат или параметры запроса.');
    try {
      const response = await this.fetcher('https://x5club.ru/lk/history.data', {
        method: 'POST', redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]) : AbortSignal.timeout(this.config.timeoutMs),
        headers: { accept: '*/*', 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          cookie: this.config.cookie, origin: 'https://x5club.ru', referer: 'https://x5club.ru/' },
        body: new URLSearchParams({ ...input, page: String(input.page) }),
      });
      if ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400)) throw new X5AuthenticationError();
      if (response.status === 429) throw new X5RateLimitError();
      if (!response.ok) throw new X5RequestError();
      // Bound response memory; the fetch timeout remains active while consuming the body.
      const reader = response.body?.getReader();
      if (!reader) throw new X5RequestError();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 10 * 1024 * 1024) { await reader.cancel(); throw new X5RequestError(); }
        chunks.push(value);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0] || 'unknown';
      const history = await decodeHistory(new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }));
      return { status: response.status, contentType, bodyBytes: bytes, history };
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Синхронизация отменена. Уже сохранённые страницы доступны локально.');
      if (error instanceof AppError) throw error;
      throw new X5RequestError();
    }
  }
}
