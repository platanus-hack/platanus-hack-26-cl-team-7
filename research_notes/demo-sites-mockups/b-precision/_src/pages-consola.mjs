// Bruma Consola (Next.js 15 admin console): n1 login, n2 resumen, n3 colaboradores, n4 error.
import { ic, logo, page, clp, rut, pay, kbd, dot, status, seg, btn, avatar } from './lib.mjs';

const WS = 'bruma-produccion'; // canary text, protected screens only (n2, n3)

// ---------------------------------------------------------------- shell
const NAV = [
  [['home-simple', 'Resumen', 'n2-resumen.html', 'resumen'], ['calculator', 'Nóminas', '#', 'nominas'], ['group', 'Colaboradores', 'n3-colaboradores.html', 'colaboradores'], ['page', 'Liquidaciones', '#', 'liquidaciones'], ['bank', 'Previred', '#', 'previred']],
  [['stats-up-square', 'Costos', '#', 'costos'], ['task-list', 'Informes', '#', 'informes']],
  [['key', 'Usuarios', '#', 'usuarios'], ['settings', 'Configuración', '#', 'config']],
];

const sidebar = (active) => `
<aside class="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[208px] shrink-0 flex-col border-r border-line px-3 lg:flex">
  <nav class="flex-1 overflow-y-auto py-4" aria-label="Principal">
    ${NAV.map((items, gi) => `
    ${gi ? '<div class="mx-2 my-3 h-px bg-line"></div>' : ''}
    ${items.map(([icon, label, href, key]) => {
      const on = key === active;
      return `<a href="${href}" ${on ? 'aria-current="page"' : ''} class="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm ${on ? 'border border-line bg-surface font-medium text-ink shadow-[0_1px_1px_rgb(17_22_28/0.04)]' : 'border border-transparent text-ink-2 hover:bg-sunken'}">
        ${ic(icon, `size-4 ${on ? 'text-accent-600' : 'text-ink-3'}`)}<span>${label}</span>
      </a>`;
    }).join('')}`).join('')}
  </nav>
</aside>`;

const topbar = () => `
<header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:px-0">
  <div class="flex items-center gap-2.5 lg:w-[208px] lg:shrink-0 lg:px-4">
    <button type="button" class="-ml-1 grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken lg:hidden" aria-label="Abrir menú">${ic('menu', 'size-5')}</button>
    ${logo('size-6')}
    <span class="hidden items-baseline gap-2 sm:flex"><span class="text-base font-semibold tracking-tight">Bruma</span><span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Consola</span></span>
  </div>
  <span class="hidden h-5 w-px bg-line lg:block"></span>
  <button type="button" class="flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface pl-2.5 pr-1.5 hover:bg-canvas" aria-label="Cambiar de espacio de trabajo">
    ${dot('ok')}<span class="truncate font-mono text-sm text-ink">${WS}</span>${ic('nav-arrow-down', 'size-4 text-ink-3')}
  </button>
  <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
    <button type="button" class="hidden h-8 w-[260px] items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-sm text-ink-4 hover:border-line-strong md:flex xl:w-[340px]">
      ${ic('search', 'size-4')}<span class="truncate">Buscar</span><span class="ml-auto">${kbd('⌘K', 'px-1.5')}</span>
    </button>
    <button type="button" class="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken md:hidden" aria-label="Buscar">${ic('search', 'size-[18px]')}</button>
    <button type="button" class="flex h-8 items-center gap-1.5 rounded-md border border-transparent pl-1 pr-1.5 hover:border-line hover:bg-canvas" aria-label="Menú de cuenta">
      ${avatar('CM', 0, 'size-6 text-2xs')}${ic('nav-arrow-down', 'hidden size-4 text-ink-3 lg:block')}
    </button>
  </div>
</header>`;

const shell = ({ title, active, body, drawer = '' }) =>
  page({ title: `${title} · Bruma Consola`, desc: 'Bruma Consola: administración de remuneraciones.' },
    `<body class="min-h-dvh">
<!--SPRITE-->
${topbar()}
<div class="flex">
  ${sidebar(active)}
  <main class="min-w-0 flex-1">${body}</main>
  ${drawer}
</div>
</body>`);

const panelHead = (title, right = '') => `
<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
  <h2 class="text-base font-semibold tracking-tight">${title}</h2>
  ${right}
</div>`;

const th = (t, c = '') => `<th scope="col" class="whitespace-nowrap px-4 py-2 text-left font-mono text-2xs font-medium uppercase tracking-[0.06em] text-ink-3 ${c}">${t}</th>`;

