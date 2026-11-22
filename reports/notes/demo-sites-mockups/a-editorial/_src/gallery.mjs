// Storyboard for review: two rows (Consola / Portal), one card per stage.
import { ic, mark, head, write } from './lib.mjs';

const KIND = {
  ok: ['border-ink', 'text-ink'],
  open: ['border-brick', 'text-brick'],
  shield: ['border-forest', 'text-forest'],
};

const card = (n, caption, shot, href, kind = 'ok') => `
  <li class="flex">
    <a href="${href}" class="group flex flex-col w-full border-t-2 ${KIND[kind][0]} pt-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div class="flex items-baseline gap-3">
        <span class="fig text-[2.5rem] leading-none ${KIND[kind][1]}">${n}</span>
        <span class="text-[14px] leading-snug text-ink md:min-h-[2.6rem]">${caption}</span>
      </div>
      <figure class="mt-4 border border-rule bg-sheet overflow-hidden aspect-[16/10]">
        <img src="${shot}" alt="${caption}" loading="lazy" class="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]">
      </figure>
      <p class="mt-3 text-[12px] text-ink-3 flex items-center justify-between"><span class="font-mono">${href}</span><span class="inline-flex items-center gap-1 group-hover:text-ink">Abrir${ic('arrow-up-right', '!size-3.5')}</span></p>
    </a>
  </li>`;

const row = (title, sub, cards) => `
  <section class="mt-14 first:mt-0">
    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-ink pb-3">
      <h2 class="serif text-[1.75rem] font-normal tracking-[-0.01em]">${title}</h2>
      <p class="text-[13px] text-ink-3">${sub}</p>
    </div>
    <ol class="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">${cards.join('')}</ol>
  </section>`;

export const buildGallery = () => write('index.html', `${head('Storyboard · Dirección A')}
<body class="bg-paper text-ink">
<main class="mx-auto max-w-[1680px] px-5 md:px-12 py-10 md:py-14">
  <header class="flex flex-wrap items-end justify-between gap-6 pb-10">
    <div>
      <p class="label inline-flex items-center gap-2">${mark(18)}Dirección A · Editorial cálido</p>
      <h1 class="serif text-[2.5rem] md:text-[3.5rem] leading-[1.02] tracking-[-0.025em] font-light mt-4">Dos sitios de una misma empresa, <em class="text-forest">antes y después</em> del atacante.</h1>
    </div>
    <ul class="text-[13px] text-ink-2 space-y-1.5">
      <li class="flex items-center gap-2.5"><span class="w-5 border-t-2 border-ink"></span>Uso legítimo</li>
      <li class="flex items-center gap-2.5"><span class="w-5 border-t-2 border-brick"></span>Atacante sin Reaper</li>
      <li class="flex items-center gap-2.5"><span class="w-5 border-t-2 border-forest"></span>Atacante con Reaper</li>
    </ul>
  </header>

  ${row('Consola', 'Next.js 15 · App Router · Tailwind CSS 4 · consola de administración en producción', [
    card(1, 'Admin inicia sesión', 'shots/n1-login.png', 'n1-login.html'),
    card(2, 'Consola protegida', 'shots/n2-resumen.png', 'n2-resumen.html'),
    card(3, 'Colaboradores', 'shots/n3-colaboradores.png', 'n3-colaboradores.html'),
    card(4, 'Atacante sin Reaper: se salta el login y ve esta misma consola', 'shots/n2-resumen.png', 'n2-resumen.html', 'open'),
    card(5, 'Atacante con Reaper: error creíble', 'shots/n4-error-reaper.png', 'n4-error-reaper.html', 'shield'),
  ])}

  ${row('Portal', 'React SPA · servidor de desarrollo Vite expuesto en staging', [
    card(1, 'Inicio del colaborador', 'shots/v1-inicio.png', 'v1-inicio.html'),
    card(2, 'Liquidación', 'shots/v2-liquidacion.png', 'v2-liquidacion.html'),
    card(3, 'Atacante sin Reaper: lee archivos del servidor', 'shots/v3-archivo-expuesto.png', 'v3-archivo-expuesto.html', 'open'),
    card(4, 'Atacante con Reaper: error creíble', 'shots/v4-error-reaper.png', 'v4-error-reaper.html', 'shield'),
  ])}

  <footer class="mt-16 pt-5 border-t border-rule text-[12px] text-ink-3">Capturas a 1440 × 900 en <span class="font-mono">shots/</span>; versión móvil (390 × 844) con el sufijo <span class="font-mono">-movil</span>. Todos los nombres, RUT y montos son ficticios.</footer>
</main>
</body></html>`);
