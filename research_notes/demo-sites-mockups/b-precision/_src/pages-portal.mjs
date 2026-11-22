// Bruma Portal (React SPA on a Vite dev server, staging host): v1 inicio, v2 liquidacion, v3 raw file, v4 error.
import { ic, logo, page, clp, rut, pay, kbd, dot, status, seg, btn, avatar } from './lib.mjs';

const HOST = 'staging.bruma-rrhh.test';

const staging = () => `
<div class="flex h-7 items-center justify-center gap-2 border-b border-warn-200 bg-warn-50 px-4 font-mono text-2xs text-warn-800">
  <span class="size-1.5 shrink-0 rounded-full bg-warn-500"></span>
  <span class="font-medium uppercase tracking-[0.08em]">Entorno de pruebas</span>
</div>`;

const TABS = [['home-simple', 'Inicio', 'v1-inicio.html'], ['page', 'Liquidaciones', 'v2-liquidacion.html'], ['sun-light', 'Vacaciones', '#'], ['folder', 'Documentos', '#']];

const header = (active) => `
<header class="sticky top-0 z-30 border-b border-line bg-surface">
  <div class="mx-auto flex h-14 max-w-[1120px] items-center gap-8 px-4 sm:px-6">
    <a href="v1-inicio.html" class="flex items-center gap-2.5">${logo('size-6')}<span class="text-base font-semibold tracking-tight">Bruma</span><span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Portal</span></a>
    <nav class="ml-2 hidden h-full items-stretch gap-1 md:flex" aria-label="Principal">
      ${TABS.map(([, l, h]) => `<a href="${h}" ${l === active ? 'aria-current="page"' : ''} class="relative flex items-center px-3 text-sm ${l === active ? 'font-medium text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent-600' : 'text-ink-3 hover:text-ink'}">${l}</a>`).join('')}
    </nav>
    <div class="ml-auto flex items-center gap-1.5">
      <button type="button" class="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken" aria-label="Ayuda">${ic('help-circle', 'size-[18px]')}</button>
      <button type="button" class="flex h-8 items-center gap-2 rounded-md border border-transparent pl-1 pr-1.5 hover:border-line hover:bg-canvas sm:pr-2">
        ${avatar('MF', 0, 'size-6 text-2xs')}<span class="hidden text-sm font-medium sm:inline">Matías Fuentes</span>${ic('nav-arrow-down', 'hidden size-4 text-ink-3 sm:block')}
      </button>
    </div>
  </div>
</header>`;

const bottomNav = (active) => `
<nav class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Principal">
  ${TABS.map(([i, l, h]) => `<a href="${h}" class="flex flex-col items-center gap-1 py-2.5 text-2xs ${l === active ? 'font-medium text-accent-700' : 'text-ink-3'}">${ic(i, 'size-5')}${l}</a>`).join('')}
</nav>`;

const portal = ({ title, active, body }) =>
  page({ title: `${title} · Bruma Portal`, desc: 'Portal del colaborador de Bruma Remuneraciones (staging).' },
    `<body class="min-h-dvh">
<!--SPRITE-->
${staging()}
${header(active)}
<main class="mx-auto max-w-[1120px] px-4 pb-24 pt-6 sm:px-6 md:pb-12 md:pt-8">${body}</main>
${bottomNav(active)}
</body>`);

const card = (inner, c = '') => `<section class="overflow-hidden rounded-lg border border-line bg-surface ${c}">${inner}</section>`;
const cardHead = (t, right = '') => `<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-3"><h2 class="text-base font-semibold tracking-tight">${t}</h2>${right}</div>`;
const label = (t) => `<span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">${t}</span>`;

