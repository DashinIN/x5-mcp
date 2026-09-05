import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { App } from '../app.js';
import { safeError } from '../x5/errors.js';
import { historySchema, recentSchema, searchSchema, spendingSchema, syncSchema, topSchema } from './schemas.js';
import { analysisRules, registerPrompts } from './prompts.js';

async function result(operation: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await operation();
    return { content: [{ type: 'text', text: JSON.stringify({ moneyUnit: 'kopeck', currency: 'RUB', data: value }) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(safeError(error)) }] }; }
}
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export function createServer(app: App, shutdown?: AbortSignal) {
  const server = new McpServer({ name: 'x5-purchases', version: '0.1.0' }, { instructions: analysisRules });
  if (app.config.enableSyncTool) server.registerTool('x5_sync_history', {
    description: 'Загрузить чеки X5 в локальную SQLite. Сетевой запрос, обновляет локальный кэш. Первый запуск требует from/to; далее перекрытие 7 дней. Большой импорт запускайте CLI.',
    inputSchema: syncSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, (args, ctx) => result(() => app.sync.sync(args, shutdown ? AbortSignal.any([shutdown, ctx.mcpReq.signal]) : ctx.mcpReq.signal)));
  server.registerTool('x5_get_sync_status', { description: 'Покрытие истории, сети, свежесть и результаты последних синхронизаций. Проверять перед аналитикой.', inputSchema: z.object({}).strict(), annotations: read },
    () => result(() => app.receipts.status()));
  server.registerTool('x5_get_recent_receipts', { description: 'Последние чеки из SQLite без состава; limit/offset. Состав — x5_get_receipt.', inputSchema: recentSchema, annotations: read },
    args => result(() => app.receipts.getRecentReceipts(args.limit, args.offset)));
  server.registerTool('x5_get_receipt', { description: 'Один чек и до 500 его позиций; itemsCount показывает полное число позиций.', inputSchema: z.object({ id: z.string().min(1).max(300) }).strict(), annotations: read },
    args => result(() => app.receipts.getReceipt(args.id)));
  server.registerTool('x5_get_spending', { description: 'Траты по суммам чеков, без удвоения по товарам. Период включительно, сеть по исходному коду. null — неизвестно.', inputSchema: spendingSchema, annotations: read },
    args => result(() => app.analytics.getSpending(args)));
  server.registerTool('x5_search_purchases', { description: 'Локальный поиск по названию товара без учёта регистра, ё/е; фильтры дат, сети, категории; limit/offset.', inputSchema: searchSchema, annotations: read },
    args => result(() => app.analytics.searchPurchases(args)));
  server.registerTool('x5_get_product_history', { description: 'История PLU, цены и количество. PLU найдите через x5_search_purchases. Сети и единицы не смешиваются в сводке.', inputSchema: historySchema, annotations: read },
    args => result(() => app.analytics.getProductHistory(args)));
  server.registerTool('x5_get_top_products', { description: 'Частые товары по числу разных чеков, с количеством и последней покупкой. Фильтры периода, сети, категории.', inputSchema: topSchema, annotations: read },
    args => result(() => app.analytics.getTopProducts(args)));
  server.registerTool('x5_get_categories', { description: 'Исходные коды категорий и число позиций. Названия категорий не выдумываются.', inputSchema: spendingSchema, annotations: read },
    args => result(() => app.analytics.getCategories(args)));
  server.registerTool('x5_get_category_spending', { description: 'Предварительная ОЦЕНКА трат по категориям: pricePromo × quantity. Семантика цены не подтверждена, это не точные итоги чеков.', inputSchema: topSchema, annotations: read },
    args => result(() => app.analytics.getCategorySpending(args)));
  server.registerTool('x5_get_price_changes', { description: 'Сравнить первую и последнюю известную цену каждого PLU за период, раздельно по сети и единице. Акции могут объяснять разницу.', inputSchema: topSchema, annotations: read },
    args => result(() => app.analytics.getPriceChanges(args)));
  registerPrompts(server);
  return server;
}
