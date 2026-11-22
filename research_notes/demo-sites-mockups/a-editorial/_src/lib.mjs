// Shared helpers for Direction A "Editorial cálido". Build-time only: the output HTML files are standalone.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
export const OUT = path.resolve(here, '..');

export const ic = (name, cls = '') => {
  const raw = fs.readFileSync(path.join(here, 'icons', `${name}.svg`), 'utf8');
  const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg class="ic ${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${inner}</svg>`;
};

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const clp = (n) => '$' + group(String(Math.round(n)));
export const rut = (body) => {
  const s = String(body);
  let sum = 0;
  let m = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (sum % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return `${group(s)}-${dv}`;
};

// Bruma logomark: a low sun cut by two bands of mist, and a fog line below.
export const mark = (size = 28, inverted = false) => {
  const bg = inverted ? '#F3EEE3' : '#1E4B38';
  const fg = inverted ? '#1E4B38' : '#F3EEE3';
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="${bg}"/><circle cx="16" cy="13.5" r="7" fill="${fg}"/><rect x="7" y="14.6" width="18" height="1.5" fill="${bg}"/><rect x="7" y="17.9" width="18" height="1.5" fill="${bg}"/><rect x="8" y="23.6" width="16" height="1.8" rx=".9" fill="${fg}" opacity=".55"/></svg>`;
};

export const wordmark = (label, inverted = false) => `
  <span class="inline-flex items-center gap-2.5">
    ${mark(28, inverted)}
    <span class="font-serif text-[1.5rem] leading-none font-medium tracking-tight ${inverted ? 'text-paper' : 'text-ink'}">Bruma</span>
    ${label ? `<span class="label ${inverted ? '!text-paper/70' : ''} pt-0.5">${label}</span>` : ''}
  </span>`;

const THEME = `
@theme {
  --color-paper: #F3EEE3;
  --color-paper-2: #EAE3D3;
  --color-sheet: #FBF8F1;
  --color-ink: #16140E;
  --color-ink-2: #454036;
  --color-ink-3: #6E685C;
  --color-rule: #D6CCB8;
  --color-rule-2: #E4DCCB;
  --color-forest: #1E4B38;
  --color-forest-2: #2B6549;
  --color-moss: #DAE4D3;
  --color-ochre: #A85F12;
  --color-ochre-soft: #F0DDB2;
  --color-brick: #9A3626;
  --color-brick-soft: #F1D9D0;
  --font-serif: "Newsreader", "Iowan Old Style", Georgia, serif;
  --font-sans: "Inter Tight", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 14px;
  --text-micro: 0.6875rem;
  --text-micro--line-height: 1rem;
  --text-heading: 1.5rem;
  --text-heading--line-height: 1.2;
  --text-title: 2.75rem;
  --text-title--line-height: 1.04;
  --text-fig: 2.75rem;
  --text-fig--line-height: 1;
  --text-fig-lg: 5.5rem;
  --text-fig-lg--line-height: 0.95;
}
@layer base {
  html { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  body { font-size: 15px; line-height: 1.45; min-height: 100vh; }
  ::selection { background: var(--color-moss); }
  :focus-visible { outline: 2px solid var(--color-forest); outline-offset: 2px; border-radius: 2px; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; }
  a { color: inherit; text-decoration: none; }
}
@layer components {
  .ic { width: 1.125rem; height: 1.125rem; flex: none; }
  .label { font-size: .6875rem; line-height: 1rem; letter-spacing: .09em; text-transform: uppercase; font-weight: 500; color: var(--color-ink-3); }
  .fig { font-family: var(--font-serif); font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum", "lnum"; letter-spacing: -.02em; font-weight: 350; }
  .tnum { font-variant-numeric: tabular-nums; }
  .serif { font-family: var(--font-serif); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; height: 2.5rem; padding: 0 1.1rem; border-radius: var(--radius-sm); font-size: .875rem; font-weight: 500; white-space: nowrap; transition: background-color .15s, color .15s, border-color .15s, transform .1s; }
  .btn:active { transform: translateY(1px); }
  .btn-primary { background: var(--color-ink); color: var(--color-paper); }
  .btn-primary:hover { background: var(--color-forest); }
  .btn-ghost { border: 1px solid var(--color-ink); color: var(--color-ink); }
  .btn-ghost:hover { background: var(--color-ink); color: var(--color-paper); }
  .link { background: linear-gradient(currentColor, currentColor) 0 100% / 100% 1px no-repeat; padding-bottom: 1px; transition: background-size .2s; }
  .link:hover { background-size: 0 1px; }
  .status { display: inline-flex; align-items: center; gap: .5rem; font-size: .8125rem; font-weight: 500; white-space: nowrap; }
  .status::before { content: ""; width: .5rem; height: .5rem; border-radius: 99px; background: currentColor; }
  .status-ok { color: var(--color-forest); }
  .status-warn { color: var(--color-ochre); }
  .status-bad { color: var(--color-brick); }
  .status-idle { color: var(--color-ink-3); }
  .status-idle::before { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
  .ledger { width: 100%; border-collapse: collapse; }
  .ledger thead th { text-align: left; padding: .6rem .75rem; font-size: .6875rem; letter-spacing: .09em; text-transform: uppercase; font-weight: 500; color: var(--color-ink-3); border-top: 3px double var(--color-ink); border-bottom: 1px solid var(--color-ink); white-space: nowrap; }
  .ledger tbody td { padding: .85rem .75rem; border-bottom: 1px solid var(--color-rule); vertical-align: middle; font-variant-numeric: tabular-nums; }
  .ledger tbody tr:hover td { background: var(--color-sheet); }
  .ledger .r { text-align: right; }
  .ledger-tight thead th, .ledger-tight tbody td { padding-left: .5rem; padding-right: .5rem; }
  .ledger tr > :first-child { padding-left: 0; }
  .ledger tr > :last-child { padding-right: 0; }
  .avatar { width: 2rem; height: 2rem; border-radius: 99px; display: inline-grid; place-items: center; font-size: .6875rem; font-weight: 600; letter-spacing: .03em; flex: none; }
  .tag { display: inline-flex; align-items: center; height: 1.25rem; padding: 0 .45rem; border-radius: var(--radius-xs); font-size: .6875rem; font-weight: 500; letter-spacing: .02em; }
  .field { display: block; width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--color-ink); padding: .6rem 0; font-size: 1rem; color: var(--color-ink); border-radius: 0; }
  .field::placeholder { color: color-mix(in srgb, var(--color-ink-3) 75%, transparent); }
  .field:focus { outline: none; border-bottom-color: var(--color-forest); box-shadow: 0 1px 0 0 var(--color-forest); }
  .kbd { font-family: var(--font-sans); font-size: .6875rem; font-weight: 500; padding: .1rem .35rem; border: 1px solid var(--color-rule); border-radius: var(--radius-xs); color: var(--color-ink-3); background: var(--color-sheet); }
}
`;

export const head = (title, { extra = '' } = {}) => `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300..700;1,400&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"></script>
<style>html{background:#F3EEE3;color:#16140E}body{margin:0}</style>
<style type="text/tailwindcss">${THEME}${extra}</style>
</head>`;

export const write = (name, html) => {
  fs.writeFileSync(path.join(OUT, name), html);
  console.log('wrote', name, (html.length / 1024).toFixed(1) + ' KB');
};