// ---------------------------------------------------------------- v1 inicio
function monthTrack() {
  const day = (d) => `${((d - 0.5) / 30 * 100).toFixed(2)}%`;
  const ticks = Array.from({ length: 30 }, (_, i) => {
    const d = i + 1;
    const cls = d === 22 ? 'h-9 bg-ink' : d === 30 ? 'h-9 bg-accent-700' : d === 28 ? 'h-7 bg-accent-500' : d < 22 ? 'h-5 bg-accent-600/70' : 'h-5 bg-line-strong';
    return `<span class="w-[3px] rounded-full ${cls}"></span>`;
  }).join('');
  return `
<div class="relative mb-4 mt-9 pb-8 pt-5">
  <span class="absolute whitespace-nowrap font-mono text-2xs text-ink-3" style="left:${day(28)};top:-4px;transform:translateX(-100%)">28</span>
  <div class="flex h-9 items-end justify-between px-0.5">${ticks}</div>
  <span class="absolute bottom-0 whitespace-nowrap font-mono text-2xs font-medium text-ink" style="left:${day(22)};transform:translateX(-50%)">hoy<span class="hidden sm:inline"> · 22</span></span>
  <span class="absolute bottom-0 right-0 font-mono text-2xs font-medium text-accent-700">30 · pago</span>
  <span class="absolute bottom-0 left-0 font-mono text-2xs text-ink-4">1 nov</span>
</div>`;
}

function vacationMeter() {
  const cells = Array.from({ length: 15 }, (_, i) => {
    const used = i >= 12.5 ? 0 : 1;
    if (i === 12) return `<span class="h-7 rounded-[2px] bg-line-strong/70"><span class="block h-full w-1/2 rounded-l-[2px] bg-accent-600"></span></span>`;
    return `<span class="h-7 rounded-[2px] ${used ? 'bg-accent-600' : 'bg-line-strong/70'}"></span>`;
  }).join('');
  return `<div class="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-[3px]" role="img" aria-label="12,5 de 15 días disponibles">${cells}</div>`;
}

const LIQS = [['Octubre 2026', 'Pagada el 30 oct', 1_086_540, 'v2-liquidacion.html'], ['Septiembre 2026', 'Pagada el 30 sep', 1_071_915, '#'], ['Agosto 2026', 'Pagada el 28 ago', 1_086_540, '#']];
const DOCS = [
  ['Contrato de trabajo', 'PDF', ['ok', 'Vigente']],
  ['Anexo de contrato 2026', 'PDF', ['warn', 'Firma pendiente']],
  ['Certificado de antigüedad', 'PDF', ['idle', 'Disponible']],
];

