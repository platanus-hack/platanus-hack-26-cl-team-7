// Bruma Portal (React SPA on a Vite dev server, left exposed on staging): v1 inicio, v2 liquidación, v3 raw file, v4 error.
import { ic, clp, rut, mark, wordmark, head, write } from './lib.mjs';

const STAGING_HOST = 'bruma-rrhh.test';

// October 2026 payslip, fictional. All derived figures are computed so the sums always agree.
const L = (() => {
  const base = 1250000, grat = 213354, bono = 120000, colacion = 85000, movil = 62000, apv = 50000, utm = 69700;
  const imp = base + grat + bono;
  const afp = Math.round(imp * 0.10), com = Math.round(imp * 0.0144), salud = Math.round(imp * 0.07), ces = Math.round(imp * 0.006);
  const trib = imp - afp - com - salud - ces;
  const iut = Math.max(0, Math.round(trib * 0.04 - 0.54 * utm));
  const noImp = colacion + movil;
  const haberes = imp + noImp;
  const legales = afp + com + salud + ces + iut;
  const descuentos = legales + apv;
  return { base, grat, bono, colacion, movil, apv, utm, imp, afp, com, salud, ces, trib, iut, noImp, haberes, legales, descuentos, liquido: haberes - descuentos };
})();

const staging = () => `
<div class="bg-ochre-soft border-b border-ochre/30 text-[12px] text-ink" role="status">
  <div class="mx-auto max-w-[1180px] px-5 md:px-10 h-8 flex items-center">
    <span class="inline-flex items-center gap-2 h-6 px-3 rounded-full bg-ochre-soft border border-ochre/40 font-medium"><span class="size-1.5 rounded-full bg-ochre"></span>Entorno de pruebas</span>
  </div>
</div>`;

const NAV = [['Inicio', 'v1-inicio.html'], ['Liquidaciones', 'v2-liquidacion.html'], ['Vacaciones', '#'], ['Documentos', '#'], ['Mis datos', '#']];

const shell = (active, title, main) => `${head(title)}
<body class="bg-paper text-ink">
${staging()}
<header class="border-b border-rule">
  <div class="mx-auto max-w-[1180px] px-5 md:px-10 h-16 flex items-center gap-10">
    <a href="v1-inicio.html">${wordmark('Portal')}</a>
    <nav class="hidden md:flex items-stretch gap-7 h-full text-[14px]" aria-label="Principal">
      ${NAV.map(([t, h]) => `<a href="${h}" ${t === active ? 'aria-current="page"' : ''} class="flex items-center border-b-2 ${t === active ? 'border-forest font-medium' : 'border-transparent text-ink-2 hover:text-ink'}">${t}</a>`).join('')}
    </nav>
    <div class="ml-auto flex items-center gap-4">
      <button class="relative size-9 grid place-items-center text-ink-2 hover:text-ink" aria-label="Avisos">${ic('bell', '!size-[1.3rem]')}</button>
      <button class="flex items-center gap-3" aria-label="Menú de cuenta"><span class="avatar bg-moss text-forest">CA</span><span class="hidden sm:block text-left leading-tight"><span class="block text-[13px] font-medium">Camila Andrade</span><span class="block text-[12px] text-ink-3">Colaboradora</span></span>${ic('caret-down', '!size-4 text-ink-3 hidden sm:block')}</button>
    </div>
  </div>
  <nav class="md:hidden flex gap-6 overflow-x-auto px-5 text-[14px] border-t border-rule-2" aria-label="Principal móvil">
    ${NAV.map(([t, h]) => `<a href="${h}" class="py-3 -mb-px whitespace-nowrap border-b-2 ${t === active ? 'border-forest font-medium' : 'border-transparent text-ink-2'}">${t}</a>`).join('')}
  </nav>
</header>
<main class="mx-auto max-w-[1180px] px-5 md:px-10 pt-9 md:pt-12 pb-20">${main}</main>
</body></html>`;

/* ---------- v1 inicio ---------- */

const LIQS = [
  ['Octubre 2026', 'Pagada el 30 oct', 1730354, 365107, 1365247],
  ['Septiembre 2026', 'Pagada el 30 sep', 1718900, 363020, 1355880],
  ['Agosto 2026', 'Pagada el 28 ago', 1703640, 358410, 1345230],
];