// ---------------------------------------------------------------- n1 login
export function n1() {
  const check = `<span class="grid size-4 place-items-center rounded-xs border border-line-strong bg-surface text-white peer-checked:border-accent-700 peer-checked:bg-accent-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">${ic('check', 'size-3')}</span>`;
  const body = `<body class="min-h-dvh bg-surface">
<!--SPRITE-->
<div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]">
  <main class="flex min-h-dvh flex-col px-6 py-6 sm:px-12 lg:px-16 lg:py-8">
    <div class="flex items-center gap-2.5">
      ${logo('size-7')}
      <span class="text-lg font-semibold tracking-tight">Bruma</span><span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Consola</span>
    </div>

    <div class="mx-auto my-auto w-full max-w-[380px] py-12">
      <h1 class="text-xl font-semibold tracking-tight">Inicia sesión</h1>

      <form class="mt-8 space-y-5" onsubmit="return false">
        <div>
          <label for="email" class="mb-1.5 block text-sm font-medium text-ink-2">Correo</label>
          <div class="flex h-10 items-center gap-2 rounded-md border border-accent-600 bg-surface px-3 shadow-[0_0_0_3px_var(--color-accent-100)]">
            ${ic('mail', 'size-4 text-ink-3')}
            <input id="email" type="email" value="camila.munoz@quillay.test" autocomplete="username" class="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-4">
          </div>
        </div>
        <div>
          <label for="pw" class="mb-1.5 block text-sm font-medium text-ink-2">Contraseña</label>
          <div class="flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-3">
            ${ic('lock', 'size-4 text-ink-3')}
            <input id="pw" type="password" value="••••••••••••" autocomplete="current-password" class="min-w-0 flex-1 bg-transparent text-base text-ink outline-none">
            <button type="button" class="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink" aria-label="Mostrar contraseña">${ic('eye-closed', 'size-4')}</button>
          </div>
        </div>
        <label class="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
          <input type="checkbox" checked class="peer sr-only">${check}
          Mantener sesión
        </label>
        <button type="submit" class="flex h-10 w-full items-center justify-center rounded-md bg-accent-700 text-base font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-accent-800">Iniciar sesión</button>
      </form>

      <button type="button" class="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface text-base text-ink hover:bg-canvas">${ic('key', 'size-4')}Continuar con SSO</button>
    </div>

    <footer class="text-xs text-ink-3"><a href="#" class="hover:text-ink">Soporte</a></footer>
  </main>

  <aside class="relative hidden overflow-hidden bg-accent-900 text-white lg:flex lg:items-end lg:p-12" aria-hidden="true">
    <div class="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_70%_40%,#000,transparent_75%)]"></div>
    <p class="relative max-w-[420px] text-2xl font-medium tracking-tight text-white/85">Remuneraciones al día.</p>
  </aside>
</div>
</body>`;
  return page({ title: 'Inicia sesión · Bruma Consola', desc: 'Acceso a Bruma Consola.' }, body);
}

// ---------------------------------------------------------------- n2 resumen
const MONTHS = ['nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct'];
const TOTALS = [166.9, 178.4, 168.2, 169.5, 171.0, 172.3, 174.8, 176.1, 177.0, 180.9, 183.6, 187.4];

