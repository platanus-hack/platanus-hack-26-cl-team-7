import { I, D, Logo } from './lib.mjs';

const NAV = [
  ['Nómina', [
    ['resumen', 'home-2', 'Resumen', 'n2-resumen.html'],
    ['procesos', 'wallet-money', 'Procesos', '#', '1'],
    ['liquidaciones', 'document-text', 'Liquidaciones', '#'],
    ['previred', 'bill-check', 'Previred', '#'],
  ]],
  ['Personas', [
    ['colaboradores', 'users-group-rounded', 'Colaboradores', 'n3-colaboradores.html'],
    ['contratos', 'suitcase-lines', 'Contratos', '#'],
    ['centros', 'buildings-2', 'Centros de costo', '#'],
  ]],
  ['Cuenta', [
    ['documentos', 'folder', 'Documentos', '#'],
    ['integraciones', 'plug-circle', 'Integraciones', '#'],
    ['config', 'settings', 'Configuración', '#'],
  ]],
];

export function nav(active) {
  return NAV.map(([h, items]) => `
    <div class="nav-h">${h}</div>
    <nav class="flex flex-col gap-1">${items.map(([k, ic, label, href, badge]) =>
      `<a href="${href}" class="nav-i ${k === active ? 'on' : ''}">${I(ic, 'size-5')}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`).join('')}
    </nav>`).join('');
}

export function shell({ active, body }) {
  return `
<div class="h-dvh overflow-hidden lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
  <aside class="hidden lg:flex flex-col px-4 pt-5 pb-4 h-dvh overflow-y-auto">
    <a href="n2-resumen.html" class="flex items-center gap-3 px-2 h-10">
      ${Logo('size-8')}
      <span class="text-[18px] font-semibold tracking-tight">Bruma</span>
      <span class="chip !h-[22px] !px-2 text-micro">Consola</span>
    </a>
    ${nav(active)}
  </aside>

  <div class="flex flex-col min-w-0 h-dvh">
    <header class="flex items-center gap-2 sm:gap-3 h-16 shrink-0 px-3 lg:px-1 lg:pr-4">
      <button class="btn btn-icon lg:hidden" aria-label="Abrir menú">${I('hamburger-menu', 'size-5')}</button>
      <button class="btn !pl-3.5 !pr-3 gap-2.5 min-w-0 flex-1 sm:flex-none justify-start" aria-label="Cambiar de workspace">
        <span class="size-2 rounded-full bg-sage ring-4 ring-sage-soft shrink-0"></span>
        <span class="mono text-[13.5px] truncate" data-canary="workspace">bruma-produccion</span>
        <span class="chip chip-clay !h-[22px] !px-2 text-micro max-sm:hidden">Producción</span>
        <span class="ml-auto sm:ml-1">${I('sort-vertical', 'size-4 text-ink-3')}</span>
      </button>
      <button class="hidden md:flex flex-1 max-w-[460px] mx-3 h-10 items-center gap-2.5 px-4 rounded-full border border-line bg-white/55 text-small text-ink-3 hover:bg-white/80 transition">
        ${I('magnifer', 'size-[18px]')}<span class="truncate">Buscar</span><span class="kbd ml-auto">⌘K</span>
      </button>
      <div class="flex items-center gap-1.5 sm:gap-2 md:ml-auto">
        <button class="btn btn-icon btn-ghost md:hidden" aria-label="Buscar">${I('magnifer', 'size-5')}</button>
        <button class="btn btn-icon btn-ghost max-sm:hidden" aria-label="Ayuda">${I('question-circle', 'size-5')}</button>
        <button class="btn btn-icon btn-ghost relative max-sm:hidden" aria-label="Notificaciones">${I('bell', 'size-5')}<span class="absolute top-2.5 right-2.5 size-2 rounded-full bg-clay ring-2 ring-canvas"></span></button>
        <button class="flex items-center gap-2.5 h-10 pl-1 sm:pr-3 rounded-full hover:bg-white/55 transition" aria-label="Menú de usuario">
          <span class="avatar av-clay !size-8">PM</span>
          <span class="hidden xl:block text-left leading-tight"><span class="block text-small font-medium">Paula Meza</span><span class="block text-micro text-ink-3">Administradora de nómina</span></span>
          ${I('alt-arrow-down', 'size-4 text-ink-3 max-sm:hidden')}
        </button>
      </div>
    </header>
    <main class="sheet relative flex-1 overflow-y-auto mx-2 mb-2 lg:ml-0 lg:mr-3 lg:mb-3 px-5 py-6 lg:px-8 lg:py-8">
      ${body}
    </main>
  </div>
</div>`;
}