export const v1 = () => shell('Inicio', 'Inicio · Bruma Portal', `
  <div class="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-x-16 gap-y-14">
    <div>
      <h1 class="serif text-[2.5rem] md:text-[3.5rem] leading-[1.02] tracking-[-0.025em] font-light mt-3">Buenas tardes, <em class="text-forest">Camila</em>.</h1>

      <section class="mt-10 pt-6 border-t border-ink" aria-label="Próximo pago">
        <div class="grid sm:grid-cols-[auto_1fr] gap-x-14 gap-y-6 items-end">
          <div>
            <p class="label">Próximo pago</p>
            <p class="fig text-[4.25rem] md:text-fig-lg mt-5 whitespace-nowrap">30 <span class="font-light italic">nov</span></p>
            <p class="mt-2 text-[14px] text-ink-2">Faltan <span class="tnum font-medium">8</span> días</p>
          </div>
          <dl class="text-[14px] divide-y divide-rule border-y border-rule">
            <div class="flex justify-between gap-6 py-2.5"><dt class="text-ink-3">Monto estimado</dt><dd class="tnum font-medium">${clp(L.liquido)}</dd></div>
            <div class="flex justify-between gap-6 py-2.5"><dt class="text-ink-3">Medio de pago</dt><dd class="text-right">Cuenta vista ···· 4821</dd></div>
            <div class="flex justify-between gap-6 py-2.5"><dt class="text-ink-3">Período</dt><dd class="tnum">1–30 nov 2026</dd></div>
          </dl>
        </div>
      </section>

      <section class="mt-14">
        <div class="flex items-end justify-between pb-3"><h2 class="serif text-heading font-normal">Últimas liquidaciones</h2><a href="#" class="text-[13px] link whitespace-nowrap">Ver las 58</a></div>
        <table class="ledger">
          <thead><tr><th>Período</th><th class="r hidden sm:table-cell">Haberes</th><th class="r hidden sm:table-cell">Descuentos</th><th class="r">Líquido</th><th class="!w-10"><span class="sr-only">Descargar</span></th></tr></thead>
          <tbody>
            ${LIQS.map(([p, s, h, d, l]) => `<tr>
              <td><a href="v2-liquidacion.html" class="block font-medium">${p}</a><span class="text-[13px] text-ink-3">${s}</span></td>
              <td class="r hidden sm:table-cell text-ink-2">${clp(h)}</td><td class="r hidden sm:table-cell text-ink-2">−${clp(d)}</td>
              <td class="r font-medium">${clp(l)}</td>
              <td class="r"><a href="#" class="inline-grid size-8 place-items-center text-ink-2 hover:text-forest" aria-label="Descargar PDF de ${p}">${ic('download-simple')}</a></td></tr>`).join('')}
          </tbody>
        </table>
      </section>
    </div>

    <aside class="lg:border-l lg:border-rule lg:pl-12 space-y-12">
      <section aria-label="Vacaciones">
        <p class="label">Saldo de vacaciones</p>
        <p class="fig text-[4.25rem] md:text-fig-lg mt-3">11,5 <span class="text-[1.25rem] font-sans font-normal tracking-normal text-ink-3">días hábiles</span></p>
        <div class="mt-5 flex gap-[3px]" role="img" aria-label="3,5 de 15 días tomados">
          ${Array.from({ length: 15 }, (_, i) => `<span class="h-3 flex-1 ${i < 3 ? 'bg-ink' : i === 3 ? 'bg-gradient-to-r from-ink from-50% to-forest/25 to-50%' : 'bg-forest/25'}"></span>`).join('')}
        </div>
        <a href="#" class="btn btn-ghost mt-5">${ic('airplane-tilt')}Solicitar vacaciones</a>
      </section>

      <section aria-label="Documentos">
        <div class="flex items-end justify-between pb-3 border-b border-ink"><h2 class="serif text-heading font-normal">Documentos</h2><a href="#" class="text-[13px] link">Ver todos</a></div>
        <ul class="divide-y divide-rule">
          ${[['Contrato de trabajo', 'PDF', 'file-pdf'], ['Anexo de reajuste 2026', 'PDF', 'file-pdf'], ['Certificado de antigüedad', '', 'file-text']].map(([t, s, i], k) => `
          <li><a href="#" class="group flex items-center gap-4 py-3.5">${ic(i, '!size-6 text-ink-3 group-hover:text-forest')}
            <span class="flex-1 leading-snug"><span class="block text-[14px] font-medium">${t}</span><span class="block text-[12.5px] text-ink-3">${s}</span></span>
            ${k < 2 ? ic('download-simple', 'text-ink-3 group-hover:text-forest') : '<span class="text-[13px] text-forest link">Solicitar</span>'}</a></li>`).join('')}
        </ul>
      </section>

    </aside>
  </div>
`);