function chart({ w, h }) {
  const padL = 44, padR = 6, padT = 10, padB = 24, max = 200;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const y = (v) => padT + plotH - (v / max) * plotH;
  const band = plotW / 12, bw = Math.min(30, band * 0.56);
  let g = '';
  for (const v of [0, 100, 200]) {
    g += `<line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--color-line)" ${v === 0 ? 'stroke-width="1"' : 'stroke-dasharray="2 4"'}/>`;
    g += `<text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" class="fill-ink-4 font-mono text-[11px]">${v === 0 ? '0' : v + 'M'}</text>`;
  }
  const bars = TOTALS.map((t, i) => {
    const x = padL + band * i + (band - bw) / 2;
    const liq = t * 0.704, desc = t * 0.176;
    const last = i === 11;
    const seg = (a, b, fill, op = 1) => `<rect x="${x.toFixed(1)}" y="${y(b).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(a) - y(b)).toFixed(1)}" fill="${fill}" opacity="${op}"/>`;
    return `<g>${seg(0, liq, 'var(--color-accent-700)', last ? 1 : 0.9)}${seg(liq, liq + desc, 'var(--color-accent-300)')}${seg(liq + desc, t, 'var(--color-line-strong)')}
      <text x="${(x + bw / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" class="${last ? 'fill-ink font-medium' : 'fill-ink-3'} font-mono text-[11px]">${MONTHS[i]}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="block h-auto w-full" role="img" aria-label="Costo de nómina por mes, en millones de pesos">${g}${bars}</svg>`;
}

const kpi = (label, value, deltaText) => `
<div class="flex flex-col gap-3 bg-surface p-5">
  <span class="font-mono text-2xs uppercase tracking-[0.06em] text-ink-3">${label}</span>
  <div class="flex items-baseline justify-between gap-3">
    <div class="min-w-0 text-2xl font-semibold tracking-tight tabular-nums">${value}</div>
    <span class="inline-flex shrink-0 items-center gap-0.5 rounded-xs bg-accent-50 px-1 font-mono text-2xs text-accent-700">${ic('arrow-up-right', 'size-3')}${deltaText}</span>
  </div>
</div>`;

const TIMELINE = [
  ['20 nov', 'Novedades', 'ok'],
  ['21 nov', 'Cálculo', 'ok'],
  ['22–27 nov', 'Revisión', 'warn'],
  ['28 nov', 'Aprobación', 'idle'],
  ['30 nov', 'Pago', 'idle'],
  ['10 dic', 'Previred', 'idle'],
];

const PROCESOS = [
  ['Nómina noviembre', '248', 133_904_120, 'warn', 'En revisión'],
  ['Bono de Navidad', '248', 24_800_000, 'idle', 'Borrador'],
  ['Finiquitos octubre', '3', 8_412_700, 'ok', 'Aprobado'],
  ['Nómina octubre', '246', 131_876_540, 'done', 'Cerrada'],
  ['Nómina septiembre', '245', 130_254_910, 'done', 'Cerrada'],
];

export function n2() {
  const procRows = PROCESOS.map(([name, n, tot, st, stl]) => `
    <tr class="border-t border-line hover:bg-canvas/60">
      <td class="px-4 py-3 font-medium">${name}</td>
      <td class="hidden px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-2 md:table-cell">${n}</td>
      <td class="px-4 py-3 text-right font-mono text-sm tabular-nums">${clp(tot)}</td>
      <td class="px-4 py-3">${status(st, stl)}</td>
    </tr>`).join('');

  const body = `
<div class="px-4 py-5 md:px-6 md:py-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <h1 class="text-2xl font-semibold tracking-tight">Resumen</h1>
    <div class="flex flex-wrap items-center gap-2">
      ${seg(['Mes', 'Trimestre', 'Año'], 0)}
      ${btn('Nueva nómina', { kind: 'primary', icon: ic('plus', 'size-4') })}
    </div>
  </div>

  <section class="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3" aria-label="Indicadores">
    ${kpi('Costo de nómina', '$187.432.610', '2,1%')}
    ${kpi('Sueldo líquido', '$131.876.540', '1,2%')}
    ${kpi('Colaboradores', '248', '2')}
  </section>

  <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
    <section class="overflow-hidden rounded-lg border border-line bg-surface">
      ${panelHead('Costo mensual', `<div class="flex items-center gap-4 text-xs text-ink-3">
        <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-[2px] bg-accent-700"></i>Líquido</span>
        <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-[2px] bg-accent-300"></i>Descuentos</span>
        <span class="inline-flex items-center gap-2"><i class="size-2.5 rounded-[2px] bg-line-strong"></i>Aportes</span>
      </div>`)}
      <div class="px-4 pb-3 pt-4">
        <div class="hidden sm:block">${chart({ w: 760, h: 270 })}</div>
        <div class="sm:hidden">${chart({ w: 340, h: 250 })}</div>
      </div>
    </section>

    <section class="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      ${panelHead('Cierre')}
      <ol class="flex flex-1 flex-col px-4 py-4">
        ${TIMELINE.map(([d, t, k], i) => `
        <li class="relative flex min-h-11 flex-1 gap-3 last:flex-none">
          ${i < TIMELINE.length - 1 ? '<span class="absolute bottom-0 left-[3px] top-[18px] w-px bg-line"></span>' : ''}
          <span class="relative z-10 mt-[7px] flex h-1.5">${dot(k)}</span>
          <div class="flex min-w-0 flex-1 items-baseline justify-between gap-3"><span class="text-sm font-medium ${k === 'idle' ? 'text-ink-2' : ''}">${t}</span><span class="shrink-0 font-mono text-2xs text-ink-3">${d}</span></div>
        </li>`).join('')}
      </ol>
    </section>
  </div>

  <section class="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
    ${panelHead('Nóminas')}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-canvas/70"><tr>
          ${th('Proceso')}${th('Colab.', 'hidden text-right md:table-cell')}${th('Líquido', 'text-right')}${th('Estado')}
        </tr></thead>
        <tbody>${procRows}</tbody>
      </table>
    </div>
  </section>
</div>`;
  return shell({ title: 'Resumen', active: 'resumen', body });
}

// ---------------------------------------------------------------- n3 colaboradores
const COLABS = [
  ['Josefa Contreras Vidal', 14_220_881, 'Ejecutiva comercial', 'Comercial', 'ok', 'Activo'],
  ['Sebastián Herrera Pino', 11_904_337, 'Jefe de bodega', 'Operaciones', 'ok', 'Activo'],
  ['Matías Fuentes Rojas', 12_345_678, 'Analista de operaciones', 'Operaciones', 'ok', 'Activo', true],
  ['Valentina Soto Ibarra', 13_077_452, 'Contadora', 'Finanzas', 'ok', 'Activo'],
  ['Ignacio Paredes Núñez', 17_552_109, 'Conductor de reparto', 'Operaciones', 'ok', 'Activo'],
  ['Catalina Rojas Meza', 16_340_276, 'Diseñadora de producto', 'Producto', 'idle', 'Vacaciones'],
  ['Benjamín Olivares Tapia', 15_118_903, 'Desarrollador de software', 'Producto', 'ok', 'Activo'],
  ['Francisca Lagos Bravo', 14_786_520, 'Analista de personas', 'Personas', 'warn', 'Licencia'],
  ['Tomás Gallardo Vera', 18_201_645, 'Vendedor de terreno', 'Comercial', 'ok', 'Activo'],
  ['Antonia Silva Carrasco', 17_093_218, 'Asistente administrativa', 'Personas', 'ok', 'Activo'],
];

const field = (k, v, mono = false) => `<div><dt class="text-xs text-ink-3">${k}</dt><dd class="mt-0.5 text-sm ${mono ? 'font-mono' : ''}">${v}</dd></div>`;

function drawer() {
  return `
<aside class="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[340px] shrink-0 flex-col border-l border-line bg-surface xl:flex" aria-label="Detalle del colaborador">
  <div class="flex items-start gap-3.5 px-5 pb-2 pt-6">
    ${avatar('MF', 0, 'size-12 text-base')}
    <div class="min-w-0 flex-1 pt-0.5">
      <h2 class="text-lg font-semibold leading-6 tracking-tight">Matías Fuentes Rojas</h2>
      <p class="text-sm text-ink-3">Analista de operaciones</p>
    </div>
    <button type="button" class="-mr-1.5 -mt-1 grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunken" aria-label="Cerrar">${ic('xmark', 'size-4')}</button>
  </div>

  <div class="flex-1 overflow-y-auto px-5 py-5">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-4">
      ${field('RUT', rut(12_345_678), true)}
      ${field('Contrato', 'Indefinido')}
      ${field('Centro', 'Operaciones')}
      ${field('Ingreso', '14 mar 2022')}
    </dl>

    <h3 class="mb-3 mt-7 font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Octubre 2026</h3>
    <div class="rounded-lg border border-line">
      ${[['Haberes', clp(pay.haberes)], ['Descuentos', clp(-(pay.legales + pay.otros))]].map(([k, v]) => `<div class="flex justify-between border-b border-line px-3 py-2.5 text-sm"><span class="text-ink-3">${k}</span><span class="font-mono tabular-nums">${v}</span></div>`).join('')}
      <div class="flex items-center justify-between bg-accent-50 px-3 py-3"><span class="text-sm font-medium text-accent-800">Líquido</span><span class="font-mono text-base font-semibold tabular-nums text-accent-800">${clp(pay.liquido)}</span></div>
    </div>
  </div>

  <div class="flex items-center gap-2 border-t border-line px-5 py-3">
    ${btn('Ver liquidaciones', { kind: 'primary', icon: ic('page', 'size-4'), c: 'flex-1' })}
    ${btn('Editar')}
  </div>
</aside>`;
}

export function n3() {
  const chip = (k, v) => `<span class="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface pl-2 pr-1 text-sm"><span class="text-ink-3">${k}</span><span class="font-medium">${v}</span><button type="button" class="grid size-5 place-items-center rounded-xs text-ink-3 hover:bg-sunken" aria-label="Quitar filtro">${ic('xmark', 'size-3.5')}</button></span>`;
  const rows = COLABS.map(([name, r, cargo, ccn, st, stl, sel], i) => {
    const ini = name.split(' ').slice(0, 2).map((s) => s[0]).join('');
    return `<tr class="border-t border-line ${sel ? 'bg-accent-50/70 shadow-[inset_2px_0_0_var(--color-accent-600)]' : 'hover:bg-canvas/60'}">
      <td class="px-4 py-3"><div class="flex items-center gap-2.5">${avatar(ini, i, 'size-7 text-2xs')}<div class="min-w-0"><div class="truncate font-medium">${name}</div><div class="truncate text-xs text-ink-3 md:hidden">${cargo}</div></div></div></td>
      <td class="hidden whitespace-nowrap px-3 py-3 font-mono text-xs text-ink-2 xl:table-cell">${rut(r)}</td>
      <td class="hidden px-3 py-3 text-ink-2 md:table-cell">${cargo}</td>
      <td class="hidden px-3 py-3 text-ink-2 lg:table-cell">${ccn}</td>
      <td class="px-3 py-3 pr-4">${status(st, stl)}</td>
    </tr>`;
  }).join('');

  const body = `
<div class="px-4 py-5 md:px-6 md:py-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <h1 class="flex items-baseline gap-3 text-2xl font-semibold tracking-tight">Colaboradores <span class="font-mono text-base font-normal text-ink-3">248</span></h1>
    ${btn('Nuevo colaborador', { kind: 'primary', icon: ic('user-plus', 'size-4') })}
  </div>

  <section class="mt-5 overflow-hidden rounded-lg border border-line bg-surface">
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <div class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 sm:max-w-[280px] sm:flex-none sm:basis-[280px]">
        ${ic('search', 'size-4 text-ink-3')}<span class="truncate text-sm text-ink-4">Buscar</span>
      </div>
      <div class="flex items-center gap-2 overflow-x-auto">
        ${chip('Centro', 'Operaciones')}
        ${chip('Contrato', 'Indefinido')}
        <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-line-strong px-2 text-sm text-ink-3 hover:border-ink-4 hover:text-ink">${ic('plus', 'size-3.5')}Filtro</button>
      </div>
    </div>

    <table class="w-full table-fixed text-sm">
      <colgroup>
        <col class="w-[62%] md:w-[240px]"><col class="hidden w-[132px] xl:table-column"><col class="hidden md:table-column"><col class="hidden w-[140px] lg:table-column"><col class="w-[38%] md:w-[132px]">
      </colgroup>
      <thead class="bg-canvas/70"><tr>
        ${th('Colaborador')}${th('RUT', 'hidden !px-3 xl:table-cell')}${th('Cargo', 'hidden !px-3 md:table-cell')}${th('Centro', 'hidden !px-3 lg:table-cell')}${th('Estado', '!px-3')}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-3">
      <span class="font-mono">1–10 de 248</span>
      <span class="flex items-center gap-1">${btn('', { kind: 'secondary', icon: ic('nav-arrow-left', 'size-4'), c: '!px-2', disabled: true })}${btn('', { kind: 'secondary', icon: ic('nav-arrow-right', 'size-4'), c: '!px-2' })}</span>
    </div>
  </section>
</div>`;
  return shell({ title: 'Colaboradores', active: 'colaboradores', body, drawer: drawer() });
}

// ---------------------------------------------------------------- n4 error (what the attacker sees with Reaper in front)
export function n4() {
  const body = `<body class="min-h-dvh bg-surface">
<!--SPRITE-->
<div class="flex min-h-dvh flex-col">
  <header class="flex h-14 items-center gap-2.5 border-b border-line px-4 sm:px-6">
    ${logo('size-6')}<span class="text-base font-semibold tracking-tight">Bruma</span><span class="font-mono text-2xs uppercase tracking-[0.08em] text-ink-3">Consola</span>
  </header>
  <main class="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-16">
    <div class="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_70%)]"></div>
    <div class="relative w-full max-w-[460px]">
      <p class="font-mono text-xs uppercase tracking-[0.1em] text-ink-4">Error 500</p>
      <h1 class="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">No pudimos completar la solicitud.</h1>
      <p class="mt-3 text-lg text-ink-3">Intenta nuevamente en unos minutos.</p>
      <div class="mt-6">${btn('Reintentar', { kind: 'primary', icon: ic('refresh-double', 'size-4'), c: '!h-9' })}</div>
      <div class="mt-8 flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-3 py-2">
        <span class="text-xs text-ink-3">ID</span>
        <span class="flex items-center gap-2 font-mono text-sm text-ink-2">req_7f3a91c2<button type="button" class="grid size-6 place-items-center rounded-sm text-ink-3 hover:bg-sunken" aria-label="Copiar">${ic('copy', 'size-4')}</button></span>
      </div>
    </div>
  </main>
</div>
</body>`;
  return page({ title: 'Error · Bruma Consola', desc: 'No pudimos completar la solicitud.' }, body);
}
