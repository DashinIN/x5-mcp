import { loadConfig } from './config/env.js';
import { openDatabase } from './db/database.js';
import { ReceiptsRepository } from './db/receipts.repository.js';
import { AnalyticsRepository } from './db/analytics.repository.js';
import { HttpX5Client } from './x5/client.js';
import { SyncService } from './sync/sync-history.js';

export function createApp() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const receipts = new ReceiptsRepository(db);
  const analytics = new AnalyticsRepository(db);
  const client = new HttpX5Client(config);
  return { config, db, receipts, analytics, client, sync: new SyncService(config, client, receipts) };
}
export type App = ReturnType<typeof createApp>;
