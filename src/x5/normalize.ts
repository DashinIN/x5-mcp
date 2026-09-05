import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Receipt, ReceiptItem } from './types.js';

const scalar = z.union([z.string(), z.number().finite()]);
const optionalScalar = scalar.nullish();
const rawItem = z.object({
  pluId: optionalScalar, name: z.string().min(1), quantity: scalar,
  unit: z.string().nullish(), priceRegular: optionalScalar, pricePromo: optionalScalar,
  priceItem: optionalScalar, categoryCode: optionalScalar, main_photo: z.string().nullish(),
});
const rawReceipt = z.object({
  rtlTxnId: optionalScalar, created: z.string().min(1), codeTc: optionalScalar,
  title: z.string().nullish(), storeId: optionalScalar, storeAddress: z.string().nullish(),
  amountRegular: optionalScalar, amountPromo: optionalScalar,
  checkNum: optionalScalar, fiscalNum: optionalScalar, ofdurl: z.string().nullish(),
  items: z.array(rawItem),
});
const invalid = () => new AppError('X5_NORMALIZE', 'Структура чека или числовое значение не соответствует контракту ADR. Страница не сохранена.');
const str = (v: string | number | null | undefined): string | null => v == null || v === '' ? null : String(v);

export function toMinorUnits(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw invalid();
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  const result = Number(negative ? -minor : minor);
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
}
function difference(regular: number | null, paid: number | null) {
  if (regular === null || paid === null) return null;
  const value = regular - paid;
  if (!Number.isSafeInteger(value)) throw invalid();
  return value;
}
function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

export function normalizeReceipt(input: unknown): Receipt {
  const parsed = rawReceipt.safeParse(input);
  if (!parsed.success) throw invalid();
  const r = parsed.data;
  // Require ISO; timezone-less timestamps are explicitly interpreted as Moscow time.
  const created = r.created.length === 10 ? `${r.created}T00:00:00+03:00`
    : /(?:Z|[+-]\d\d:\d\d)$/.test(r.created) ? r.created : `${r.created}+03:00`;
  if (!z.iso.datetime({ offset: true }).safeParse(created).success) throw invalid();
  const instant = new Date(created);
  const createdAt = instant.toISOString();
  const purchaseDate = new Date(instant.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const transactionId = str(r.rtlTxnId);
  const networkCode = str(r.codeTc);
  const fiscalNumber = str(r.fiscalNum);
  const checkNumber = str(r.checkNum);
  if (!transactionId && (!networkCode || !fiscalNumber || !checkNumber)) throw invalid();
  const id = transactionId ?? `fallback:${createHash('sha256').update(JSON.stringify([networkCode, fiscalNumber, checkNumber, createdAt])).digest('hex')}`;
  const totalRegular = toMinorUnits(r.amountRegular);
  const totalPaid = toMinorUnits(r.amountPromo);
  const items: ReceiptItem[] = r.items.map(i => {
    const quantityText = String(i.quantity).replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(quantityText)) throw invalid();
    const quantity = Number(quantityText);
    if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 1_000_000) throw invalid();
    const regularPrice = toMinorUnits(i.priceRegular);
    const paidPrice = toMinorUnits(i.pricePromo);
    // Do not substitute regularPrice when the actual price is absent.
    // priceItem semantics are unverified; retained separately, never used in spending.
    return { pluId: str(i.pluId), name: i.name, quantity, unit: i.unit ?? null,
      regularPrice, paidPrice, linePaid: toMinorUnits(i.priceItem), discount: difference(regularPrice, paidPrice),
      categoryCode: str(i.categoryCode), imageUrl: safeUrl(i.main_photo) };
  });
  return { id, transactionId, createdAt, purchaseDate, networkCode, title: r.title ?? null,
    storeId: str(r.storeId), storeAddress: r.storeAddress ?? null, totalRegular, totalPaid,
    discount: difference(totalRegular, totalPaid), checkNumber, fiscalNumber, ofdUrl: safeUrl(r.ofdurl), items };
}