export function v1() {
  const body = `
<div class="flex flex-wrap items-end justify-between gap-4">
  <div>
    ${label('Domingo 22 de noviembre de 2026')}
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">Hola, Matías</h1>
  </div>
  <div class="flex items-center gap-2">
    ${btn('Certificados', { icon: ic('badge-check', 'size-4') })}
    ${btn('Solicitar vacaciones', { kind: 'primary', icon: ic('calendar', 'size-4') })}
  </div>
</div>

<div class="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
  ${card(`
    <div class="p-5 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-2">${label('Próximo pago')}<span class="inline-flex items-center gap-1.5 rounded-xs border border-line px-1.5 py-px font-mono text-2xs text-ink-3">${ic('bank', 'size-3.5')}Transferencia · •••• 4821</span></div>
      <div class="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <div class="text-3xl font-semibold tracking-tight">30 de noviembre</div>
          <p class="mt-1 text-base text-ink-3">lunes · en 8 días</p>
        </div>
        <div class="sm:text-right">
          <p class="text-xs text-ink-3">Sueldo líquido estimado</p>
          <p class="text-2xl font-semibold tracking-tight tabular-nums">${clp(pay.liquido)}</p>
        </div>
      </div>
      ${monthTrack()}
    </div>`)}

  ${card(`
    ${cardHead('Saldo de vacaciones', `<span class="font-mono text-2xs text-ink-3">2025–26</span>`)}
    <div class="p-5">
      <div class="flex items-baseline gap-2"><span class="text-3xl font-semibold tracking-tight tabular-nums">12,5</span><span class="text-base text-ink-3">de 15 días hábiles</span></div>
      <div class="mt-4">${vacationMeter()}</div>
      <div class="mt-5 flex items-start gap-2.5 rounded-md bg-canvas px-3 py-2.5 text-sm text-ink-2">${ic('calendar-check', 'mt-0.5 size-4 text-accent-600')}<span>Próximo feriado: <b class="font-medium">8 dic</b>, Inmaculada Concepción.</span></div>
      <div class="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm"><span class="text-ink-3">Solicitudes</span><span class="inline-flex items-center gap-2 text-ink-2">${dot('idle')}Ninguna pendiente</span></div>
    </div>`)}
</div>

<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
  ${card(`
    ${cardHead('Últimas liquidaciones', `<a href="v2-liquidacion.html" class="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline">Ver todas${ic('arrow-up-right', 'size-4')}</a>`)}
    <ul>
      ${LIQS.map(([m, s, v, h], i) => `
      <li class="${i ? 'border-t border-line' : ''}">
        <a href="${h}" class="flex items-center gap-4 px-5 py-3.5 hover:bg-canvas/60">
          <span class="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-canvas text-ink-3">${ic('page', 'size-[18px]')}</span>
          <span class="min-w-0 flex-1"><span class="block font-medium">${m}</span></span>
          <span class="hidden sm:block">${status('ok', 'Pagada', 'text-xs text-ink-2')}</span>
          <span class="text-right"><span class="block font-mono text-sm tabular-nums">${clp(v)}</span></span>
          <span class="grid size-8 place-items-center rounded-md border border-line-strong text-ink-2" aria-label="Descargar PDF">${ic('download', 'size-4')}</span>
        </a>
      </li>`).join('')}
    </ul>`)}

  ${card(`
    ${cardHead('Documentos', `<span class="font-mono text-2xs text-ink-3">3</span>`)}
    <ul>
      ${DOCS.map(([n, m, [k, l]], i) => `
      <li class="flex items-center gap-3 px-5 py-3 ${i ? 'border-t border-line' : ''}">
        ${ic('page', 'size-[18px] text-ink-3')}
        <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${n}</span><span class="block text-xs text-ink-3">${m}</span></span>
        ${status(k, l, 'text-xs text-ink-2')}
      </li>`).join('')}
    </ul>`)}
</div>`;
  return portal({ title: 'Inicio', active: 'Inicio', body });
}

// ---------------------------------------------------------------- v2 liquidacion
const row = (c, d, v, { strong = false, neg = false } = {}) => `
<tr class="border-t border-line ${strong ? 'bg-canvas/70 font-medium' : ''}">
  <td class="px-5 py-2 ${strong ? '' : 'text-ink-2'}">${c}</td>
  <td class="hidden px-3 py-2 font-mono text-xs text-ink-3 sm:table-cell">${d}</td>
  <td class="px-5 py-2 text-right font-mono tabular-nums">${neg ? clp(-v) : clp(v)}</td>
</tr>`;
const sect = (t) => `<tr class="border-t border-line bg-canvas"><th colspan="3" scope="colgroup" class="px-5 py-2 text-left font-mono text-2xs font-medium uppercase tracking-[0.08em] text-ink-3">${t}</th></tr>`;
const meta = (k, v) => `<div><dt class="text-xs text-ink-3">${k}</dt><dd class="mt-0.5 text-sm">${v}</dd></div>`;

