import fixture from './fixtures/history-page.json' with { type: 'json' };
import type { Config } from '../src/config/env.js';
export const raw = fixture.data.additionalReceiptsResponse[0]!;
export const config = (): Config => ({ cookie: 'synthetic-cookie', dbPath: ':memory:', networkCodes: 'D,S,VK,SL,VP',
  timeoutMs: 30000, pageDelayMs: 1, maxPages: 1000, syncFrom: undefined, enableSyncTool: true });
