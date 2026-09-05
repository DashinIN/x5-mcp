import type Database from 'better-sqlite3';
import { searchText } from './receipts.repository.js';

export interface Period { from: string; to: string; network?: string }
export interface PurchaseFilter { from?: string; to?: string; network?: string; categoryCode?: string }
function filters(p: PurchaseFilter) {
  const clauses: string[] = [], values: string[] = [];
  if (p.from) { clauses.push('r.purchase_date >= ?'); values.push(p.from); }
  if (p.to) { clauses.push('r.purchase_date <= ?'); values.push(p.to); }
  if (p.network) { clauses.push('r.network_code = ?'); values.push(p.network); }
  if (p.categoryCode) { clauses.push('i.category_code = ?'); values.push(p.categoryCode); }
  return { where: clauses.length ? clauses.join(' AND ') : '1=1', values };
}
export class AnalyticsRepository {
  constructor(private readonly db: Database.Database) {}
  getSpending(p: Period & { groupBy?: 'day' | 'week' | 'month' }) {
    const { where, values } = filters(p);
    const totals = this.db.prepare(`SELECT SUM(total_paid_minor) AS total_minor, COUNT(*) AS receipts_count,
      COUNT(total_paid_minor) AS priced_receipts_count, COUNT(*)-COUNT(total_paid_minor) AS unknown_total_count,
      ROUND(AVG(total_paid_minor)) AS average_receipt_minor, SUM(discount_minor) AS discount_minor
      FROM receipts r WHERE ${where}`).get(...values);
    const period = p.groupBy === 'day' ? 'purchase_date' : p.groupBy === 'week'
      ? "date(purchase_date, '-' || ((CAST(strftime('%w', purchase_date) AS INTEGER) + 6) % 7) || ' days')"
      : "substr(purchase_date, 1, 7)";
    const groups = this.db.prepare(`SELECT ${period} AS period, SUM(total_paid_minor) AS total_minor,
      COUNT(*) AS receipts_count, COUNT(*)-COUNT(total_paid_minor) AS unknown_total_count
      FROM receipts r WHERE ${where} GROUP BY period ORDER BY period LIMIT 1001`).all(...values);
    return { currency: 'RUB', moneyUnit: 'kopeck', timezone: 'Europe/Moscow', totals, groups: groups.slice(0, 1000), groupsTruncated: groups.length > 1000,
      note: 'Суммы по загруженным чекам; null — неизвестная сумма. Для полноты периода проверьте x5_get_sync_status.' };
  }
  searchPurchases(p: PurchaseFilter & { query: string; limit: number; offset: number }) {
    const { where, values } = filters(p);
    const escaped = searchText(p.query).replace(/[\\%_]/g, '\\$&');
    return this.db.prepare(`SELECT r.id AS receipt_id, r.created_at, r.purchase_date, r.network_code,
      i.plu_id, i.name, i.quantity, i.unit, i.regular_price_minor, i.paid_price_minor, i.category_code
      FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id
      WHERE ${where} AND i.name_search LIKE ? ESCAPE '\\'
      ORDER BY r.created_at DESC, r.id, i.id LIMIT ? OFFSET ?`).all(...values, `%${escaped}%`, p.limit, p.offset);
  }
  getProductHistory(p: PurchaseFilter & { pluId: string; limit: number; offset: number }) {
    const { where, values } = filters(p);
    const base = `FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id WHERE ${where} AND i.plu_id=?`;
    return {
      summary: this.db.prepare(`SELECT r.network_code, i.unit, COUNT(DISTINCT r.id) AS receipts_count,
        SUM(i.quantity) AS quantity, MIN(i.paid_price_minor) AS min_paid_price_minor,
        MAX(i.paid_price_minor) AS max_paid_price_minor, MIN(r.created_at) AS first_purchase,
        MAX(r.created_at) AS last_purchase ${base} GROUP BY r.network_code, i.unit`).all(...values, p.pluId),
      purchases: this.db.prepare(`SELECT r.id AS receipt_id, r.created_at, r.network_code, i.name, i.quantity,
        i.unit, i.paid_price_minor, i.regular_price_minor, i.discount_minor ${base}
        ORDER BY r.created_at DESC, r.id, i.id LIMIT ? OFFSET ?`).all(...values, p.pluId, p.limit, p.offset),
      moneyUnit: 'kopeck', note: 'Сравнивайте одинаковые PLU, сеть и единицу. pricePromo сохранена как цена единицы согласно предварительному контракту; фактическая семантика требует проверки X5.',
    };
  }
  getTopProducts(p: Period & { categoryCode?: string; limit: number }) {
    const { where, values } = filters(p);
    return this.db.prepare(`SELECT i.plu_id, MIN(i.name) AS name, r.network_code, i.unit, i.category_code,
      COUNT(DISTINCT r.id) AS purchases_count, SUM(i.quantity) AS quantity,
      MAX(r.created_at) AS last_purchase FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id
      WHERE ${where} GROUP BY r.network_code, i.plu_id, CASE WHEN i.plu_id IS NULL THEN i.name_search END, i.unit, i.category_code
      ORDER BY purchases_count DESC, name LIMIT ?`).all(...values, p.limit);
  }
  getCategories(p: Period) {
    const { where, values } = filters(p);
    return this.db.prepare(`SELECT i.category_code, COUNT(*) AS item_count, COUNT(DISTINCT r.id) AS receipts_count
      FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id WHERE ${where}
      GROUP BY i.category_code ORDER BY item_count DESC LIMIT 500`).all(...values);
  }
  getCategorySpending(p: Period & { categoryCode?: string }) {
    const { where, values } = filters(p);
    return {
      estimates: this.db.prepare(`SELECT i.category_code, COUNT(*) AS item_count,
        COUNT(*)-COUNT(i.paid_price_minor) AS unknown_price_count,
        SUM(CASE WHEN i.paid_price_minor IS NOT NULL THEN ROUND(i.paid_price_minor*i.quantity) END) AS estimated_total_minor
        FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id WHERE ${where}
        GROUP BY i.category_code ORDER BY estimated_total_minor DESC LIMIT 500`).all(...values),
      moneyUnit: 'kopeck', isEstimate: true,
      note: 'ОЦЕНКА: сумма округлённых pricePromo × quantity. Семантика цены единицы ещё не подтверждена X5; возможны чековые скидки. Не считать точными расходами и не смешивать с итогами чеков. Коды категорий без справочника названий. Не более 500 категорий.',
    };
  }
  getPriceChanges(p: Period & { limit: number }) {
    const { where, values } = filters(p);
    return {
      changes: this.db.prepare(`WITH history AS (
        SELECT i.plu_id, i.name, r.network_code, i.unit, i.paid_price_minor, r.created_at,
          ROW_NUMBER() OVER (PARTITION BY r.network_code, i.plu_id, i.unit ORDER BY r.created_at, r.id, i.id) AS first_row,
          ROW_NUMBER() OVER (PARTITION BY r.network_code, i.plu_id, i.unit ORDER BY r.created_at DESC, r.id DESC, i.id DESC) AS last_row
        FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id
        WHERE ${where} AND i.plu_id IS NOT NULL AND i.paid_price_minor IS NOT NULL AND i.quantity>0
      ), prices AS (
        SELECT plu_id, MIN(name) AS name, network_code, unit, MIN(created_at) AS first_purchase, MAX(created_at) AS last_purchase,
          MAX(CASE WHEN first_row=1 THEN paid_price_minor END) AS first_price_minor,
          MAX(CASE WHEN last_row=1 THEN paid_price_minor END) AS last_price_minor
        FROM history GROUP BY network_code, plu_id, unit HAVING MIN(created_at)<MAX(created_at)
      ) SELECT *, last_price_minor-first_price_minor AS change_minor,
        CASE WHEN first_price_minor>0 THEN ROUND(100.0*(last_price_minor-first_price_minor)/first_price_minor, 2) END AS change_percent
        FROM prices ORDER BY change_percent DESC, plu_id LIMIT ?`).all(...values, p.limit),
      moneyUnit: 'kopeck', note: 'Первая и последняя известная pricePromo за период, раздельно по сети/PLU/единице. Разница может быть связана с акцией; семантика цены пока предварительная. Не индекс инфляции.',
    };
  }
}
