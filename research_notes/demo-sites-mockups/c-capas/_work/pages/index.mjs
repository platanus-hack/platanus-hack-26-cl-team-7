import { I, D, Logo, doc } from '../lib.mjs';

const TAG = {
  ok: ['Uso legítimo', 'st-mute'],
  sin: ['Atacante · sin Reaper', 'st-bad'],
  con: ['Atacante · con Reaper', 'st-ok'],
};

const card = ({ n, caption, file, shot, kind, alt }) => `
  <article class="relative group flex flex-col gap-3.5 tile-sm p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-white">
    <div><span class="st ${TAG[kind][1]} !h-[24px] !text-[12px]">${TAG[kind][0]}</span></div>
    <h3 class="text-[15px] leading-snug font-medium"><a href="${file}.html" class="after:absolute after:inset-0 after:rounded-[20px] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-clay"><span class="num text-clay text-[17px]">${n}</span><span class="text-ink-3"> · </span>${caption}</a></h3>
    <img src="shots/${shot}.png" alt="${alt}" loading="lazy" class="mt-auto w-full aspect-[16/10] object-cover object-top rounded-[14px] border border-line bg-well transition duration-300 group-hover:scale-[1.015]">
    <div class="flex items-center justify-between text-caption text-ink-3"><span class="mono">${file}.html</span><a href="shots/${shot}-movil.png" class="relative z-10 flex items-center gap-1 hover:text-ink">${I('smartphone', 'size-4')}Móvil</a></div>
  </article>`;

const consola = [
  { n: 1, caption: 'Admin inicia sesión', file: 'n1-login', shot: 'n1-login', kind: 'ok', alt: 'Pantalla de inicio de sesión de Bruma Consola' },
  { n: 2, caption: 'Consola protegida', file: 'n2-resumen', shot: 'n2-resumen', kind: 'ok', alt: 'Resumen de remuneraciones con nómina en curso' },
  { n: 3, caption: 'Colaboradores', file: 'n3-colaboradores', shot: 'n3-colaboradores', kind: 'ok', alt: 'Listado de colaboradores con filtros' },
  { n: 4, caption: 'Atacante sin Reaper: se salta el login y ve esta misma consola', file: 'n2-resumen', shot: 'n2-resumen', kind: 'sin', alt: 'El atacante ve la misma consola protegida' },
  { n: 5, caption: 'Atacante con Reaper: error creíble', file: 'n4-error-reaper', shot: 'n4-error-reaper', kind: 'con', alt: 'Error genérico 500 de la consola' },
];
const portal = [
  { n: 1, caption: 'Inicio del colaborador', file: 'v1-inicio', shot: 'v1-inicio', kind: 'ok', alt: 'Inicio del portal del colaborador en staging' },
  { n: 2, caption: 'Liquidación', file: 'v2-liquidacion', shot: 'v2-liquidacion', kind: 'ok', alt: 'Detalle de la liquidación de octubre 2026' },
  { n: 3, caption: 'Atacante sin Reaper: lee archivos del servidor', file: 'v3-archivo-expuesto', shot: 'v3-archivo-expuesto', kind: 'sin', alt: 'Respuesta cruda del servidor de desarrollo con un archivo del sistema' },
  { n: 4, caption: 'Atacante con Reaper: error creíble', file: 'v4-error-reaper', shot: 'v4-error-reaper', kind: 'con', alt: 'Error genérico 500 del portal' },
];

const rowHead = (icon, title, sub) => `
  <div class="flex items-center gap-3.5 mb-5">
    <span class="ico-disc !size-11">${D(icon, 'size-6')}</span>
    <div><h2 class="text-[20px] font-semibold tracking-tight leading-tight">${title}</h2><p class="text-small text-ink-3">${sub}</p></div>
  </div>`;

const body = `
<div class="min-h-dvh p-2 sm:p-3">
  <div class="sheet px-5 py-8 sm:px-10 sm:py-10 xl:px-12">
    <header class="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 mb-10">
      <div class="max-w-[640px]">
        <div class="flex items-center gap-3">${Logo('size-9')}<span class="eyebrow">Dirección C · Capas suaves</span></div>
        <h1 class="text-[34px] sm:text-[40px] leading-[1.08] font-semibold tracking-tight mt-5">Bruma: storyboard de la demo</h1>
        <p class="text-body text-ink-2 mt-3">Dos sitios de una misma empresa ficticia, con y sin Reaper delante. Haz clic en una tarjeta para abrir la pantalla.</p>
      </div>
      <div class="flex flex-wrap gap-2 text-caption">
        <span class="st st-mute">Uso legítimo</span><span class="st st-bad">Atacante · sin Reaper</span><span class="st st-ok">Atacante · con Reaper</span>
      </div>
    </header>

    <section class="mb-12">
      ${rowHead('server-square', 'Consola · Next.js 15', 'Panel de administración para el equipo de remuneraciones')}
      <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">${consola.map(card).join('')}</div>
    </section>

    <section>
      ${rowHead('smartphone', 'Portal · React + Vite', 'Autoservicio del colaborador, servidor de desarrollo expuesto en staging')}
      <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        ${portal.map(card).join('')}
        <aside class="well p-5 flex flex-col justify-between gap-6 sm:col-span-2 lg:col-span-1">
          <div class="eyebrow">Lectura</div>
          <p class="text-small text-ink-2 leading-relaxed">Mismo pedido, dos respuestas. Sin Reaper el servidor entrega el archivo tal cual. Con Reaper el atacante recibe un error genérico de la propia aplicación.</p>
          <div class="flex items-center gap-2 text-caption text-ink-3">${I('shield-check', 'size-4')}Los datos de todas las pantallas son ficticios.</div>
        </aside>
      </div>
    </section>

    <footer class="mt-12 pt-6 border-t border-line flex flex-wrap items-center justify-between gap-3 text-caption text-ink-3">
      <span>Onest + Geist Mono · iconos Solar (inline SVG) · Tailwind CSS 4</span><a href="DESIGN.md" class="hover:text-ink underline decoration-line-2 underline-offset-2">DESIGN.md</a>
    </footer>
  </div>
</div>`;

export default doc({ title: 'Storyboard · Bruma', desc: 'Storyboard de la demo: consola y portal de Bruma, con y sin Reaper.', body });
