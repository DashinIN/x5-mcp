import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/mcp.test.ts'], {
  stdio: 'inherit', env: { ...process.env, X5_TEST_BUILT: '1' },
});
process.exitCode = result.status ?? 1;
