import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from '../config/env.js';
import { dateSchema } from '../config/env.js';
import { ReceiptsRepository } from '../db/receipts.repository.js';
import { AppError, safeError } from '../x5/errors.js';
import { normalizeReceipt } from '../x5/normalize.js';
import type { X5Client } from '../x5/types.js';

export function monthRanges(from: string, to: string) {
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success || from > to)
    throw new AppError('INPUT', 'Нужен корректный диапазон YYYY-MM-DD: from <= to.');
  if (+to.slice(0, 4) - +from.slice(0, 4) > 20) throw new AppError('INPUT', 'Диапазон синхронизации ограничен 20 годами.');
  const ranges: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const next = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    ranges.push({ from: start, to: end < to ? end : to });
    start = next.toISOString().slice(0, 10);
  }
  return ranges;
}
export class SyncService {
  constructor(private readonly config: Config, private readonly client: X5Client, private readonly repository: ReceiptsRepository) {}
  async sync(input: { from?: string; to?: string }, signal?: AbortSignal) {
    const db = this.repository.db;
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const last = db.prepare(`SELECT date_to FROM sync_runs WHERE status='complete' AND network_codes=?
      ORDER BY id DESC LIMIT 1`).get(this.config.networkCodes) as { date_to: string } | undefined;
    const from = input.from ?? (last ? new Date(Date.parse(last.date_to) - 7 * 86400000).toISOString().slice(0, 10) : this.config.syncFrom);
    const to = input.to ?? today;
    if (!from) throw new AppError('INPUT', 'Для первой синхронизации задайте from и to либо X5_SYNC_FROM в .env.');
    const ranges = monthRanges(from, to);
    if (to > today) throw new AppError('INPUT', 'Дата to не может быть позже сегодняшней даты.');
    const owner = randomUUID();
    const leaseMs = this.config.timeoutMs + this.config.pageDelayMs + 120000;
    const acquire = db.prepare(`INSERT INTO sync_lock VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE
      SET owner=excluded.owner, expires_at=excluded.expires_at WHERE sync_lock.expires_at < ?`);
    if (!acquire.run(owner, Date.now() + leaseMs, Date.now()).changes)
      throw new AppError('SYNC_BUSY', 'Синхронизация уже выполняется в другом запросе или процессе.');
    const stats = { monthsProcessed: 0, receiptsInserted: 0, receiptsUpdated: 0, itemsProcessed: 0, pagesProcessed: 0 };
    let runId: number | bigint | undefined;
    try {
      runId = db.prepare(`INSERT INTO sync_runs (started_at, date_from, date_to, network_codes, status)
        VALUES (?, ?, ?, ?, 'running')`).run(new Date().toISOString(), from, to, this.config.networkCodes).lastInsertRowid;
      for (const range of ranges) {
        const seen = new Set<string>();
        let complete = false;
        for (let page = 0; page < this.config.maxPages; page++) {
          if (signal?.aborted) throw new AppError('CANCELLED', 'Синхронизация отменена. Сохранённые страницы доступны локально.');
          const renewed = db.prepare('UPDATE sync_lock SET expires_at=? WHERE id=1 AND owner=?').run(Date.now() + leaseMs, owner);
          if (!renewed.changes) throw new AppError('SYNC_BUSY', 'Блокировка синхронизации потеряна. Повторите запрос.');
          if (stats.pagesProcessed) await delay(this.config.pageDelayMs, undefined, { signal });
          const result = await this.client.getReceiptHistory({ ...range, type: 'receipts', codeTc: this.config.networkCodes, page }, signal);
          stats.pagesProcessed++;
          if (!result.receipts.length) { complete = true; break; }
          const receipts = result.receipts.map(normalizeReceipt);
          if (receipts.every(r => seen.has(r.id))) throw new AppError('X5_PAGINATION', 'X5 повторяет страницы. Синхронизация остановлена; период не отмечен завершённым.');
          for (const r of receipts) {
            if (r.purchaseDate < range.from || r.purchaseDate > range.to)
              throw new AppError('X5_RANGE', 'X5 вернул чек вне запрошенного периода. Проверьте фильтры и формат даты.');
            seen.add(r.id);
          }
          const saved = this.repository.saveReceipts(receipts);
          stats.receiptsInserted += saved.inserted;
          stats.receiptsUpdated += saved.updated;
          stats.itemsProcessed += saved.items;
          db.prepare('UPDATE sync_runs SET pages=?, receipts_inserted=?, receipts_updated=? WHERE id=?')
            .run(stats.pagesProcessed, stats.receiptsInserted, stats.receiptsUpdated, runId);
        }
        if (!complete) throw new AppError('X5_PAGE_LIMIT', 'Достигнут лимит страниц. Период не завершён; можно повторить синхронизацию.');
        stats.monthsProcessed++;
      }
      db.prepare("UPDATE sync_runs SET status='complete', finished_at=?, pages=? WHERE id=?")
        .run(new Date().toISOString(), stats.pagesProcessed, runId);
      return { ...stats, from, to, networkCodes: this.config.networkCodes };
    } catch (error) {
      if (runId !== undefined) db.prepare("UPDATE sync_runs SET status='failed', finished_at=?, error_code=? WHERE id=?")
        .run(new Date().toISOString(), signal?.aborted ? 'CANCELLED' : safeError(error).code, runId);
      if (signal?.aborted) throw new AppError('CANCELLED', 'Синхронизация отменена. Сохранённые страницы доступны локально.');
      throw error;
    } finally { db.prepare('DELETE FROM sync_lock WHERE owner=?').run(owner); }
  }
}
