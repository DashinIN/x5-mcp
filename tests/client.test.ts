import { describe, expect, it, vi } from 'vitest';
import { HttpX5Client } from '../src/x5/client.js';
import { safeError } from '../src/x5/errors.js';
import { config, raw } from './helpers.js';

const request = { from: '2026-08-01', to: '2026-08-31', page: 0, type: 'receipts' as const, codeTc: 'D,S' };
describe('HTTP client', () => {
  it('sends the ADR form and minimal headers without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ additionalReceiptsResponse: [raw] }));
    const response = await new HttpX5Client(config(), fetcher).getReceiptHistory(request);
    expect(response.receipts).toHaveLength(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://x5club.ru/lk/history.data');
    expect(options?.redirect).toBe('manual');
    expect(options?.body?.toString()).toBe('from=2026-08-01&to=2026-08-31&page=0&type=receipts&codeTc=D%2CS');
    expect((options?.headers as Record<string, string>).cookie).toBe('synthetic-cookie');
  });
  it.each([[401, 'X5_AUTH'], [403, 'X5_AUTH'], [302, 'X5_AUTH'], [429, 'X5_RATE_LIMIT'], [500, 'X5_REQUEST']])('handles HTTP %i', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-response', { status: Number(status) }));
    await expect(new HttpX5Client(config(), fetcher).getReceiptHistory(request)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not expose fetch errors containing secrets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-cookie JWT private-response'));
    try { await new HttpX5Client(config(), fetcher).getReceiptHistory(request); }
    catch (error) { expect(JSON.stringify(safeError(error))).not.toMatch(/synthetic-cookie|JWT|private-response/); }
  });
  it('does not send unauthenticated or invalid requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new HttpX5Client({ ...config(), cookie: '' }, fetcher).getReceiptHistory(request)).rejects.toMatchObject({ code: 'X5_AUTH' });
    await expect(new HttpX5Client(config(), fetcher).getReceiptHistory({ ...request, from: '2026-02-30' })).rejects.toMatchObject({ code: 'INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
