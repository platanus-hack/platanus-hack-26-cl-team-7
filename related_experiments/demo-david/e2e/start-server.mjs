// Starts the budget app for the end-to-end run on a fresh SQLite file, so every
// run begins from the same mock data. Playwright's webServer runs this file.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..', 'server');
const clientIndex = join(here, '..', 'client', 'dist', 'index.html');
const dataDir = join(here, '.tmp');

if (!existsSync(clientIndex)) {
  console.error('client/dist is missing. Run "npm run build" in demo-david first.');
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, ['index.js'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: process.env.E2E_PORT || '3111',
    DB_PATH: join(dataDir, 'e2e.db'),
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', code => process.exit(code ?? 0));
