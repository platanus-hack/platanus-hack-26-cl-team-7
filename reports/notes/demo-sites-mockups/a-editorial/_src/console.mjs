// Bruma Consola (Next.js 15 + Tailwind 4 in the real build): n1 login, n2 resumen, n3 colaboradores, n4 error.
import { ic, clp, rut, mark, wordmark, head, write } from './lib.mjs';

// The canary string the security engine watches. Present only on protected console screens (n2, n3).
const WORKSPACE = 'bruma-produccion';

/* ---------- shell ---------- */

const NAV = [
  [['Resumen', 'house', 'n2-resumen.html'], ['Colaboradores', 'users', 'n3-colaboradores.html']],
  [['Nómina', 'wallet', '#'], ['Liquidaciones', 'receipt', '#'], ['Previred', 'bank', '#']],
  [['Centros de costo', 'buildings', '#'], ['Contratos', 'file-text', '#'], ['Reportes', 'chart-bar', '#']],
];

const sidebar = (active) => `
<aside class="hidden lg:flex flex-col sticky top-0 h-screen border-r border-rule px-5 pt-6 pb-5">
  <a href="n2-resumen.html" class="px-3">${wordmark('Consola')}</a>
  <nav class="mt-9 flex-1 overflow-y-auto -mx-1 px-1" aria-label="Principal">
    ${NAV.map((items, g) => `
      <ul class="space-y-0.5 ${g ? 'mt-7' : ''}">
        ${items.map(([t, i, href]) => {
          const on = t === active;
          return `<li><a href="${href}" ${on ? 'aria-current="page"' : ''} class="flex items-center gap-3 h-9 px-3 rounded-sm text-[14px] ${on ? 'bg-paper-2 text-ink font-medium' : 'text-ink-2 hover:text-ink hover:bg-paper-2/60'}">
            ${ic(i, on ? 'text-forest' : '')}<span>${t}</span></a></li>`;
        }).join('')}
      </ul>`).join('')}
  </nav>
</aside>`;

const topbar = () => `
<header class="sticky top-0 z-20 bg-paper border-b border-rule">
  <div class="h-[60px] px-4 md:px-10 flex items-center gap-2 md:gap-5">
    <button class="lg:hidden size-9 -ml-1 grid place-items-center text-ink" aria-label="Abrir menú">${ic('list', '!size-6')}</button>
    <button class="inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-sm border border-rule bg-sheet hover:border-ink text-[13px] font-mono font-medium min-w-0" aria-label="Cambiar de espacio de trabajo">
      <span class="size-2 rounded-full bg-forest flex-none"></span><span class="truncate">${WORKSPACE}</span>${ic('caret-up-down', '!size-4 text-ink-3')}
    </button>
    <div class="flex-1"></div>
    <button class="hidden md:flex items-center gap-3 h-9 w-[280px] px-3 rounded-sm border border-rule bg-sheet text-ink-3 text-[13px] hover:border-ink" aria-label="Buscar">
      ${ic('magnifying-glass', '!size-4')}<span>Buscar</span><span class="ml-auto kbd">⌘K</span>
    </button>
    <button class="size-9 grid place-items-center text-ink-2 hover:text-ink" aria-label="Notificaciones">${ic('bell', '!size-[1.3rem]')}</button>
    <button class="flex items-center gap-3 pl-1 md:pl-4 md:border-l border-rule h-9" aria-label="Menú de cuenta">
      <span class="avatar bg-forest text-paper">MV</span>
      <span class="hidden xl:block text-[13px] font-medium">Marcela Vidal</span>
      ${ic('caret-down', '!size-4 text-ink-3 hidden md:block')}
    </button>
  </div>
</header>`;

const shell = (active, title, main) => `${head(title)}
<body class="bg-paper text-ink">
<div class="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] min-h-screen">
  ${sidebar(active)}
  <div class="min-w-0 flex flex-col">
    ${topbar()}
    <main class="px-5 md:px-10 pt-8 md:pt-10 pb-16 w-full max-w-[1320px]">${main}</main>
  </div>
</div>
</body></html>`;

/* ---------- n2 chart ---------- */

const MONTHS = ['nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov'];
const VALS = [168.2, 176.9, 169.5, 170.1, 171.8, 173.0, 174.6, 178.3, 180.2, 181.9, 183.8, 187.6];
const PROJ = 189.4;
const fmt1 = (v) => v.toFixed(1).replace('.', ',');

