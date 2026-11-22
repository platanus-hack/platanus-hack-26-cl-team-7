import { I, D, doc } from '../lib.mjs';
import { shell } from '../console.mjs';
import { PEOPLE, CC, CC_COUNT, rut, initials } from '../data.mjs';

const stCls = { 'Activo': 'st-ok', 'Licencia médica': 'st-warn', 'Vacaciones': 'st-info', 'Finiquito en curso': 'st-mute' };
const SELECTED = new Set([1, 3]);

const row = (p, i) => `
  <div class="tr cols-col ${SELECTED.has(i) ? 'sel' : ''}">
    <span class="cb ${SELECTED.has(i) ? 'on' : ''} max-md:hidden">${SELECTED.has(i) ? I('check-read', 'size-3') : ''}</span>
    <div class="flex items-center gap-3 min-w-0">
      <span class="avatar av-${p.av}">${initials(p.n)}</span>
      <div class="min-w-0"><div class="text-[14.5px] font-medium truncate">${p.n}</div>
        <div class="text-caption text-ink-3 truncate md:hidden">${p.cargo} · ${CC[p.cc].name}</div></div>
    </div>
    <div class="mono text-[13.5px] text-ink-2 max-md:hidden">${rut(p.r)}</div>
    <div class="text-small max-md:hidden">${p.cargo}</div>
    <div class="max-md:hidden"><span class="chip !pl-2.5"><i class="size-2 rounded-full" style="background:${CC[p.cc].color}"></i>${CC[p.cc].name}</span></div>
    <div class="max-md:hidden"><div class="text-small">${p.ct}</div>${p.warn ? `<div class="text-caption text-ochre-ink">${p.warn}</div>` : ''}</div>
    <div class="max-md:text-right"><span class="st ${stCls[p.st]}">${p.st}</span></div>
    <button class="btn btn-icon btn-ghost !size-8 max-md:hidden" aria-label="Acciones">${I('menu-dots', 'size-5')}</button>
  </div>`;

const total = Object.values(CC_COUNT).reduce((a, b) => a + b, 0);
const dist = Object.entries(CC_COUNT).map(([k, v]) => `<i class="h-3 rounded-full" style="flex:${v};background:${CC[k].color}" title="${CC[k].name} ${v}"></i>`).join('');

const filter = (label, val) => `<button class="btn btn-sm !pr-3">${label}${val ? `<span class="text-clay-2 font-semibold">${val}</span>` : ''}${I('alt-arrow-down', 'size-3.5 text-ink-3')}</button>`;

const body = `
<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6">
  <div><div class="eyebrow">Personas</div><h1 class="text-h1 font-semibold tracking-tight mt-1.5">Colaboradores</h1></div>
  <div class="flex items-center gap-2.5">
    <button class="btn max-sm:hidden">${I('upload-minimalistic', 'size-[18px]')} Importar</button>
    <button class="btn max-sm:hidden">${I('download-minimalistic', 'size-[18px]')} Exportar</button>
    <button class="btn btn-accent">${I('user-plus-rounded', 'size-[18px]')} Agregar colaborador</button>
  </div>
</div>

<section class="tile p-5 lg:px-6 lg:py-5 flex flex-wrap items-center gap-x-8 gap-y-4">
  <div class="shrink-0"><div class="num text-[34px] leading-none">${total}</div><div class="text-small text-ink-3 mt-1.5">colaboradores activos</div></div>
  <div class="flex-1 min-w-[280px]">
    <div class="flex gap-[3px]">${dist}</div>
  </div>
</section>

<div class="mt-5 flex flex-wrap items-center gap-2.5">
  <label class="relative block flex-1 min-w-[220px] max-w-[360px]">
    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">${I('magnifer', 'size-[18px]')}</span>
    <input class="field field-pill !h-10 !pl-11 !text-small" placeholder="Buscar" value="">
    <span class="kbd absolute right-3 top-1/2 -translate-y-1/2 max-sm:hidden">/</span>
  </label>
  <div class="flex flex-wrap items-center gap-2">
    ${filter('Centro de costo', ' · 1')}${filter('Contrato', ' · 1')}${filter('Estado')}${filter('AFP')}
    <button class="btn btn-sm btn-ghost">${I('tuning-2', 'size-4')} Más filtros</button>
  </div>
  <div class="seg ml-auto max-lg:hidden"><button class="on">${I('list-check', 'size-4')} Tabla</button><button>${I('widget-4', 'size-4')} Tarjetas</button></div>
</div>
<section class="tile mt-4 overflow-hidden">
  <div class="tr th cols-col"><span class="cb max-md:hidden"></span><div>Colaborador</div><div class="max-md:hidden">RUT</div><div class="max-md:hidden">Cargo</div><div class="max-md:hidden">Centro de costo</div><div class="max-md:hidden">Contrato</div><div class="max-md:text-right">Estado</div><div class="max-md:hidden"></div></div>
  ${PEOPLE.filter((_, i) => [0, 1, 2, 4, 5, 7, 9, 11].includes(i)).map(row).join('')}
  <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-line text-small text-ink-3">
    <span>Mostrando 1–8 de 142</span>
    <div class="seg"><button>${I('alt-arrow-left', 'size-4')}</button><button class="on">1</button><button>2</button><button>3</button><button class="max-sm:hidden">…</button><button class="max-sm:hidden">12</button><button>${I('alt-arrow-right', 'size-4')}</button></div>
  </div>
</section>

<div class="sticky bottom-0 mt-4 -mb-2 flex justify-center pointer-events-none">
  <div class="pointer-events-auto flex items-center gap-1.5 sm:gap-2 p-1.5 pl-4 sm:pl-5 rounded-full bg-ink text-[#f6f2ea] shadow-[0_6px_20px_rgb(40_30_20/.25)] text-small">
    <span class="font-medium whitespace-nowrap">2 seleccionados</span>
    <span class="w-px h-5 bg-white/20 mx-1 sm:mx-2"></span>
    <button class="h-9 px-3 sm:px-4 rounded-full hover:bg-white/10 flex items-center gap-2 whitespace-nowrap">${I('document-text', 'size-[18px]')}<span><span class="max-sm:hidden">Generar </span>liquidaciones</span></button>
    <button class="h-9 px-3 sm:px-4 rounded-full hover:bg-white/10 items-center gap-2 whitespace-nowrap hidden md:flex">${I('buildings-2', 'size-[18px]')}Cambiar centro de costo</button>
    <button class="size-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center" aria-label="Limpiar selección">${I('close-circle', 'size-5')}</button>
  </div>
</div>`;

const css = `
.cols-col { --cols: minmax(0,1fr) auto; }
@media (min-width: 768px) { .cols-col { --cols: 18px minmax(190px,1.35fr) 112px minmax(130px,1.1fr) 150px 112px 140px 32px; } }
`;

export default doc({ title: 'Colaboradores · Bruma Consola', desc: 'Listado de colaboradores con filtros por centro de costo, contrato y estado.', body: shell({ active: 'colaboradores', body }), css });