export function v2() {
  const p = pay;
  const pctN = (n) => (n / p.haberes) * 100;
  const pct = (n) => pctN(n).toFixed(1).replace('.', ',');
  const body = `
<div class="mt-3 flex flex-wrap items-end justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Liquidación de sueldo</h1>
  <div class="inline-flex h-8 items-center rounded-md border border-line bg-sunken p-0.5 text-sm">
    <button type="button" class="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-surface" aria-label="Mes anterior">${ic('nav-arrow-left', 'size-4')}</button>
    <span class="px-3 font-medium">Octubre 2026</span>
    <button type="button" disabled class="grid size-7 place-items-center rounded-sm text-ink-4" aria-label="Mes siguiente">${ic('nav-arrow-right', 'size-4')}</button>
  </div>
</div>

<div class="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
  <div class="order-2 lg:order-1">
  ${card(`
    <dl class="grid gap-x-6 gap-y-3.5 border-b border-line px-5 py-4 sm:grid-cols-2">
      ${meta('Empleador', 'Distribuidora Quillay SpA')}
      ${meta('Colaborador', 'Matías Fuentes Rojas')}
      ${meta('Período', '1 al 31 de octubre de 2026')}
      ${meta('Cargo', 'Analista de operaciones')}
    </dl>
    <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="sr-only"><tr><th>Concepto</th><th>Detalle</th><th>Monto</th></tr></thead>
      <tbody>
        ${sect('Haberes imponibles')}
        ${row('Sueldo base', '', p.base)}
        ${row('Gratificación legal', '', p.grat)}
        ${row('Total imponible', '', p.imp, { strong: true })}
        ${sect('Haberes no imponibles')}
        ${row('Asignación de colación', '', p.col)}
        ${row('Asignación de movilización', '', p.mov)}
        ${row('Total haberes', '', p.haberes, { strong: true })}
        ${sect('Descuentos legales')}
        ${row('AFP Modelo', '', p.afp, { neg: true })}
        ${row('Salud · Fonasa', '', p.salud, { neg: true })}
        ${row('Seguro de cesantía', '', p.ces, { neg: true })}
        ${row('Impuesto único de segunda categoría', '', p.impUnico, { neg: true })}
        ${row('Total descuentos legales', '', p.legales, { strong: true, neg: true })}
        ${sect('Otros descuentos')}
        ${row('Seguro complementario de salud', '', p.seguro, { neg: true })}
        ${row('Cuota crédito social', '', p.credito, { neg: true })}
      </tbody>
    </table>
    </div>
    <div class="flex items-center justify-between gap-4 border-t border-accent-200 bg-accent-50 px-5 py-4">
      <div class="min-w-0"><p class="font-mono text-2xs uppercase tracking-[0.08em] text-accent-800">Sueldo líquido a pagar</p></div>
      <p class="shrink-0 font-mono text-xl font-semibold tabular-nums text-accent-800">${clp(p.liquido)}</p>
    </div>`)}
  </div>

  <aside class="contents lg:sticky lg:top-[88px] lg:order-2 lg:block lg:space-y-4">
    ${card(`
      <div class="p-5">
        <div class="flex items-center justify-between">${label('Sueldo líquido')}${status('ok', 'Pagada', 'text-xs text-ink-2')}</div>
        <p class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">${clp(p.liquido)}</p>
        <div class="mt-5 space-y-2">
          ${btn('Descargar PDF', { kind: 'primary', icon: ic('download', 'size-4'), c: '!h-10 w-full !text-base' })}
          ${btn('Consultar una diferencia', { kind: 'secondary', icon: ic('help-circle', 'size-4'), c: '!h-10 w-full' })}
        </div>
        <p class="mt-3 flex items-center gap-1.5 font-mono text-2xs text-ink-4">${ic('page', 'size-3.5')}liquidacion-2026-10.pdf</p>
      </div>`, 'order-1 lg:order-none')}

    ${card(`
      ${cardHead('Cómo se compone', `<span class="font-mono text-2xs text-ink-3">sobre ${clp(p.haberes)}</span>`)}
      <div class="p-5">
        <div class="flex h-2.5 gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label="Composición de los haberes">
          <span class="bg-accent-700" style="width:${pctN(p.liquido).toFixed(2)}%"></span><span class="bg-accent-300" style="width:${pctN(p.legales).toFixed(2)}%"></span><span class="bg-line-strong" style="width:${pctN(p.otros).toFixed(2)}%"></span>
        </div>
        <ul class="mt-4 space-y-2 text-sm">
          ${[['bg-accent-700', 'Líquido', p.liquido], ['bg-accent-300', 'Descuentos legales', p.legales], ['bg-line-strong', 'Otros descuentos', p.otros]].map(([c, t, v]) => `<li class="flex items-center gap-2"><i class="size-2.5 rounded-[2px] ${c}"></i><span class="text-ink-2">${t}</span><span class="ml-auto font-mono text-xs text-ink-3">${pct(v)}%</span></li>`).join('')}
        </ul>
      </div>`, 'order-3 lg:order-none')}

  </aside>
</div>`;
  return portal({ title: 'Liquidación octubre 2026', active: 'Liquidaciones', body });
}

