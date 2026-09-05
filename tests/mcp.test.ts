import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { ReceiptsRepository } from '../src/db/receipts.repository.js';
import { normalizeReceipt } from '../src/x5/normalize.js';
import { raw } from './helpers.js';

describe('MCP stdio integration', () => {
  it.each(['0', '1'])('initializes and queries from another cwd (sync enabled=%s)', async syncEnabled => {
    const dir = mkdtempSync(join(tmpdir(), 'x5-mcp-test-'));
    const dbPath = join(dir, 'test.sqlite');
    const db = openDatabase(dbPath); new ReceiptsRepository(db).saveReceipts([normalizeReceipt(raw)]); db.close();
    const args = process.env.X5_TEST_BUILT === '1' ? [resolve('dist/index.js')]
      : [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/index.ts')];
    const child = spawn(process.execPath, args, {
      cwd: dir, env: { ...process.env, X5_COOKIE: '', X5_DB_PATH: dbPath, X5_ENABLE_SYNC_TOOL: syncEnabled,
        X5_ENV_FILE: resolve('tests/fixtures/config.env') }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, (v: Record<string, unknown>) => void>();
    const invalidOutput: string[] = [];
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    lines.on('line', line => {
      try { const message = JSON.parse(line) as Record<string, unknown>; pending.get(Number(message.id))?.(message); }
      catch { invalidOutput.push(line); }
    });
    let id = 0;
    const request = (method: string, params: object = {}) => new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error(`MCP request timeout: ${method}; ${stderr}`)), 10000);
      pending.set(requestId, value => { clearTimeout(timer); pending.delete(requestId); resolveResponse(value); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
    try {
      const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      expect(init.error).toBeUndefined();
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const listed = await request('tools/list');
      const names = (listed.result as { tools: { name: string }[] }).tools.map(t => t.name);
      expect(names).toContain('x5_get_spending');
      if (syncEnabled === '0') expect(names).not.toContain('x5_sync_history');
      else {
        expect(names).toContain('x5_sync_history');
        const sync = await request('tools/call', { name: 'x5_sync_history', arguments: { from: '2026-08-01', to: '2026-08-31' } });
        expect(sync.result).toMatchObject({ isError: true });
        expect(JSON.stringify(sync)).toContain('X5_AUTH');
      }
      expect((await request('prompts/list')).result).toMatchObject({ prompts: expect.arrayContaining([expect.objectContaining({ name: 'x5_monthly_review' })]) });
      const recent = await request('tools/call', { name: 'x5_get_recent_receipts', arguments: {} });
      expect(JSON.stringify(recent)).toContain('synthetic-001');
      const spending = await request('tools/call', { name: 'x5_get_spending', arguments: { from: '2026-08-01', to: '2026-08-31' } });
      expect(JSON.stringify(spending)).toContain('21998');
      const invalid = await request('tools/call', { name: 'x5_get_recent_receipts', arguments: { limit: 100000 } });
      expect(invalid.error || (invalid.result as { isError?: boolean })?.isError).toBeTruthy();
      expect(invalidOutput).toEqual([]);
      expect(stderr).not.toContain('synthetic-cookie');
    } finally {
      const closed = new Promise<void>(resolveClose => child.once('close', () => resolveClose()));
      child.stdin.end();
      const killTimer = setTimeout(() => child.kill(), 3000);
      await closed; clearTimeout(killTimer);
      lines.close();
      // Only this test's uniquely created temporary directory is removed.
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
