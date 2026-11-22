// node _src/build.mjs : writes every screen and index.html next to this folder.
import fs from 'node:fs';
import path from 'node:path';
import { used, ic, logo, page } from './lib.mjs';
import { n1, n2, n3, n4 } from './pages-consola.mjs';
import { v1, v2, v3, v4 } from './pages-portal.mjs';

const out = path.resolve(import.meta.dirname, '..');
const write = (name, html) => {
  fs.writeFileSync(path.join(out, name), html);
  used.clear();
};

// Each builder registers its icons while it renders, so the sprite must be filled before write().
for (const [name, fn] of [['n1-login.html', n1], ['n2-resumen.html', n2], ['n3-colaboradores.html', n3], ['n4-error-reaper.html', n4], ['v1-inicio.html', v1], ['v2-liquidacion.html', v2], ['v3-archivo-expuesto.html', v3], ['v4-error-reaper.html', v4]]) {
  write(name, fn());
}

// ---------------------------------------------------------------- gallery
const card = ({ n, caption, img, href, tag, tone }) => `
<a href="${href}" class="group flex min-w-0 flex-col">
  <div class="mb-3 flex items-center gap-2.5">
    <span class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-2xs ${tone === 'attack' ? 'border-ink bg-ink text-white' : tone === 'shield' ? 'border-accent-700 bg-accent-700 text-white' : 'border-line-strong bg-surface text-ink-2'}">${n}</span>
    <span class="h-px flex-1 bg-line-strong"></span>
  </div>
  <div class="overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_1px_rgb(17_22_28/0.04)] transition group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-[0_6px_18px_-8px_rgb(17_22_28/0.25)]">
    <img src="${img}" alt="${caption.replace(/"/g, '&quot;')}" loading="lazy" class="block aspect-[16/10] w-full object-cover object-top">
  </div>
  <p class="mt-3 text-sm font-medium leading-5 text-ink">${caption}</p>
  <p class="mt-1.5 flex items-center gap-2 font-mono text-2xs text-ink-3">${tag}<span class="ml-auto inline-flex items-center gap-1 text-accent-700 opacity-0 transition group-hover:opacity-100">abrir${ic('arrow-up-right', 'size-3')}</span></p>
</a>`;

const row = (title, sub, cols, cards) => `
<section class="mt-12">
  <div class="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
    <h2 class="text-xl font-semibold tracking-tight">${title}</h2>
    <p class="font-mono text-xs text-ink-3">${sub}</p>
  </div>
  <div class="grid gap-x-5 gap-y-9 sm:grid-cols-2 ${cols}">${cards.map(card).join('')}</div>
</section>`;

const consola = [
  { n: 1, caption: '1 · Admin inicia sesión', img: 'shots/n1-login.png', href: 'n1-login.html', tag: 'n1-login.html', tone: 'plain' },
  { n: 2, caption: '2 · Consola protegida', img: 'shots/n2-resumen.png', href: 'n2-resumen.html', tag: 'n2-resumen.html', tone: 'plain' },
  { n: 3, caption: '3 · Colaboradores', img: 'shots/n3-colaboradores.png', href: 'n3-colaboradores.html', tag: 'n3-colaboradores.html', tone: 'plain' },
  { n: 4, caption: '4 · Atacante sin Reaper: se salta el login y ve esta misma consola', img: 'shots/n2-resumen.png', href: 'n2-resumen.html', tag: 'reutiliza n2 · sin Reaper', tone: 'attack' },
  { n: 5, caption: '5 · Atacante con Reaper: error creíble', img: 'shots/n4-error-reaper.png', href: 'n4-error-reaper.html', tag: 'n4-error-reaper.html', tone: 'shield' },
];
const portal = [
  { n: 1, caption: '1 · Inicio del colaborador', img: 'shots/v1-inicio.png', href: 'v1-inicio.html', tag: 'v1-inicio.html', tone: 'plain' },
  { n: 2, caption: '2 · Liquidación', img: 'shots/v2-liquidacion.png', href: 'v2-liquidacion.html', tag: 'v2-liquidacion.html', tone: 'plain' },
  { n: 3, caption: '3 · Atacante sin Reaper: lee archivos del servidor', img: 'shots/v3-archivo-expuesto.png', href: 'v3-archivo-expuesto.html', tag: 'GET /@fs/etc/passwd?import&amp;raw', tone: 'attack' },
  { n: 4, caption: '4 · Atacante con Reaper: error creíble', img: 'shots/v4-error-reaper.png', href: 'v4-error-reaper.html', tag: 'v4-error-reaper.html', tone: 'shield' },
];

const html = page({ title: 'Storyboard · Bruma Precisión', desc: 'Dirección B Precisión: storyboard de las pantallas de Bruma Consola y Bruma Portal.' }, `<body class="min-h-dvh">
<!--SPRITE-->
<header class="border-b border-line bg-surface">
  <div class="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-8">
    ${logo('size-7')}
    <div class="flex items-baseline gap-3"><h1 class="text-lg font-semibold tracking-tight">Bruma · storyboard</h1><span class="font-mono text-xs text-ink-3">Dirección B · Precisión</span></div>
    <div class="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-2xs text-ink-3">
      <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-full border border-line-strong bg-surface"></i>flujo normal</span>
      <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-full bg-ink"></i>atacante sin Reaper</span>
      <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-full bg-accent-700"></i>atacante con Reaper</span>
    </div>
  </div>
</header>
<main class="mx-auto max-w-[1480px] px-5 pb-20 sm:px-8">
  ${row('Consola', 'Next.js 15 · App Router · Tailwind 4 · consola de administración', 'xl:grid-cols-5', consola)}
  ${row('Portal', 'React + Vite en servidor de desarrollo expuesto · host de pruebas', 'xl:grid-cols-4', portal)}
</main>
</body>`);
write('index.html', html);
console.log('built');
