import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const solar = JSON.parse(fs.readFileSync(path.join(here, 'solar.json'), 'utf8'));
const theme = fs.readFileSync(path.join(here, 'theme.css'), 'utf8');

const LOGO = `<symbol id="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#B4583A"/><circle cx="16" cy="12.6" r="6.3" fill="#FBEEE5"/><rect x="4.5" y="15.8" width="23" height="3.8" rx="1.9" fill="#B4583A"/><rect x="8.5" y="20.8" width="19" height="3" rx="1.5" fill="#FBEEE5" fill-opacity=".74"/><rect x="4.5" y="25.2" width="12" height="2.2" rx="1.1" fill="#FBEEE5" fill-opacity=".42"/></symbol>`;
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#B4583A"/><circle cx="16" cy="12.6" r="6.3" fill="#FBEEE5"/><rect x="4.5" y="15.8" width="23" height="3.8" rx="1.9" fill="#B4583A"/><rect x="8.5" y="20.8" width="19" height="3" rx="1.5" fill="#FBEEE5" fill-opacity=".74"/><rect x="4.5" y="25.2" width="12" height="2.2" rx="1.1" fill="#FBEEE5" fill-opacity=".42"/></svg>`);

const SUFFIX = { l: '-linear', d: '-bold-duotone' };
export function I(name, cls = 'size-5', style = 'l') {
  return `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${style}-${name}"/></svg>`;
}
export const money = (s) => s.replace(/[.,]/g, (c) => `<i class="d">${c}</i>`);
export const D = (name, cls) => I(name, cls, 'd');
export const Logo = (cls = 'size-8') => `<svg class="${cls} shrink-0" aria-hidden="true"><use href="#logo"/></svg>`;

function sprite(html) {
  const used = new Set([...html.matchAll(/href="#i-([ld])-([a-z0-9-]+)"/g)].map((m) => `${m[1]}:${m[2]}`));
  let out = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${LOGO}`;
  for (const u of [...used].sort()) {
    const [s, n] = u.split(':');
    const ic = solar.icons[n + SUFFIX[s]];
    if (!ic) throw new Error('icono Solar inexistente: ' + n + SUFFIX[s]);
    out += `<symbol id="i-${s}-${n}" viewBox="0 0 24 24">${ic.body}</symbol>`;
  }
  return out + '</defs></svg>';
}

export function doc({ title, desc = '', body, bodyClass = '', css = '' }) {
  const content = `<body class="${bodyClass}">\n${body}\n</body>`;
  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@300..800&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"></script>
<style type="text/tailwindcss">
${theme}
${css}
</style>
</head>
${content.replace('<body class="' + bodyClass + '">\n', '<body class="' + bodyClass + '">\n' + sprite(content) + '\n')}
</html>
`;
}
