import { decode } from 'turbo-stream';
import { X5AuthenticationError, X5DecodeError, X5UnexpectedResponseError } from './errors.js';
import type { DecodedHistory } from './types.js';

function extract(value: unknown): DecodedHistory {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  const matches: DecodedHistory[] = [];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (seen.size > 10000) throw new X5DecodeError();
    const obj = node as Record<string, unknown>;
    if ('additionalReceiptsResponse' in obj) {
      if (!Array.isArray(obj.additionalReceiptsResponse)) throw new X5UnexpectedResponseError();
      matches.push({ receipts: obj.additionalReceiptsResponse,
        ...(typeof obj.isNewData === 'boolean' ? { isNewData: obj.isNewData } : {}) });
    } else if (!Array.isArray(node)) queue.push(...Object.values(obj));
  }
  if (matches.length !== 1) throw new X5UnexpectedResponseError();
  return matches[0]!;
}

export async function decodeHistory(response: Response): Promise<DecodedHistory> {
  const text = await response.text();
  if (/^\s*</.test(text)) throw new X5AuthenticationError();
  let decoded: unknown;
  let json = false;
  try { decoded = JSON.parse(text); json = true; } catch { /* stream framing is not JSON */ }
  // Turbo-stream v2's root is a flattened array, even when it is valid JSON.
  if (!json || Array.isArray(decoded)) {
    try {
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
      const result = await decode(stream, { plugins: [(type, ...values) => {
        if (type === 'SingleFetchRedirect') throw new X5AuthenticationError();
        if (type === 'SanitizedError' || type === 'ErrorResponse') throw new X5UnexpectedResponseError();
        if (type === 'SingleFetchClassInstance') return { value: values[0] };
        if (type === 'SingleFetchFallback') return { value: undefined };
        return undefined;
      }] });
      await result.done;
      decoded = result.value;
    } catch (error) {
      if (error instanceof X5AuthenticationError || error instanceof X5UnexpectedResponseError) throw error;
      throw new X5DecodeError();
    }
  }
  return extract(decoded);
}
