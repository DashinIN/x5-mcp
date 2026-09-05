import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { safeError } from '../src/x5/errors.js';

describe('configuration', () => {
  const env = { X5_ENV_FILE: resolve('tests/fixtures/config.env') };

  it('resolves relative database paths against the env file', () => {
    expect(loadConfig(env).dbPath).toBe(resolve('tests/fixtures/data/test.sqlite'));
  });

  it('keeps absolute database paths unchanged', () => {
    const dbPath = resolve('tmp/custom.sqlite');
    expect(loadConfig({ ...env, X5_DB_PATH: dbPath }).dbPath).toBe(dbPath);
  });

  it('lets environment override file values', () => {
    expect(loadConfig({ ...env, X5_PAGE_DELAY_MS: '1234', X5_ENABLE_SYNC_TOOL: '0' })).toMatchObject({ pageDelayMs: 1234, enableSyncTool: false });
  });

  it('does not include invalid secret values in configuration errors', () => {
    try { loadConfig({ ...env, X5_COOKIE: 'private\r\nvalue' }); }
    catch (error) { expect(safeError(error)).toEqual({ code: 'CONFIG', message: 'Invalid settings: X5_COOKIE.' }); }
  });

  it('rejects invalid dates and missing explicit env files', () => {
    expect(() => loadConfig({ ...env, X5_SYNC_FROM: '2026-02-30' })).toThrow();
    expect(() => loadConfig({ X5_ENV_FILE: resolve('tests/fixtures/nonexistent.env') })).toThrow();
  });
});
