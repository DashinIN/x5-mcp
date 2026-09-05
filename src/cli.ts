import { parseArgs } from 'node:util';
import { createApp } from './app.js';
import { AppError, safeError } from './x5/errors.js';
import { normalizeReceipt } from './x5/normalize.js';

async function main() {
  const app = createApp();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: {
      from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'string', default: '10' },
    } });
    const [command, query] = positionals;
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('INPUT', 'limit должен быть от 1 до 100.');
    let result: unknown;
    switch (command) {
      case 'probe': {
        if (!values.from || !values.to) throw new AppError('INPUT', 'probe требует --from YYYY-MM-DD --to YYYY-MM-DD.');
        const probe = await app.client.probe({ from: values.from, to: values.to, page: 0, type: 'receipts', codeTc: app.config.networkCodes }, abort.signal);
        // Validate receipts, but never print raw transport, identities, addresses or credentials.
        probe.history.receipts.forEach(normalizeReceipt);
        result = { httpStatus: probe.status, contentType: probe.contentType, bodyBytes: probe.bodyBytes,
          receiptsCount: probe.history.receipts.length, normalization: 'passed' };
        break;
      }
      case 'sync': result = await app.sync.sync({ from: values.from, to: values.to }, abort.signal); break;
      case 'recent': result = app.receipts.getRecentReceipts(limit); break;
      case 'status': result = app.receipts.status(); break;
      case 'search':
        if (!query?.trim()) throw new AppError('INPUT', 'Укажите название товара: pnpm x5:search "кофе".');
        result = app.analytics.searchPurchases({ query, limit, offset: 0 }); break;
      default: throw new AppError('INPUT', 'Команды: probe, sync, recent, search, status.');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    app.db.close();
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
main().catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
