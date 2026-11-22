import { I, D, doc, money } from '../lib.mjs';
import { portal } from '../portal.mjs';
import { clp, liquidacion, rut } from '../data.mjs';

const L = liquidacion();
const pct = (v) => Math.round(v * 1000) / 10;

const line = (concept, note, amount, tag) => `
  <div class="tr cols-liq !py-3">
    <div class="min-w-0"><div class="text-[14.5px]">${concept}</div>${note ? `<div class="text-caption text-ink-3 mt-0.5">${note}</div>` : ''}</div>
    <div class="max-sm:hidden">${tag ? `<span class="chip">${tag}</span>` : ''}</div>
    <div class="mono text-[14px] text-right">${amount}</div>
  </div>`;
const sub = (label, amount) => `<div class="tr cols-liq !py-3 bg-well/60"><div class="text-small font-medium">${label}</div><div class="max-sm:hidden"></div><div class="mono text-[14.5px] font-medium text-right">${amount}</div></div>`;

const meta = (k, v, mono) => `<div><div class="text-caption text-ink-3">${k}</div><div class="${mono ? 'mono text-[14px]' : 'text-[14.5px]'} mt-0.5">${v}</div></div>`;
const share = [L.liquido, L.descuentos - 0];

const body = `
<div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 mb-7">
  <div>
    <nav class="flex items-center gap-1.5 text-small text-ink-3" aria-label="Ruta"><a href="v1-inicio.html" class="hover:text-ink">Inicio</a>${I('alt-arrow-right', 'size-3.5')}<a href="#" class="hover:text-ink">Liquidaciones</a>${I('alt-arrow-right', 'size-3.5')}<span class="text-ink">Octubre 2026</span></nav>
    <h1 class="text-h1 sm:text-[34px] font-semibold tracking-tight mt-3">Liquidación de sueldo</h1>
    <p class="text-body text-ink-2 mt-1.5">Octubre 2026 · pagada el 30 de octubre</p>
  </div>
  <div class="flex flex-wrap items-center gap-2.5">
    <div class="seg" role="tablist" aria-label="Mes"><button>Jul</button><button>Ago</button><button>Sep</button><button class="on">Oct</button></div>
    <button class="btn btn-accent">${I('download-minimalistic', 'size-[18px]')} Descargar PDF</button>
  </div>
</div>

<div class="grid grid-cols-12 gap-4 items-start">
  <section class="tile col-span-12 lg:col-span-8 overflow-hidden">
    <div class="p-6 lg:p-7 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
      ${meta('Colaboradora', 'Camila Valdés Rojas')}
      ${meta('RUT', rut(17254883), true)}
      ${meta('Cargo', 'Analista de Producto')}
      ${meta('Centro de costo', 'Producto · CC-210')}
      ${meta('Días trabajados', '30 de 30', true)}
    </div>

    <div class="tr th cols-liq !border-t !border-line"><div>Haberes</div><div class="max-sm:hidden">Tipo</div><div class="text-right">Monto</div></div>
    ${line('Sueldo base', '', clp(L.base))}
    ${line('Gratificación legal', '', clp(L.grat))}
    ${line('Horas extra', '', clp(L.he))}
    ${line('Asignación de colación', '', clp(L.colacion))}
    ${line('Asignación de movilización', '', clp(L.movil))}
    ${sub('Total haberes', clp(L.haberes))}

    <div class="tr th cols-liq !border-t !border-line"><div>Descuentos legales</div><div class="max-sm:hidden">Tasa</div><div class="text-right">Monto</div></div>
    ${line('AFP', '', '−' + clp(L.afp).slice(0))}
    ${line('Salud · Fonasa', '', '−' + clp(L.salud))}
    ${line('Seguro de cesantía', '', '−' + clp(L.ces))}
    ${line('Impuesto único de segunda categoría', '', '−' + clp(L.iu))}
    ${sub('Total descuentos', '−' + clp(L.descuentos))}

    <div class="m-4 lg:m-5 rounded-[22px] bg-clay-wash border border-clay-line px-6 py-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <div><div class="eyebrow !text-clay-2">Sueldo líquido</div></div>
      <div class="num text-[38px] sm:text-[44px] leading-none">${money(clp(L.liquido))}</div>
    </div>
  </section>

  <aside class="col-span-12 lg:col-span-4 flex flex-col gap-4">
    <section class="tile p-6">
      <div class="flex items-center justify-between"><span class="eyebrow">Sueldo líquido</span><span class="st st-ok">Pagada</span></div>
      <div class="num text-[40px] leading-none mt-3">${money(clp(L.liquido))}</div>
      <div class="flex gap-1 mt-5" role="img" aria-label="Sueldo líquido 81 %, descuentos 19 %">
        <i class="h-3 rounded-full bg-clay" style="flex:${L.liquido}"></i><i class="h-3 rounded-full" style="flex:${L.descuentos};background:#a9bcc8"></i>
      </div>
      <ul class="mt-4 flex flex-col gap-2.5 text-small">
        <li class="flex items-center gap-2.5"><i class="size-2.5 rounded-[4px] bg-clay"></i><span class="flex-1">Sueldo líquido</span><span class="mono text-ink-2">${pct(L.liquido / L.haberes)} %</span></li>
        <li class="flex items-center gap-2.5"><i class="size-2.5 rounded-[4px]" style="background:#a9bcc8"></i><span class="flex-1">Descuentos legales</span><span class="mono text-ink-2">${pct(L.descuentos / L.haberes)} %</span></li>
      </ul>
    </section>

    <section class="tile p-6">
      <h2 class="text-[17px] font-semibold">Base de cálculo</h2>
      <dl class="mt-4 flex flex-col text-small">
        <div class="flex justify-between py-2.5"><dt class="text-ink-3">Renta imponible</dt><dd class="mono">${clp(L.imponible)}</dd></div>
        <div class="flex justify-between py-2.5 border-t border-line"><dt class="text-ink-3">Renta tributable</dt><dd class="mono">${clp(L.tributable)}</dd></div>
        <div class="flex justify-between py-2.5 border-t border-line"><dt class="text-ink-3">Declarada en Previred</dt><dd class="mono">10 nov 2026</dd></div>
      </dl>
    </section>

  </aside>
</div>`;

const css = `
.cols-liq { --cols: minmax(0,1fr) auto; }
@media (min-width: 640px) { .cols-liq { --cols: minmax(0,1fr) 120px 130px; } }
`;

export default doc({ title: 'Liquidación octubre 2026 · Bruma Portal', desc: 'Detalle de la liquidación de sueldo de octubre 2026.', body: portal({ active: 'liquidaciones', body }), css });
