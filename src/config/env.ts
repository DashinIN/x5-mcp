import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { z } from 'zod';
import { AppError } from '../x5/errors.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dateSchema = z.iso.date();
export const networkSchema = z.enum(['D', 'S', 'VK', 'SL', 'VP']);
const schema = z.object({
  X5_COOKIE: z.string().default('').refine(v => !/[\r\n]/.test(v)),
  X5_DB_PATH: z.string().min(1).default('data/x5.sqlite'),
  X5_NETWORK_CODES: z.string().default('D,S,VK,SL,VP').refine(v => v.split(',').every(c => networkSchema.safeParse(c).success)),
  X5_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  X5_PAGE_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(500),
  X5_MAX_PAGES_PER_MONTH: z.coerce.number().int().min(1).max(10000).default(1000),
  X5_SYNC_FROM: z.union([dateSchema, z.literal('')]).default(''),
  X5_ENABLE_SYNC_TOOL: z.enum(['0', '1']).default('1'),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const path = resolve(env.X5_ENV_FILE || resolve(projectRoot, '.env'));
  let file: Record<string, string> = {};
  try { if (existsSync(path)) file = parse(readFileSync(path)); }
  catch { throw new AppError('CONFIG', 'Не удалось прочитать файл .env.'); }
  if (env.X5_ENV_FILE && !existsSync(path)) throw new AppError('CONFIG', 'Файл X5_ENV_FILE не найден.');
  const result = schema.safeParse({ ...file, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) });
  if (!result.success) throw new AppError('CONFIG', `Неверные настройки: ${result.error.issues.map(i => i.path.join('.')).join(', ')}.`);
  const v = result.data;
  return {
    cookie: v.X5_COOKIE, dbPath: resolve(dirname(path), v.X5_DB_PATH),
    networkCodes: v.X5_NETWORK_CODES, timeoutMs: v.X5_REQUEST_TIMEOUT_MS,
    pageDelayMs: v.X5_PAGE_DELAY_MS, maxPages: v.X5_MAX_PAGES_PER_MONTH,
    syncFrom: v.X5_SYNC_FROM || undefined, enableSyncTool: v.X5_ENABLE_SYNC_TOOL === '1',
  };
}
export type Config = ReturnType<typeof loadConfig>;
