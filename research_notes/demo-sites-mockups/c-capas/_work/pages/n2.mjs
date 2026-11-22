import { I, D, doc, money } from '../lib.mjs';
import { shell } from '../console.mjs';

// Costo de nomina por mes, en millones de CLP: [liquido, descuentos legales, aportes empleador]
const TOT = { Dic: 146.8, Ene: 148.2, Feb: 149.0, Mar: 154.3, Abr: 157.9, May: 160.4, Jun: 164.6, Jul: 168.9, Ago: 171.5, Sep: 178.0, Oct: 178.9, Nov: 181.6 };
const MONTHS = Object.entries(TOT).map(([m, t]) => {
  const liq = m === 'Nov' ? 123.5 : m === 'Oct' ? 121.8 : +(t * 0.68).toFixed(1);
  const des = m === 'Nov' ? 41.9 : m === 'Oct' ? 41.4 : +(t * 0.231).toFixed(1);
  return [m, liq, des, +(t - liq - des).toFixed(1)];
});
const sumM = (m) => m[1] + m[2] + m[3];

function chart(months, w, h, big) {
  const L = 46, R = 8, T = 34, B = 32;
  const cw = w - L - R, ch = h - T - B, max = 200;
  const step = cw / months.length, bw = Math.min(big ? 30 : 28, step * 0.62);
  const y = (v) => T + ch - (v / max) * ch;
  let g = '';
  for (const v of [0, 50, 100, 150, 200]) {
    g += `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e2dacd" ${v ? 'stroke-dasharray="2 5"' : ''}/>`;
    g += `<text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" class="fill-ink-3" font-size="12" font-family="Geist Mono">${v ? v : '0'}</text>`;
  }
  let bars = '';
  months.forEach((m, i) => {
    const cx = L + step * i + step / 2, x = cx - bw / 2;
    const isNov = m[0] === 'Nov', isOct = m[0] === 'Oct';
    if (isOct) bars += `<rect x="${cx - step / 2 + 3}" y="${T - 4}" width="${step - 6}" height="${ch + B - 4}" rx="14" fill="#f8ebe3"/>`;
    const parts = [[m[1], '#5b7c90'], [m[2], '#a9bcc8'], [m[3], '#d8ccb9']];
    let acc = 0;
    parts.forEach(([v, c], k) => {
      const y0 = y(acc), y1 = y(acc + v); acc += v;
      const top = k === 2;
      const hgt = y0 - y1 - (k < 2 ? 1.5 : 0);
      const op = isNov ? '.5' : '1';
      bars += top
        ? `<path d="M${x} ${y0 - 1.5}V${y1 + 6}a6 6 0 0 1 6-6h${bw - 12}a6 6 0 0 1 6 6V${y0 - 1.5}z" fill="${c}" opacity="${op}"/>`
        : `<rect x="${x}" y="${y1 + (k < 2 ? 1.5 : 0)}" width="${bw}" height="${Math.max(hgt, 1)}" fill="${c}" opacity="${op}" ${k === 0 ? 'rx="0"' : ''}/>`;
    });
    if (isNov) bars += `<rect x="${x - 1}" y="${y(sumM(m)) - 1}" width="${bw + 2}" height="${y(0) - y(sumM(m)) + 2}" rx="6" fill="none" stroke="#b4583a" stroke-dasharray="3 3" stroke-opacity=".7"/>`;
    bars += `<text x="${cx}" y="${h - 10}" text-anchor="middle" font-size="12.5" font-family="Onest" class="${isOct || isNov ? 'fill-ink font-medium' : 'fill-ink-3'}" ${isOct ? 'font-weight="600"' : ''}>${m[0]}</text>`;
    if (isOct) {
      const bx = Math.min(cx - 64, w - R - 128);
      bars += `<g><rect x="${bx}" y="${T - 30}" width="128" height="24" rx="12" fill="#27211c"/><text x="${bx + 64}" y="${T - 14}" text-anchor="middle" font-size="11.5" fill="#fdfbf7" font-family="Geist Mono">Oct · $178,9 M</text><path d="M${cx - 5} ${T - 6}l5 5l5-5z" fill="#27211c" transform="translate(0 0)"/></g>`;
    }
  });
  const avg = 167.5;
  const line = `<line x1="${L}" x2="${w - R}" y1="${y(avg)}" y2="${y(avg)}" stroke="#27211c" stroke-opacity=".35" stroke-dasharray="6 4"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-auto block" role="img" aria-label="Costo de nómina por mes, de diciembre 2025 a noviembre 2026">${g}${bars}${line}</svg>`;
}

