import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { ReceiptsRepository } from '../src/db/receipts.repository.js';
import { SyncService, monthRanges } from '../src/sync/sync-history.js';
import type { X5Client } from '../src/x5/types.js';
import { config, raw } from './helpers.js';

const databases: ReturnType<typeof openDatabase>[] = [];
function setup(client: X5Client, maxPages = 1000) {
  const db = openDatabase(':memory:'); databases.push(db);
  const repository = new ReceiptsRepository(db);
  return { db, repository, service: new SyncService({ ...config(), maxPages }, client, repository) };
}
const period = { from: '2026-08-01', to: '2026-08-31' };
afterEach(() => databases.splice(0).forEach(db => db.close()));
describe('monthly sync', () => {
  it('splits leap years and partial months', () => {
    expect(monthRanges('2024-02-15', '2024-03-02')).toEqual([{ from: '2024-02-15', to: '2024-02-29' }, { from: '2024-03-01', to: '2024-03-02' }]);
    expect(() => monthRanges('2026-02-30', '2026-03-02')).toThrow();
    expect(() => monthRanges('2026-03-02', '2026-03-01')).toThrow();
  });
  it('paginates until empty and is idempotent', async () => {
    const getReceiptHistory = vi.fn<X5Client['getReceiptHistory']>().mockImplementation(async ({ page }) => ({ receipts: page === 0 ? [raw] : [] }));
    const { service, repository } = setup({ getReceiptHistory });
    expect(await service.sync(period)).toMatchObject({ monthsProcessed: 1, pagesProcessed: 2, receiptsInserted: 1 });
    expect(await service.sync(period)).toMatchObject({ receiptsInserted: 0, receiptsUpdated: 1 });
    expect(repository.getRecentReceipts(10)).toHaveLength(1);
    expect(getReceiptHistory.mock.calls.map(([r]) => r.page)).toEqual([0, 1, 0, 1]);
  });
  it('retains committed pages on failure without marking coverage complete', async () => {
    const getReceiptHistory = vi.fn<X5Client['getReceiptHistory']>().mockResolvedValueOnce({ receipts: [raw] }).mockRejectedValue(new Error('secret'));
    const { service, db, repository } = setup({ getReceiptHistory });
    await expect(service.sync(period)).rejects.toThrow();
    expect(repository.getRecentReceipts(10)).toHaveLength(1);
    expect(db.prepare('SELECT status, error_code FROM sync_runs').get()).toEqual({ status: 'failed', error_code: 'INTERNAL_ERROR' });
    expect(db.prepare('SELECT * FROM sync_lock').all()).toEqual([]);
  });
  it('rejects repeated pages and page limits', async () => {
    const client = { getReceiptHistory: vi.fn<X5Client['getReceiptHistory']>().mockResolvedValue({ receipts: [raw] }) };
    await expect(setup(client).service.sync(period)).rejects.toMatchObject({ code: 'X5_PAGINATION' });
    await expect(setup(client, 1).service.sync(period)).rejects.toMatchObject({ code: 'X5_PAGE_LIMIT' });
  });
  it('requires initial dates and refuses outside-range receipts', async () => {
    const { service } = setup({ getReceiptHistory: async () => ({ receipts: [raw] }) });
    await expect(service.sync({})).rejects.toMatchObject({ code: 'INPUT' });
    await expect(service.sync({ from: '2026-07-01', to: '2026-07-31' })).rejects.toMatchObject({ code: 'X5_RANGE' });
  });
  it('prevents concurrent sync on the same database', async () => {
    const { service, db } = setup({ getReceiptHistory: async () => ({ receipts: [] }) });
    db.prepare('INSERT INTO sync_lock VALUES (1, ?, ?)').run('other-process', Date.now() + 10000);
    await expect(service.sync(period)).rejects.toMatchObject({ code: 'SYNC_BUSY' });
  });
  it('honors cancellation and releases its lock', async () => {
    const { service, db } = setup({ getReceiptHistory: async () => ({ receipts: [] }) });
    const abort = new AbortController(); abort.abort();
    await expect(service.sync(period, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(db.prepare('SELECT * FROM sync_lock').all()).toEqual([]);
  });
});
