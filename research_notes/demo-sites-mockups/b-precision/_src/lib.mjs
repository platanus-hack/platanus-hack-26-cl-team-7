// Shared helpers for the "Precision" mockups: tokens, icon sprite, small components.
import fs from 'node:fs';
import path from 'node:path';

const iconDir = path.join(import.meta.dirname, 'icons');
export const used = new Set();

// Iconoir regular, stroke 1.5. Referenced through an inline <symbol> sprite so each file stays standalone.
export const ic = (n, c = 'size-4') => {
  used.add(n);
  return `<svg class="${c} shrink-0" viewBox="0 0 24 24" fill="none" stroke-width="1.5" aria-hidden="true"><use href="#i-${n}"/></svg>`;
};

export const logo = (c = 'size-6') =>
  `<svg class="${c} shrink-0 text-accent-700" viewBox="0 0 24 24" role="img" aria-label="Bruma"><use href="#logo"/></svg>`;

const LOGO_SYMBOL = `<symbol id="logo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="currentColor"/><g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5V18"/><path d="M8.5 6.5h4.5a2.75 2.75 0 0 1 0 5.5H8.5"/><path d="M8.5 12h5.5a3 3 0 0 1 0 6H8.5" opacity=".55"/></g></symbol>`;

export function sprite() {
  const syms = [...used].sort().map((n) => {
    const raw = fs.readFileSync(path.join(iconDir, `${n}.svg`), 'utf8');
    const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    return `<symbol id="i-${n}" viewBox="0 0 24 24">${inner}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${LOGO_SYMBOL}${syms.join('')}</defs></svg>`;
}

const FAVICON = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0B5A5A"/><g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5V18"/><path d="M8.5 6.5h4.5a2.75 2.75 0 0 1 0 5.5H8.5"/><path d="M8.5 12h5.5a3 3 0 0 1 0 6H8.5" opacity=".55"/></g></svg>`,
);

const THEME = `
@theme static {
  --font-sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  --color-canvas: #f5f6f8;
  --color-surface: #ffffff;
  --color-sunken: #eceff2;
  --color-line: #e3e6ea;
  --color-line-strong: #cdd2d9;
  --color-ink: #11161c;
  --color-ink-2: #343d48;
  --color-ink-3: #5e6a77;
  --color-ink-4: #8a95a1;

  --color-accent-50: #eaf4f3;
  --color-accent-100: #cfe7e4;
  --color-accent-200: #a8d3ce;
  --color-accent-300: #7dbab4;
  --color-accent-500: #1b8a84;
  --color-accent-600: #0f716e;
  --color-accent-700: #0b5a5a;
  --color-accent-800: #0a4547;
  --color-accent-900: #072f30;

  --color-warn-50: #fdf5e4;
  --color-warn-200: #f0d9a4;
  --color-warn-500: #d98b1a;
  --color-warn-800: #7a4a07;
  --color-danger-50: #fdecea;
  --color-danger-500: #c23a2b;
  --color-danger-700: #9a2418;

  --text-2xs: 11px;
  --text-2xs--line-height: 16px;
  --text-xs: 12px;
  --text-xs--line-height: 16px;
  --text-sm: 13px;
  --text-sm--line-height: 20px;
  --text-base: 14px;
  --text-base--line-height: 22px;
  --text-lg: 16px;
  --text-lg--line-height: 24px;
  --text-xl: 20px;
  --text-xl--line-height: 28px;
  --text-2xl: 28px;
  --text-2xl--line-height: 34px;
  --text-3xl: 36px;
  --text-3xl--line-height: 42px;

  --radius-xs: 3px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
@layer base {
  html { font-family: var(--font-sans); -webkit-text-size-adjust: 100%; }
  body { background: var(--color-canvas); color: var(--color-ink); font-size: 14px; line-height: 22px; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  ::selection { background: var(--color-accent-100); }
  :focus-visible { outline: 2px solid var(--color-accent-500); outline-offset: 2px; }
  button { cursor: pointer; font: inherit; }
  table { border-collapse: collapse; }
}
`;

export const head = ({ title, desc = '', extra = '' }) => `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"></script>
<style type="text/tailwindcss">${THEME}${extra}</style>
</head>`;

export const page = (opts, body) => {
  const html = `${head(opts)}\n${body}\n</html>\n`;
  return html.replace('<!--SPRITE-->', sprite());
};

// ---------- data helpers ----------
export const clp = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dv = (n) => {
  let s = 0, m = 2;
  for (const d of String(n).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
};
export const rut = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv(n);

// Matias Fuentes Rojas: one payslip drives console drawer and portal screens.
const imp = 1_050_000 + 209_396;
const afp = Math.round(imp * 0.1058);
const salud = Math.round(imp * 0.07);
const ces = Math.round(imp * 0.006);
const impUnico = Math.round((imp - afp - salud - ces) * 0.04 - 37_800);
const noImp = 62_000 + 48_000;
const otros = 12_480 + 38_000;
const legales = afp + salud + ces + impUnico;
export const pay = {
  base: 1_050_000, grat: 209_396, col: 62_000, mov: 48_000, imp, afp, salud, ces, impUnico, legales,
  seguro: 12_480, credito: 38_000, otros, noImp,
  haberes: imp + noImp,
  liquido: imp + noImp - legales - otros,
  empCes: Math.round(imp * 0.024), empSis: Math.round(imp * 0.0154), empMut: Math.round(imp * 0.0093),
};

// ---------- components ----------
export const kbd = (t, c = '') =>
  `<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface px-1 font-mono text-2xs font-medium text-ink-3 ${c}">${t}</kbd>`;

const DOT = {
  ok: 'bg-accent-500',
  warn: 'bg-warn-500',
  danger: 'bg-danger-500',
  idle: 'bg-transparent ring-1 ring-inset ring-ink-4',
  done: 'bg-ink-3',
};
export const dot = (k) => `<span class="size-1.5 shrink-0 rounded-full ${DOT[k]}"></span>`;
export const status = (k, l, c = '') =>
  `<span class="inline-flex items-center gap-2 whitespace-nowrap text-sm ${c}">${dot(k)}${l}</span>`;

export const seg = (items, active = 0, c = '') =>
  `<div class="${/\b(hidden|flex)\b/.test(c) ? '' : 'inline-flex'} shrink-0 rounded-md border border-line bg-sunken p-0.5 ${c}" role="tablist">${items
    .map(
      (it, i) =>
        `<button type="button" role="tab" aria-selected="${i === active}" class="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm ${
          i === active
            ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_1px_rgb(17_22_28/0.05)]'
            : 'text-ink-3 hover:text-ink'
        }">${it}</button>`,
    )
    .join('')}</div>`;

export const btn = (label, { kind = 'secondary', icon = '', c = '', tag = 'button', href = '#', disabled = false } = {}) => {
  const base = 'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium';
  const kinds = {
    primary: 'bg-accent-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-accent-800',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
    ghost: 'text-ink-2 hover:bg-sunken',
  };
  const attrs = tag === 'a' ? `href="${href}"` : `type="button"${disabled ? ' disabled' : ''}`;
  return `<${tag} ${attrs} class="${base} ${kinds[kind]} ${c}">${icon}${label}</${tag}>`;
};

const TONES = ['bg-accent-100 text-accent-800', 'bg-sunken text-ink-2', 'bg-[#e4e8ef] text-[#3a4660]'];
export const avatar = (ini, tone = 0, c = 'size-7 text-2xs') =>
  `<span class="inline-flex ${c} shrink-0 items-center justify-center rounded-md font-medium tracking-wide ${TONES[tone % 3]}">${ini}</span>`;