const prog = (n, cur) => `<span class="flex gap-1" aria-label="${n} de 6 pasos">${[0, 1, 2, 3, 4, 5].map((i) =>
  `<span class="h-1.5 w-3.5 rounded-full ${i < n ? 'bg-clay' : i === cur ? 'bg-clay-soft ring-1 ring-clay' : 'bg-line-2/70'}"></span>`).join('')}</span>`;

const ROWS = [
  ['Nómina mensual · noviembre', 'NOM-2611', 'nov 2026', '142', '$181.640.200', 'warn', 'En revisión', 3, 2, 'PM', 'clay'],
  ['Anticipo quincenal · noviembre', 'ANT-2611', '1–15 nov', '118', '$38.420.000', 'ok', 'Pagado', 6, -1, 'JP', 'sand'],
  ['Nómina mensual · octubre', 'NOM-2610', 'oct 2026', '139', '$178.912.400', 'ok', 'Pagada', 6, -1, 'PM', 'clay'],
  ['Cotizaciones Previred · octubre', 'PRV-2610', 'oct 2026', '139', '$52.318.760', 'bad', 'Con diferencia', 5, 5, 'AF', 'sand'],
];

const tr = (r) => `
  <div class="tr cols-proc">
    <div class="min-w-0"><div class="text-[14.5px] font-medium truncate">${r[0]}</div><div class="mono text-caption text-ink-3 mt-0.5">${r[1]}<span class="md:hidden"> · ${r[2]} · ${r[3]} colab.</span></div></div>
    <div class="text-small text-ink-2 max-md:hidden">${r[2]}</div>
    <div class="mono text-small text-ink-2 max-md:hidden">${r[3]}</div>
    <div class="mono text-[13.5px] max-md:hidden">${r[4]}</div>
    <div class="max-md:text-right"><span class="st st-${r[5]}">${r[6]}</span><div class="mono text-small mt-1.5 md:hidden">${r[4]}</div></div>
    <div class="max-md:hidden">${prog(r[7], r[8])}</div>
  </div>`;

const kpi = (icon, label, value, delta, cls, sub) => `
  <div class="tile-sm p-5 flex flex-col justify-between min-h-[128px]">
    <div class="flex items-center justify-between"><span class="ico-disc !size-9">${D(icon, 'size-5')}</span><span class="delta ${cls}">${delta}</span></div>
    <div><div class="num text-[19px] min-[420px]:text-[22px] leading-none">${money(value)}</div><div class="text-small text-ink-3 mt-2">${label}</div></div>
  </div>`;