// ---------------------------------------------------------------- v3 raw Vite response (no styling on purpose)
export function v3() {
  const text = 'export default "root:x:0:0:root:/root:/bin/bash\\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\\nsync:x:4:65534:sync:/bin:/bin/sync\\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\\nnode:x:1000:1000::/home/node:/bin/bash\\n"';
  return `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, minimum-scale=0.1"><title>${HOST}:5173/@fs/etc/passwd?import&amp;raw</title></head><body style="margin: 0px;"><pre style="word-wrap: break-word; white-space: pre-wrap; margin: 8px; font: 13px Menlo, Monaco, 'Courier New', monospace; color: #000; background: #fff;">${text}</pre></body></html>
`;
}

// ---------------------------------------------------------------- v4 error (Reaper in front of the portal)
export function v4() {
  const ticks = Array.from({ length: 30 }, (_, i) => `<span class="w-[3px] rounded-full ${i >= 11 && i <= 17 ? 'h-2 bg-line' : 'h-5 bg-line-strong'}"></span>`).join('');
  const body = `<body class="min-h-dvh bg-canvas">
<!--SPRITE-->
<div class="flex min-h-dvh flex-col">
  <header class="border-b border-line bg-surface"><div class="mx-auto flex h-14 max-w-[1120px] items-center gap-2.5 px-4 sm:px-6">${logo('size-6')}<span class="text-base font-semibold tracking-tight">Bruma</span><span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Portal</span></div></header>
  <main class="flex flex-1 items-center justify-center px-4 py-12">
    <div class="w-full max-w-[480px] overflow-hidden rounded-lg border border-line bg-surface">
      <div class="px-6 pb-6 pt-7 sm:px-8">
        <div class="flex h-5 items-end justify-between" aria-hidden="true">${ticks}</div>
        <p class="mt-7 font-mono text-xs uppercase tracking-[0.1em] text-ink-4">Error 500</p>
        <h1 class="mt-2 text-balance text-xl font-semibold tracking-tight sm:text-2xl">No pudimos completar la solicitud.</h1>
        <p class="mt-2 text-base text-ink-3">Intenta nuevamente.</p>
        <div class="mt-6 flex flex-wrap gap-2">
          ${btn('Reintentar', { kind: 'primary', icon: ic('refresh-double', 'size-4'), c: '!h-9' })}
          ${btn('Ir al inicio', { kind: 'secondary', tag: 'a', href: 'v1-inicio.html', c: '!h-9' })}
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-3 sm:px-8">
        <span class="text-xs text-ink-3">ID de solicitud</span>
        <span class="flex items-center gap-2 font-mono text-sm text-ink-2">req_b04e62d7<button type="button" class="grid size-6 place-items-center rounded-sm text-ink-3 hover:bg-sunken" aria-label="Copiar">${ic('copy', 'size-4')}</button></span>
      </div>
    </div>
  </main>
</div>
</body>`;
  return page({ title: 'Error · Bruma Portal', desc: 'No pudimos completar la solicitud.' }, body);
}