const chart = ({ w, h, fs, every, id }) => {
  const m = { l: 40, r: 22, t: 56, b: 30 };
  const n = 13;
  const x = (i) => m.l + ((w - m.l - m.r) * i) / (n - 1);
  const ymin = 160;
  const ymax = 196;
  const y = (v) => m.t + (h - m.t - m.b) * (1 - (v - ymin) / (ymax - ymin));
  const pts = VALS.map((v, i) => [x(i), y(v)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${x(11).toFixed(1)} ${y(ymin)} L${x(0).toFixed(1)} ${y(ymin)} Z`;
  const ticks = [160, 170, 180, 190];
  const last = pts[11];
  const proj = [x(12), y(PROJ)];
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-auto block" role="img" aria-labelledby="${id}-t" font-family="Inter Tight, sans-serif">
  <title id="${id}-t">Costo de nómina mensual en millones de pesos. Octubre: 187,6. Proyección de noviembre: 189,4.</title>
  ${ticks.map((t) => `<line x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 160 ? '#16140E' : '#D6CCB8'}" stroke-width="1"/><text x="${m.l - 10}" y="${y(t) + 4}" text-anchor="end" font-size="${fs}" fill="#6E685C" style="font-variant-numeric:tabular-nums">${t}</text>`).join('')}
  <path d="${area}" fill="#DAE4D3" opacity=".6"/>
  <path d="${line}" fill="none" stroke="#16140E" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M${last[0].toFixed(1)} ${last[1].toFixed(1)} L${proj[0].toFixed(1)} ${proj[1].toFixed(1)}" fill="none" stroke="#1E4B38" stroke-width="1.6" stroke-dasharray="3 4" stroke-linecap="round"/>
  ${pts.slice(0, 11).map(([px, py]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#F3EEE3" stroke="#16140E" stroke-width="1.4"/>`).join('')}
  <circle cx="${proj[0].toFixed(1)}" cy="${proj[1].toFixed(1)}" r="4" fill="#F3EEE3" stroke="#1E4B38" stroke-width="1.6"/>
  <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="9" fill="#1E4B38" opacity=".14"/>
  <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5" fill="#1E4B38"/>
  <line x1="${last[0].toFixed(1)}" x2="${last[0].toFixed(1)}" y1="${last[1] - 14}" y2="${last[1] - 26}" stroke="#1E4B38" stroke-width="1"/>
  <text x="${last[0].toFixed(1)}" y="${last[1] - 52}" text-anchor="${w < 500 ? 'end' : 'middle'}" font-family="Newsreader, serif" font-size="${w < 500 ? 22 : 26}" fill="#16140E" style="font-variant-numeric:tabular-nums">$${fmt1(VALS[11])} M</text>
  <text x="${last[0].toFixed(1)}" y="${last[1] - 34}" text-anchor="${w < 500 ? 'end' : 'middle'}" font-size="${fs}" fill="#6E685C">oct</text>
  ${MONTHS.map((mo, i) => (i % every === (n - 1) % every || i === n - 1) ? `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="${fs}" fill="${i === 12 ? '#1E4B38' : '#454036'}">${mo}</text>` : '').join('')}
</svg>`;
};

/* ---------- n1 login ---------- */

export const n1 = () => `${head('Iniciar sesión · Bruma Consola')}
<body class="bg-paper text-ink">
<div class="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
  <section class="relative bg-forest text-paper overflow-hidden px-6 py-6 lg:px-14 lg:py-12 flex flex-col lg:min-h-screen">
    <div class="absolute inset-0 opacity-[.13] pointer-events-none" style="background-image:repeating-linear-gradient(to bottom, transparent 0, transparent 39px, #F3EEE3 39px, #F3EEE3 40px)"></div>
    <div class="absolute inset-y-0 left-[4.5rem] lg:left-[7.5rem] w-px bg-paper/20 pointer-events-none hidden sm:block"></div>
    <div class="relative">${wordmark('Consola', true)}</div>
    <div class="relative hidden lg:flex flex-1 items-center lg:pl-[calc(7.5rem-3.5rem+1.75rem)]">
      <p class="serif text-[clamp(3.5rem,6vw,5.75rem)] leading-[.96] tracking-[-0.03em] font-light">Cada peso,<br><em class="font-light">en su línea.</em></p>
    </div>
  </section>

  <section class="flex flex-col px-6 py-10 sm:px-12 lg:px-16 lg:py-12">
    <div class="flex-1 flex items-center">
      <div class="w-full max-w-[400px] mx-auto">
        <h1 class="serif text-[2.75rem] leading-none tracking-tight">Inicia sesión</h1>

        <form class="mt-12 space-y-8" onsubmit="return false">
          <div>
            <label for="email" class="label block">Correo</label>
            <input id="email" type="email" autocomplete="username" placeholder="nombre.apellido@empresa.cl" class="field mt-1">
          </div>
          <div>
            <label for="pw" class="label block">Contraseña</label>
            <div class="relative">
              <input id="pw" type="password" autocomplete="current-password" class="field mt-1 pr-10" value="">
              <button type="button" class="absolute right-0 top-1/2 -translate-y-1/2 mt-0.5 size-8 grid place-items-center text-ink-3 hover:text-ink" aria-label="Mostrar contraseña">${ic('eye')}</button>
            </div>
          </div>
          <label class="flex items-center gap-3 text-[14px] cursor-pointer select-none">
            <input type="checkbox" class="size-4 accent-forest" checked>
            <span>Mantener sesión</span>
          </label>
          <button class="btn btn-primary w-full !h-12 text-[15px]">Ingresar${ic('arrow-right')}</button>
        </form>

        <button class="mt-4 w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-sm border border-rule text-ink-2 text-[15px] hover:border-ink hover:text-ink">${ic('lock-simple')}Continuar con SSO</button>
      </div>
    </div>
    <footer class="mt-10 pt-5 border-t border-rule text-[13px]">
      <a href="#" class="text-ink-3 hover:text-ink link">¿Olvidaste tu contraseña?</a>
    </footer>
  </section>
</div>
</body></html>`;

/* ---------- n2 resumen ---------- */

const PROCESOS = [
  ['Remuneraciones noviembre', '$189.402.116', '30 nov', 'warn', 'En preparación'],
  ['Finiquitos noviembre', '$9.310.000', '28 nov', 'bad', 'Observaciones'],
  ['Previred octubre', '$41.230.870', '12 nov', 'ok', 'Pagada'],
  ['Remuneraciones octubre', '$187.642.318', '30 oct', 'ok', 'Pagada'],
  ['Remuneraciones septiembre', '$183.801.552', '30 sep', 'ok', 'Pagada'],
];

const kpi = (label, value, note = '', extra = '') => `
  <div class="py-6 pr-6 lg:px-6 lg:first:pl-0 lg:border-l lg:first:border-l-0 border-rule ${extra}">
    <p class="label">${label}</p>
    <p class="fig text-[2rem] md:text-[2.25rem] xl:text-[2.5rem] leading-none mt-3 whitespace-nowrap">${value}</p>
    ${note ? `<p class="mt-3 text-[13px] text-ink-2">${note}</p>` : ''}
  </div>`;

export const n2 = () => shell('Resumen', 'Resumen · Bruma Consola', `
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
    <h1 class="serif text-[2.25rem] leading-[1.08] md:text-title tracking-[-0.02em] font-light">Resumen de <em class="text-forest">noviembre</em></h1>
    <div class="flex gap-2 flex-none">
      <button class="btn btn-ghost">Exportar</button>
      <button class="btn btn-primary">${ic('plus')}Nueva nómina</button>
    </div>
  </div>

  <section class="mt-9 grid grid-cols-2 lg:grid-cols-[1.3fr_1.3fr_.95fr_.95fr] border-t border-ink" aria-label="Indicadores">
    ${kpi('Costo nómina', '$187.642.318', `<span class="inline-flex items-center gap-1 text-forest font-medium">${ic('arrow-up-right', '!size-4')}2,1 %</span>`, 'col-span-2 lg:col-span-1 border-b lg:border-b-0')}
    ${kpi('Líquido pagado', '$128.905.440', '', 'col-span-2 lg:col-span-1 border-b lg:border-b-0')}
    ${kpi('Colaboradores', '214', '', 'border-b lg:border-b-0')}
    ${kpi('Próximo pago', '30 <span class="text-[1.1rem] text-ink-3 font-sans font-normal tracking-normal">nov</span>', 'en 8 días', 'border-b lg:border-b-0')}
  </section>

  <div class="mt-10 grid lg:grid-cols-[minmax(0,1fr)_320px] gap-x-14 gap-y-12">
    <section>
      <div class="border-b border-ink pb-3"><h2 class="serif text-heading font-normal">Costo mensual</h2></div>
      <div class="mt-4">
        <div class="hidden md:block">${chart({ w: 760, h: 300, fs: 12, every: 2, id: 'c-d' })}</div>
        <div class="md:hidden">${chart({ w: 360, h: 260, fs: 11, every: 3, id: 'c-m' })}</div>
      </div>
    </section>

    <section>
      <div class="border-b border-ink pb-3"><h2 class="serif text-heading font-normal">Por resolver</h2></div>
      <ul class="divide-y divide-rule">
        ${[['8', 'Observaciones'], ['2', 'Finiquitos por firmar'], ['3', 'Licencias médicas'], ['1', 'Rectificación Previred']].map(([n, t]) => `
        <li><a href="#" class="group flex items-center gap-4 py-4">
          <span class="fig text-[2rem] w-9 text-right">${n}</span>
          <span class="flex-1 text-[14px] font-medium">${t}</span>
          ${ic('caret-right', '!size-4 text-ink-3 group-hover:text-ink')}
        </a></li>`).join('')}
      </ul>
    </section>
  </div>

  <section class="mt-14">
    <h2 class="serif text-heading font-normal pb-3">Procesos</h2>
    <table class="ledger">
      <thead><tr>
        <th>Proceso</th><th class="r">Costo empresa</th><th class="hidden sm:table-cell pl-8">Pago</th><th class="pl-8 hidden sm:table-cell">Estado</th>
      </tr></thead>
      <tbody>
        ${PROCESOS.map(([t, cost, f, st, stl]) => `<tr>
          <td><div class="font-medium">${t}</div><div class="sm:hidden mt-1"><span class="status status-${st}">${stl}</span></div></td>
          <td class="r font-medium">${cost}</td><td class="hidden sm:table-cell pl-8 text-ink-2">${f}</td>
          <td class="pl-8 hidden sm:table-cell"><span class="status status-${st}">${stl}</span></td></tr>`).join('')}
      </tbody>
    </table>
  </section>
`);

/* ---------- n3 colaboradores ---------- */

const TONES = ['bg-moss text-forest', 'bg-ochre-soft text-ochre', 'bg-paper-2 text-ink-2', 'bg-brick-soft text-brick'];
const PEOPLE = [
  ['Camila Andrade Rojas', 12345678, 'Analista de Remuneraciones', 'CC-100', 'Administración', 'Indefinido', 'desde 03 mar 2021', 1250000, 'ok', 'Activo'],
  ['Matías Fuentealba Soto', 16482905, 'Ejecutivo Comercial Senior', 'CC-210', 'Comercial', 'Indefinido', 'desde 18 ago 2019', 1480000, 'ok', 'Activo'],
  ['Javiera Palma Contreras', 17903214, 'Jefa de Operaciones', 'CC-310', 'Operaciones', 'Indefinido', 'desde 11 ene 2018', 2860000, 'ok', 'Activo'],
  ['Sebastián Opazo Vera', 18654327, 'Desarrollador Backend', 'CC-410', 'Tecnología', 'Indefinido', 'desde 06 jun 2022', 2350000, 'idle', 'De vacaciones'],
  ['Francisca Reyes Muñoz', 15217783, 'Contadora Senior', 'CC-100', 'Administración', 'Indefinido', 'desde 02 may 2016', 2120000, 'ok', 'Activo'],
  ['Ignacio Tapia Salazar', 19876543, 'Asistente de Bodega', 'CC-510', 'Logística', 'Plazo fijo', 'hasta 28 feb 2027', 612000, 'ok', 'Activo'],
  ['Constanza Bravo Leiva', 17110928, 'Diseñadora de Producto', 'CC-410', 'Tecnología', 'Indefinido', 'desde 14 feb 2023', 1980000, 'warn', 'Licencia médica'],
  ['Valentina Henríquez Pizarro', 20134876, 'Ejecutiva de Soporte', 'CC-210', 'Comercial', 'Plazo fijo', 'hasta 14 mar 2027', 780000, 'ok', 'Activo'],
  ['Daniela Sepúlveda Cid', 18274590, 'Coordinadora de RR.HH.', 'CC-100', 'Administración', 'Indefinido', 'desde 27 jul 2021', 1760000, 'ok', 'Activo'],
  ['Felipe Carrasco Ibáñez', 13846092, 'Analista de Finanzas', 'CC-100', 'Administración', 'Por obra', 'término 31 oct 2026', 1340000, 'bad', 'Desvinculado'],
];
const initials = (name) => { const p = name.split(' '); return (p[0][0] + p[1][0]).toUpperCase(); };
const mail = (name) => { const p = name.split(' '); const f = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return `${f(p[0])}.${f(p[1])}@bruma.test`; };

export const n3 = () => shell('Colaboradores', 'Colaboradores · Bruma Consola', `
  <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
    <div>
      <p class="label">Organización</p>
      <h1 class="serif text-[2.25rem] leading-[1.08] md:text-title mt-3 tracking-[-0.02em] font-light">Colaboradores</h1>
      <p class="mt-3 text-ink-2"><span class="tnum">214</span> activos</p>
    </div>
    <div class="flex gap-2 flex-none"><button class="btn btn-ghost">Importar CSV</button><button class="btn btn-primary">${ic('plus')}Nuevo colaborador</button></div>
  </div>

  <nav class="mt-8 flex gap-6 border-b border-rule overflow-x-auto -mx-5 px-5 md:mx-0 md:px-0" aria-label="Estado">
    ${[['Todos', 223, true], ['Activos', 214], ['En licencia', 6], ['Desvinculados', 3]].map(([t, n, on]) => `<a href="#" class="flex items-baseline gap-2 pb-3 -mb-px text-[14px] whitespace-nowrap ${on ? 'font-medium border-b-2 border-ink' : 'text-ink-3 hover:text-ink'}">${t}<span class="tnum text-[12px] ${on ? 'text-ink-2' : ''}">${n}</span></a>`).join('')}
  </nav>

  <div class="mt-5 flex flex-wrap items-center gap-2">
    <label class="flex items-center gap-3 h-10 flex-1 min-w-[240px] md:max-w-[420px] px-3 rounded-sm border border-rule bg-sheet text-ink-3 focus-within:border-ink">
      ${ic('magnifying-glass')}<input class="bg-transparent flex-1 min-w-0 text-[14px] text-ink placeholder:text-ink-3 outline-none" placeholder="Buscar nombre, RUT o cargo"><span class="kbd hidden md:inline">/</span>
    </label>
    ${['Centro de costo', 'Contrato', 'Cargo', 'Ingreso'].map((t) => `<button class="hidden md:inline-flex items-center gap-2 h-10 px-3 rounded-sm border border-rule text-[13px] text-ink-2 hover:border-ink hover:text-ink">${t}${ic('caret-down', '!size-3.5')}</button>`).join('')}
    <div class="ml-auto flex gap-1"><button class="size-10 grid place-items-center text-ink-2 hover:text-ink" aria-label="Columnas">${ic('sliders-horizontal')}</button><button class="size-10 grid place-items-center text-ink-2 hover:text-ink" aria-label="Ordenar">${ic('arrows-down-up')}</button></div>
  </div>
  <table class="ledger ledger-tight table-fixed md:table-auto mt-6">
    <thead><tr>
      <th class="!w-9 !pl-0"><input type="checkbox" class="size-4 accent-forest align-middle" aria-label="Seleccionar todos"></th>
      <th>Colaborador</th><th class="hidden md:table-cell">RUT</th><th class="hidden lg:table-cell">Cargo</th><th class="hidden xl:table-cell">Centro de costo</th><th class="hidden lg:table-cell">Contrato</th><th class="r hidden md:table-cell">Sueldo base</th><th class="hidden md:table-cell">Estado</th>
    </tr></thead>
    <tbody>
      ${PEOPLE.map(([name, r, cargo, cc, ccn, ct, ctd, sal, st, stl], i) => `<tr>
        <td class="!pl-0"><input type="checkbox" class="size-4 accent-forest align-middle" aria-label="Seleccionar ${name}"></td>
        <td><div class="flex items-center gap-3 min-w-0"><span class="avatar ${TONES[i % 4]}">${initials(name)}</span>
          <span class="min-w-0 leading-tight"><span class="block font-medium truncate">${name}</span><span class="block text-[13px] text-ink-3 truncate"><span class="md:hidden">${rut(r)}</span><span class="hidden md:inline">${mail(name)}</span></span><span class="md:hidden mt-1 block"><span class="status status-${st}">${stl}</span></span></span></div></td>
        <td class="hidden md:table-cell text-ink-2 whitespace-nowrap">${rut(r)}</td>
        <td class="hidden lg:table-cell text-ink-2">${cargo}</td>
        <td class="hidden xl:table-cell whitespace-nowrap"><span class="font-mono text-[12px] text-ink-3 mr-2">${cc}</span>${ccn}</td>
        <td class="hidden lg:table-cell whitespace-nowrap"><span class="block ${ct === 'Indefinido' ? '' : 'font-medium text-ochre'}">${ct}</span></td>
        <td class="r hidden md:table-cell whitespace-nowrap">${clp(sal)}</td>
        <td class="hidden md:table-cell"><span class="status status-${st}">${stl}</span></td></tr>`).join('')}
    </tbody>
  </table>
  <div class="mt-4 flex items-center justify-between text-[13px] text-ink-2">
    <p>Mostrando <span class="tnum">1–10</span> de <span class="tnum">223</span></p>
    <div class="flex items-center gap-1 tnum">
      <button class="size-9 grid place-items-center text-ink-3" aria-label="Anterior" disabled>${ic('caret-down', '!size-4 rotate-90')}</button>
      <span class="size-9 grid place-items-center font-medium border-b-2 border-ink">1</span><a href="#" class="size-9 grid place-items-center hover:bg-paper-2 rounded-sm">2</a><a href="#" class="size-9 grid place-items-center hover:bg-paper-2 rounded-sm">3</a><span class="px-1 text-ink-3">…</span><a href="#" class="size-9 grid place-items-center hover:bg-paper-2 rounded-sm">19</a>
      <button class="size-9 grid place-items-center hover:text-ink" aria-label="Siguiente">${ic('caret-right', '!size-4')}</button>
    </div>
  </div>
`);

/* ---------- n4 error (what the attacker sees with Reaper on the console) ---------- */

export const n4 = () => `${head('Error · Bruma Consola')}
<body class="bg-paper text-ink">
<div class="min-h-screen flex flex-col relative overflow-hidden">
  <header class="px-6 md:px-12 pt-7 relative z-10"><a href="#">${wordmark('Consola')}</a></header>
  <main class="flex-1 flex items-center px-6 md:px-12 py-14 relative z-10">
    <div class="max-w-[620px]">
      <p class="label">Error 500</p>
      <h1 class="serif text-[clamp(2.5rem,5vw,4rem)] leading-[1.02] tracking-[-0.025em] font-light mt-4">Algo no salió<br>como esperábamos.</h1>
      <p class="mt-6 text-[1.125rem] text-ink-2 max-w-[44ch]">No pudimos completar la solicitud. Intenta nuevamente.</p>
      <div class="mt-9 flex flex-wrap gap-3">
        <button class="btn btn-primary !h-11">${ic('arrow-right')}Reintentar</button>
        <a href="#" class="btn btn-ghost !h-11">Ir al inicio</a>
      </div>
      <dl class="mt-12 pt-5 border-t border-rule grid grid-cols-[auto_1fr] gap-x-8 gap-y-1.5 text-[13px] max-w-[460px]">
        <dt class="text-ink-3">ID de solicitud</dt><dd class="font-mono text-[12.5px]">req_7f3a91c2</dd>
        <dt class="text-ink-3">Fecha</dt><dd class="tnum">22 nov 2026 · 14:07 (GMT-3)</dd>
        <dt class="text-ink-3">¿Sigue fallando?</dt><dd>Escribe a <a href="#" class="link">soporte@bruma.test</a> con este ID.</dd>
      </dl>
    </div>
  </main>
  <p class="serif font-light select-none pointer-events-none absolute -right-6 bottom-[-1.5rem] md:bottom-[-2.5rem] text-[clamp(11rem,32vw,30rem)] leading-none text-paper-2 tracking-[-0.06em]" aria-hidden="true">500</p>
</div>
</body></html>`;

export const buildConsole = () => {
  write('n1-login.html', n1());
  write('n2-resumen.html', n2());
  write('n3-colaboradores.html', n3());
  write('n4-error-reaper.html', n4());
};
