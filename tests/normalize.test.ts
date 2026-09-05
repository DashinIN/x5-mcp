import { describe, it, expect } from 'vitest';
import { normalizeReceipt, toMinorUnits } from '../src/x5/normalize.js';
import { raw } from './helpers.js';

describe('normalization', () => {
  it.each([['109.99', 10999], ['0.29', 29], ['-1.01', -101], ['3,5', 350], ['0', 0]])('converts %s exactly', (value, expected) => {
    expect(toMinorUnits(value)).toBe(expected);
  });
  it.each(['1.001', 'NaN', '1e3', '999999999999999999'])('rejects invalid money %s', value => expect(() => toMinorUnits(value)).toThrow());
  it('normalizes multiple quantities, prices, identity and date', () => {
    const receipt = normalizeReceipt(raw);
    expect(receipt).toMatchObject({ id: 'synthetic-001', totalPaid: 21998, discount: 4002, createdAt: '2026-08-12T15:30:00.000Z' });
    expect(receipt.items[0]).toMatchObject({ quantity: 2, paidPrice: 10999, linePaid: 21998 });
  });
  it('preserves missing promo/category and fractional quantity', () => {
    const r = normalizeReceipt({ ...raw, items: [{ name: 'Весовой товар', quantity: '0,375', priceRegular: '10.00' }] });
    expect(r.items[0]).toMatchObject({ quantity: 0.375, paidPrice: null, categoryCode: null, discount: null });
  });
  it('keeps zero promo price', () => {
    expect(normalizeReceipt({ ...raw, items: [{ ...raw.items[0], pricePromo: '0' }] }).items[0]?.paidPrice).toBe(0);
  });
  it('uses stable fallback and refuses incomplete identity', () => {
    const r = { ...raw, rtlTxnId: undefined };
    expect(normalizeReceipt(r).id).toBe(normalizeReceipt(r).id);
    expect(() => normalizeReceipt({ ...r, fiscalNum: undefined })).toThrow();
  });
  it('rejects missing items instead of deleting cached detail', () => {
    expect(() => normalizeReceipt({ ...raw, items: undefined })).toThrow();
  });
  it('groups timestamps at midnight in Moscow', () => {
    expect(normalizeReceipt({ ...raw, created: '2026-08-31T23:00:00Z' }).purchaseDate).toBe('2026-09-01');
  });
});
