import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { z } from 'zod';
import { AppError } from '../x5/errors.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dateSchema = z.iso.date();
export const networkSchema = z.enum(['D', 'S', 'VK', 'SL', 'VP']);

function defaultDataDir(env: NodeJS.ProcessEnv) {
  if (process.platform === 'win32') return join(env.LOCALAPPDATA || homedir(), 'x5-purchases-mcp');
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'x5-purchases-mcp');
}

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
  const defaultEnvFile = resolve(projectRoot, '.env');
  const path = env.X5_ENV_FILE ? resolve(env.X5_ENV_FILE) : defaultEnvFile;
  const hasEnvFile = existsSync(path);
  let file: Record<string, string> = {};
  try { if (hasEnvFile) file = parse(readFileSync(path)); }
  catch { throw new AppError('CONFIG', 'Unable to read .env file.'); }
  if (env.X5_ENV_FILE && !hasEnvFile) throw new AppError('CONFIG', 'X5_ENV_FILE was not found.');

  const result = schema.safeParse({ ...file, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) });
  if (!result.success) throw new AppError('CONFIG', `Invalid settings: ${result.error.issues.map(i => i.path.join('.')).join(', ')}.`);
  const v = result.data;
  const dbBase = hasEnvFile ? dirname(path) : defaultDataDir(env);
  const dbPath = isAbsolute(v.X5_DB_PATH) ? v.X5_DB_PATH : resolve(dbBase, v.X5_DB_PATH === 'data/x5.sqlite' ? 'x5.sqlite' : v.X5_DB_PATH);

  return {
    cookie: v.X5_COOKIE, dbPath,
    networkCodes: v.X5_NETWORK_CODES, timeoutMs: v.X5_REQUEST_TIMEOUT_MS,
    pageDelayMs: v.X5_PAGE_DELAY_MS, maxPages: v.X5_MAX_PAGES_PER_MONTH,
    syncFrom: v.X5_SYNC_FROM || undefined, enableSyncTool: v.X5_ENABLE_SYNC_TOOL === '1',
  };
}

export type Config = ReturnType<typeof loadConfig>;
