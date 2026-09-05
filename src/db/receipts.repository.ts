import type Database from 'better-sqlite3';
import type { Receipt } from '../x5/types.js';

export const searchText = (value: string) => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');

export class ReceiptsRepository {
  constructor(public readonly db: Database.Database) {}
  saveReceipts(receipts: Receipt[]) {
    return this.db.transaction(() => {
      let inserted = 0, updated = 0, items = 0;
      const exists = this.db.prepare('SELECT 1 FROM receipts WHERE id = ?');
      const upsert = this.db.prepare(`INSERT INTO receipts VALUES (
        @id, @transactionId, @createdAt, @purchaseDate, @networkCode, @title, @storeId, @storeAddress,
        @totalRegular, @totalPaid, @discount, @checkNumber, @fiscalNumber, @ofdUrl, @syncedAt
      ) ON CONFLICT(id) DO UPDATE SET transaction_id=excluded.transaction_id, created_at=excluded.created_at,
        purchase_date=excluded.purchase_date, network_code=excluded.network_code, title=excluded.title,
        store_id=excluded.store_id, store_address=excluded.store_address,
        total_regular_minor=excluded.total_regular_minor, total_paid_minor=excluded.total_paid_minor,
        discount_minor=excluded.discount_minor, check_number=excluded.check_number,
        fiscal_number=excluded.fiscal_number, ofd_url=excluded.ofd_url, synced_at=excluded.synced_at`);
      const deleteItems = this.db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?');
      const insertItem = this.db.prepare(`INSERT INTO receipt_items
        (receipt_id, plu_id, name, name_search, quantity, unit, regular_price_minor, paid_price_minor,
         source_price_item_minor, discount_minor, category_code, image_url)
        VALUES (@receiptId, @pluId, @name, @nameSearch, @quantity, @unit, @regularPrice, @paidPrice,
         @linePaid, @discount, @categoryCode, @imageUrl)`);
      for (const receipt of receipts) {
        if (exists.get(receipt.id)) updated++; else inserted++;
        const { items: receiptItems, ...fields } = receipt;
        upsert.run({ ...fields, syncedAt: new Date().toISOString() });
        deleteItems.run(receipt.id);
        for (const item of receiptItems) {
          insertItem.run({ ...item, receiptId: receipt.id, nameSearch: searchText(item.name) });
          items++;
        }
      }
      return { inserted, updated, items };
    })();
  }
  getRecentReceipts(limit: number, offset = 0) {
    return this.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id=r.id) AS items_count
      FROM receipts r ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(limit, offset);
  }
  getReceipt(id: string) {
    const receipt = this.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
    if (!receipt) return null;
    return { receipt, items: this.db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id LIMIT 500').all(id),
      itemsCount: (this.db.prepare('SELECT COUNT(*) AS n FROM receipt_items WHERE receipt_id=?').get(id) as { n: number }).n };
  }
  status() {
    return {
      inventory: this.db.prepare(`SELECT COUNT(*) AS receipts_count, MIN(purchase_date) AS first_purchase,
        MAX(purchase_date) AS last_purchase, MAX(synced_at) AS last_receipt_sync FROM receipts`).get(),
      networks: this.db.prepare('SELECT network_code, COUNT(*) AS receipts_count FROM receipts GROUP BY network_code').all(),
      recentSyncs: this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20').all(),
      coverage: this.db.prepare(`SELECT date_from, date_to, network_codes, finished_at FROM sync_runs
        WHERE status='complete' ORDER BY id DESC LIMIT 100`).all(),
      note: 'Данные только из локальной базы. Покрытие подтверждается завершёнными sync; наличие чеков не доказывает полноту периода. Coverage ограничен 100 последними запусками.',
    };
  }
}
