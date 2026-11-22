import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const only = process.argv.slice(2);
const map = { index: 'index', n1: 'n1-login', n2: 'n2-resumen', n3: 'n3-colaboradores', n4: 'n4-error-reaper', v1: 'v1-inicio', v2: 'v2-liquidacion', v3: 'v3-archivo-expuesto', v4: 'v4-error-reaper' };
for (const [k, file] of Object.entries(map)) {
  if (only.length && !only.includes(k)) continue;
  const p = path.join(here, 'pages', k + '.mjs');
  if (!fs.existsSync(p)) continue;
  const mod = await import(p + '?t=' + Date.now());
  fs.writeFileSync(path.join(out, file + '.html'), mod.default);
  console.log('built', file + '.html');
}