const body = `
<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6">
  <div><div class="eyebrow">Noviembre 2026</div><h1 class="text-h1 font-semibold tracking-tight mt-1.5">Resumen</h1></div>
  <div class="flex flex-wrap items-center gap-2.5">
    <div class="seg" role="tablist"><button class="on">Mes</button><button>Trimestre</button><button>Año</button></div>
    <button class="btn max-sm:hidden">${I('download-minimalistic', 'size-[18px]')} Exportar</button>
    <button class="btn btn-accent">${I('add-circle', 'size-[18px]')} Nueva nómina</button>
  </div>
</div>

<div class="grid grid-cols-12 gap-4">
  <!-- Nomina en curso con linea de tiempo -->
  <section class="tile col-span-12 xl:col-span-8 p-6 lg:p-7 flex flex-col">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2.5"><span class="eyebrow">Nómina de noviembre 2026</span><span class="st st-warn">En revisión</span></div>
        <div class="num text-[36px] sm:text-[44px] mt-2.5">${money('$181.640.200')}</div>
        <p class="mt-1.5"><span class="delta delta-warn">+1,5 % vs octubre</span></p>
      </div>
      <div class="flex gap-2"><button class="btn btn-sm">Ver cálculo</button><button class="btn btn-sm btn-accent">Continuar revisión ${I('arrow-right', 'size-4')}</button></div>
    </div>
    <div class="well mt-6 xl:mt-auto px-5 pt-6 pb-5 lg:px-6">
      <div class="tl">
        <div class="tl-s done"><span class="tl-n">${I('check-read', 'size-4')}</span><div class="tl-t">Novedades</div></div>
        <div class="tl-s done"><span class="tl-n">${I('check-read', 'size-4')}</span><div class="tl-t">Cálculo</div></div>
        <div class="tl-s now"><span class="tl-n">3</span><div class="tl-t">Revisión</div></div>
        <div class="tl-s pend"><span class="tl-n">4</span><div class="tl-t">Aprobación</div></div>
        <div class="tl-s pend"><span class="tl-n">5</span><div class="tl-t">Pago</div></div>
        <div class="tl-s pend"><span class="tl-n">6</span><div class="tl-t">Previred</div></div>
      </div>
    </div>
  </section>

  <!-- Proximo pago -->
  <section class="tint col-span-12 xl:col-span-4 p-6 lg:p-7 flex flex-col">
    <div class="flex items-center justify-between"><span class="eyebrow !text-clay-2">Próximo pago</span><span class="ico-disc !size-9 !bg-white/60">${D('calendar-date', 'size-5')}</span></div>
    <div class="flex items-baseline gap-3 mt-3"><span class="num text-[44px] leading-none text-ink">30</span><span class="text-[30px] leading-none font-semibold tracking-tight">nov</span><span class="text-body text-ink-2 ml-1">lunes · 2026</span></div>
    <p class="text-small text-ink-2 mt-1.5">Faltan 8 días · 142 transferencias</p>
  </section>

  <!-- Grafico -->
  <section class="tile col-span-12 xl:col-span-7 p-6 lg:px-7 lg:py-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 class="text-[17px] font-semibold">Costo de nómina por mes</h2></div>
    </div>
    <div class="mt-4 hidden sm:block">${chart(MONTHS, 700, 236, true)}</div>
    <div class="mt-4 sm:hidden">${chart(MONTHS.slice(6), 340, 236, false)}</div>
    <div class="mt-3 flex items-center gap-4 text-caption text-ink-3">
      <span class="flex items-center gap-2"><svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke="#27211c" stroke-opacity=".4" stroke-dasharray="6 4" stroke-width="1.5"/></svg>Promedio · $167,5 M</span>
    </div>
  </section>

  <!-- KPIs -->
  <div class="col-span-12 xl:col-span-5 grid grid-cols-2 gap-4 xl:grid-rows-2">
    ${kpi('users-group-rounded', 'Colaboradores activos', '142', '+3 vs oct', 'delta-up')}
    ${kpi('wallet-money', 'Sueldo líquido · nov', '$123.480.150', '+1,4 %', 'delta-flat')}
    ${kpi('safe-square', 'Descuentos legales · nov', '$41.917.300', '+1,3 %', 'delta-flat')}
    ${kpi('hand-money', 'Aportes empleador · nov', '$16.242.750', '+3,5 %', 'delta-warn')}
  </div>

  <!-- Procesos -->
  <section class="tile col-span-12 overflow-hidden">
    <div class="flex flex-wrap items-center justify-between gap-3 px-6 lg:px-[22px] pt-6 pb-4">
      <div><h2 class="text-[17px] font-semibold">Procesos de nómina</h2></div>
      <div class="seg"><button class="on">Todos</button><button>En curso</button><button>Cerrados</button></div>
    </div>
    <div class="tr th cols-proc"><div>Proceso</div><div class="max-md:hidden">Período</div><div class="max-md:hidden">Colab.</div><div class="max-md:hidden">Costo empresa</div><div class="max-md:text-right">Estado</div><div class="max-md:hidden">Avance</div></div>
    ${ROWS.map(tr).join('')}
    <div class="flex items-center justify-between px-6 lg:px-[22px] py-4 border-t border-line text-small text-ink-3"><span>Mostrando 4 de 48 procesos</span><button class="btn btn-sm">Ver todos ${I('arrow-right', 'size-4')}</button></div>
  </section>
</div>`;

const css = `
.cols-proc { --cols: minmax(0,1fr) auto; }
@media (min-width: 768px) { .cols-proc { --cols: minmax(0,1.5fr) 112px 70px 140px 140px 104px; } }
`;

export default doc({ title: 'Resumen · Bruma Consola', desc: 'Resumen de remuneraciones: nómina en curso, costo por mes y procesos.', body: shell({ active: 'resumen', body }), css });