/* ---------- v2 liquidación ---------- */

const row = (t, v, { strong = false, sub = '', neg = false } = {}) => `
  <div class="flex items-baseline justify-between gap-6 py-2.5 border-b ${strong ? 'border-ink' : 'border-rule'}">
    <dt class="${strong ? 'font-medium' : 'text-ink-2'}">${t}${sub ? `<span class="block text-[12.5px] text-ink-3">${sub}</span>` : ''}</dt>
    <dd class="tnum whitespace-nowrap ${strong ? 'font-semibold' : ''}">${neg ? '−' : ''}${clp(v)}</dd>
  </div>`;
const block = (title, rows) => `<div class="mt-7 first:mt-0"><p class="label pb-2 border-b border-ink">${title}</p><dl>${rows.join('')}</dl></div>`;

export const v2 = () => shell('Liquidaciones', 'Liquidación octubre 2026 · Bruma Portal', `
  <div class="flex items-center justify-between gap-4 text-[13px] text-ink-3">
    <p class="whitespace-nowrap"><a href="#" class="link">Liquidaciones</a> <span class="mx-1.5">/</span> <span class="text-ink">Octubre 2026</span></p>
    <p class="flex items-center gap-5 whitespace-nowrap"><a href="#" class="inline-flex items-center gap-1.5 hover:text-ink">${ic('caret-down', '!size-3.5 rotate-90')}<span class="hidden sm:inline">Septiembre</span></a><span class="inline-flex items-center gap-1.5 opacity-50"><span class="hidden sm:inline">Noviembre</span>${ic('caret-right', '!size-3.5')}</span></p>
  </div>

  <div class="mt-5 flex flex-wrap items-end justify-between gap-5">
    <div>
      <p class="label">Liquidación de sueldo</p>
      <h1 class="serif text-[3rem] md:text-[4rem] leading-[.95] tracking-[-0.03em] font-light mt-2">Octubre <em class="text-forest">2026</em></h1>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-ghost">${ic('printer')}Imprimir</button>
      <button class="btn btn-primary">${ic('download-simple')}Descargar PDF</button>
    </div>
  </div>

  <section class="mt-8 grid md:grid-cols-[1fr_1fr_1.75fr] border-t border-ink" aria-label="Resumen">
    <div class="py-5 md:pr-6 border-b md:border-b-0 border-rule"><p class="label">Total haberes</p><p class="fig text-[2rem] md:text-[2.25rem] leading-none mt-3 whitespace-nowrap">${clp(L.haberes)}</p></div>
    <div class="py-5 md:px-6 md:border-l border-rule border-b md:border-b-0"><p class="label">Total descuentos</p><p class="fig text-[2rem] md:text-[2.25rem] leading-none mt-3 whitespace-nowrap">−${clp(L.descuentos)}</p></div>
    <div class="py-5 md:pl-8 md:border-l border-rule"><p class="label !text-forest">Sueldo líquido</p><p class="fig text-[3.5rem] md:text-[4.5rem] leading-none mt-3 text-forest whitespace-nowrap">${clp(L.liquido)}</p></div>
  </section>

  <dl class="grid grid-cols-2 lg:grid-cols-[1.3fr_.8fr_1.5fr_.8fr_.9fr] gap-y-4 border-y border-rule py-4 text-[14px]">
    ${[['Colaboradora', 'Camila Andrade Rojas'], ['RUT', rut(12345678)], ['Cargo · centro de costo', 'Analista de Remuneraciones · CC-100'], ['Días trabajados', '30 de 31'], ['Fecha de pago', '30 oct 2026']].map(([k, v], i) => `
    <div class="${i === 2 ? 'col-span-2 lg:col-span-1' : ''}"><dt class="label">${k}</dt><dd class="mt-1 font-medium">${v}</dd></div>`).join('')}
  </dl>

  <div class="mt-10 grid md:grid-cols-2 gap-x-16 gap-y-10">
    <section aria-labelledby="h-haberes">
      <h2 id="h-haberes" class="serif text-heading font-normal mb-4">Haberes</h2>
      ${block('Imponibles', [row('Sueldo base', L.base), row('Gratificación legal', L.grat), row('Bono de desempeño', L.bono), row('Subtotal imponible', L.imp, { strong: true })])}
      ${block('No imponibles', [row('Asignación de colación', L.colacion), row('Asignación de movilización', L.movil), row('Subtotal no imponible', L.noImp, { strong: true })])}
      <div class="mt-5 flex items-baseline justify-between"><span class="label !text-ink">Total haberes</span><span class="fig text-[1.5rem]">${clp(L.haberes)}</span></div>
    </section>
    <section aria-labelledby="h-desc">
      <h2 id="h-desc" class="serif text-heading font-normal mb-4">Descuentos</h2>
      ${block('Legales', [row('AFP', L.afp, { neg: true }), row('AFP · comisión', L.com, { neg: true }), row('Fonasa', L.salud, { neg: true }), row('Seguro de cesantía', L.ces, { neg: true }), row('Impuesto único de segunda categoría', L.iut, { neg: true }), row('Subtotal legales', L.legales, { strong: true, neg: true })])}
      ${block('Otros', [row('Ahorro previsional voluntario (APV)', L.apv, { neg: true }), row('Subtotal otros', L.apv, { strong: true, neg: true })])}
      <div class="mt-5 flex items-baseline justify-between"><span class="label !text-ink">Total descuentos</span><span class="fig text-[1.5rem]">−${clp(L.descuentos)}</span></div>
    </section>
  </div>

  <section class="mt-12 pt-6 border-t-[3px] border-double border-ink grid md:grid-cols-[1fr_auto] gap-x-16 gap-y-3 items-start" aria-label="Pago">
    <p class="md:text-right text-[14px] text-ink-2 md:pt-6">Transferido el 30 de octubre de 2026<br>a la cuenta vista ···· 4821.</p>
  </section>
`);

