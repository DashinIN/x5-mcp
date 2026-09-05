#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApp } from './app.js';
import { createServer } from './mcp/server.js';
import { safeError } from './x5/errors.js';

try {
  const app = createApp();
  const shutdown = new AbortController();
  const handle = serveStdio(() => createServer(app, shutdown.signal), {
    onerror: error => console.error(JSON.stringify(safeError(error))),
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    shutdown.abort();
    await handle.close();
    // In-flight sync unwinds before process exit; closing SQLite is safe at exit.
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  process.stdin.once('end', () => { void close(); });
  process.once('exit', () => app.db.close());
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
}
