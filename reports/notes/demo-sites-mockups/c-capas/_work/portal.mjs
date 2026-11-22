import { I, D, Logo } from './lib.mjs';

export const stagingBar = () => `
<div class="stg" role="status">
  <span class="stg-tag">Entorno de pruebas</span>
</div>`;

const TABS = [
  ['inicio', 'home-2', 'Inicio', 'v1-inicio.html'],
  ['liquidaciones', 'document-text', 'Liquidaciones', 'v2-liquidacion.html'],
  ['vacaciones', 'sun-2', 'Vacaciones', '#'],
  ['documentos', 'folder', 'Documentos', '#'],
  ['perfil', 'user-rounded', 'Perfil', '#'],
];

export function portal({ active, body, nav = true }) {
  return `
<div class="min-h-dvh flex flex-col">
  ${stagingBar()}
  <header class="flex items-center gap-4 h-[68px] px-4 lg:px-8 shrink-0">
    <a href="v1-inicio.html" class="flex items-center gap-3">${Logo('size-8')}<span class="text-[18px] font-semibold tracking-tight">Bruma</span><span class="chip !h-[22px] !px-2 text-micro">Portal</span></a>
    ${nav ? `<nav class="seg mx-auto max-md:hidden" aria-label="Principal">${TABS.map(([k, ic, l, h]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="flex items-center gap-2 ml-auto md:ml-0">
      <button class="btn btn-icon btn-ghost relative" aria-label="Notificaciones">${I('bell', 'size-5')}<span class="absolute top-2.5 right-2.5 size-2 rounded-full bg-clay ring-2 ring-canvas"></span></button>
      <button class="flex items-center gap-2.5 h-10 pl-1 sm:pr-3 rounded-full hover:bg-white/55 transition" aria-label="Mi cuenta">
        <span class="avatar av-clay !size-8">CV</span>
        <span class="hidden lg:block text-left leading-tight"><span class="block text-small font-medium">Camila Valdés</span><span class="block text-micro text-ink-3">Producto</span></span>
      </button>
    </div>` : ''}
  </header>
  <main class="sheet flex-1 mx-2 mb-2 lg:mx-3 lg:mb-3 px-5 pt-7 pb-28 md:pb-10 lg:px-10 lg:pt-9">
    <div class="max-w-[1120px] mx-auto">${body}</div>
  </main>
  ${nav ? `<nav class="md:hidden fixed bottom-3 inset-x-3 z-10 flex justify-between p-1.5 rounded-full bg-ink/95 text-[#e9e2d6]" aria-label="Principal">
    ${TABS.map(([k, ic, l, h]) => `<a href="${h}" class="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-full text-[10.5px] ${k === active ? 'bg-white/14 text-white' : ''}">${I(ic, 'size-5')}${l}</a>`).join('')}
  </nav>` : ''}
</div>`;
}