/* ---------- v3 raw Vite response (Chrome text view of a text/javascript body) ---------- */

export const v3 = () => `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, minimum-scale=0.1"><title>${STAGING_HOST}:5173/@fs/etc/passwd?import&amp;raw</title></head>
<body style="margin:8px;background:#fff;color:#000"><pre style="word-wrap: break-word; white-space: pre-wrap; margin:0; font-family: monospace; font-size: 13px;">export default "root:x:0:0:root:/root:/bin/bash\\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\\nsync:x:4:65534:sync:/bin:/bin/sync\\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\\nnode:x:1000:1000::/home/node:/bin/bash\\n"</pre></body></html>`;

/* ---------- v4 error (what the attacker sees with Reaper on the portal) ---------- */

export const v4 = () => `${head('Error · Bruma Portal')}
<body class="bg-paper text-ink">
<div class="min-h-screen flex flex-col">
  <header class="border-b border-rule"><div class="mx-auto max-w-[1180px] px-5 md:px-10 h-16 flex items-center"><a href="#">${wordmark('Portal')}</a></div></header>
  <main class="flex-1 grid place-items-center px-6 py-16">
    <div class="max-w-[520px] text-center">
      <span class="inline-grid size-14 place-items-center rounded-full border border-rule bg-sheet text-ink-2">${ic('warning-circle', '!size-7')}</span>
      <h1 class="serif text-[2.5rem] md:text-[3.25rem] leading-[1.04] tracking-[-0.025em] font-light mt-7">No pudimos completar la solicitud.</h1>
      <p class="mt-4 text-[1.0625rem] text-ink-2">Intenta nuevamente en unos minutos.</p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <button class="btn btn-primary !h-11">Reintentar</button>
        <a href="#" class="btn btn-ghost !h-11">Volver al inicio</a>
      </div>
      <p class="mt-12 pt-5 border-t border-rule text-[13px] text-ink-3">ID de solicitud <span class="font-mono text-[12.5px] text-ink-2 ml-1">req_c04e5b18</span><span class="mx-2">·</span><span class="tnum">22 nov 2026, 14:09</span></p>
    </div>
  </main>
</div>
</body></html>`;

export const buildPortal = () => {
  write('v1-inicio.html', v1());
  write('v2-liquidacion.html', v2());
  write('v3-archivo-expuesto.html', v3());
  write('v4-error-reaper.html', v4());
};
