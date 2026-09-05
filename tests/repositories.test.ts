import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { ReceiptsRepository } from '../src/db/receipts.repository.js';
import { AnalyticsRepository } from '../src/db/analytics.repository.js';
import { normalizeReceipt } from '../src/x5/normalize.js';
import { raw } from './helpers.js';

const databases: ReturnType<typeof openDatabase>[] = [];
function setup() {
  const db = openDatabase(':memory:'); databases.push(db);
  return { db, receipts: new ReceiptsRepository(db), analytics: new AnalyticsRepository(db) };
}
afterEach(() => databases.splice(0).forEach(db => db.close()));
describe('SQLite repositories', () => {
  it('upserts and replaces items without duplicates', () => {
    const { db, receipts } = setup();
    expect(receipts.saveReceipts([normalizeReceipt(raw)])).toEqual({ inserted: 1, updated: 0, items: 1 });
    expect(receipts.saveReceipts([normalizeReceipt({ ...raw, items: [...raw.items, ...raw.items] })])).toEqual({ inserted: 0, updated: 1, items: 2 });
    expect(receipts.getRecentReceipts(10)).toHaveLength(1);
    expect(db.prepare('SELECT * FROM receipt_items').all()).toHaveLength(2);
  });
  it('sums receipt totals once and retains missing totals', () => {
    const { receipts, analytics } = setup();
    receipts.saveReceipts([normalizeReceipt({ ...raw, items: [...raw.items, ...raw.items] }), normalizeReceipt({ ...raw, rtlTxnId: 'unknown', amountPromo: null })]);
    expect(analytics.getSpending({ from: '2026-08-01', to: '2026-08-31' }).totals)
      .toMatchObject({ total_minor: 21998, receipts_count: 2, unknown_total_count: 1 });
  });
  it('searches Cyrillic case/ё and treats SQL wildcards literally', () => {
    const { receipts, analytics } = setup(); receipts.saveReceipts([normalizeReceipt(raw)]);
    expect(analytics.searchPurchases({ query: 'ЧЕРНЫЙ', limit: 10, offset: 0 })).toHaveLength(1);
    expect(analytics.searchPurchases({ query: '%', limit: 10, offset: 0 })).toHaveLength(0);
    expect(analytics.searchPurchases({ query: "' OR 1=1 --", limit: 10, offset: 0 })).toHaveLength(0);
  });
  it('filters product history and networks', () => {
    const { receipts, analytics } = setup(); receipts.saveReceipts([normalizeReceipt(raw)]);
    expect(analytics.getProductHistory({ pluId: 'coffee-001', limit: 10, offset: 0 }).purchases).toHaveLength(1);
    expect(analytics.getProductHistory({ pluId: 'coffee-001', network: 'S', limit: 10, offset: 0 }).purchases).toHaveLength(0);
  });
  it('rolls back a failed page transaction', () => {
    const { receipts } = setup();
    const bad = normalizeReceipt({ ...raw, rtlTxnId: 'broken' }); bad.items[0]!.quantity = NaN;
    expect(() => receipts.saveReceipts([normalizeReceipt(raw), bad])).toThrow();
    expect(receipts.getRecentReceipts(10)).toHaveLength(0);
  });
  it('compares first/last prices per network without merging different networks', () => {
    const { receipts, analytics } = setup();
    receipts.saveReceipts([
      normalizeReceipt(raw),
      normalizeReceipt({ ...raw, rtlTxnId: 'later', created: '2026-08-20T18:30:00+03:00', items: [{ ...raw.items[0], pricePromo: '120.00' }] }),
      normalizeReceipt({ ...raw, rtlTxnId: 'other-network', codeTc: 'S', created: '2026-08-21T18:30:00+03:00', items: [{ ...raw.items[0], pricePromo: '90.00' }] }),
    ]);
    const result = analytics.getPriceChanges({ from: '2026-08-01', to: '2026-08-31', limit: 10 });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ network_code: 'D', first_price_minor: 10999, last_price_minor: 12000, change_minor: 1001 });
  });
  it('explicitly labels category totals as estimates with unknown prices counted', () => {
    const { receipts, analytics } = setup();
    receipts.saveReceipts([normalizeReceipt({ ...raw, items: [...raw.items, { ...raw.items[0], pricePromo: null }] })]);
    const result = analytics.getCategorySpending({ from: '2026-08-01', to: '2026-08-31' });
    expect(result.isEstimate).toBe(true);
    expect(result.estimates[0]).toMatchObject({ estimated_total_minor: 21998, unknown_price_count: 1 });
  });
  it('groups weeks on Monday and applies inclusive date bounds', () => {
    const { receipts, analytics } = setup(); receipts.saveReceipts([normalizeReceipt(raw)]);
    expect(analytics.getSpending({ from: '2026-08-12', to: '2026-08-12', groupBy: 'week' }).groups[0])
      .toMatchObject({ period: '2026-08-10', total_minor: 21998 });
  });
});
