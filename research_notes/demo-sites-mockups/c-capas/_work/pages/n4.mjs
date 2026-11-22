import { I, D, Logo, doc } from '../lib.mjs';

const body = `
<div class="min-h-dvh flex flex-col p-3">
  <header class="flex items-center justify-between px-3 sm:px-8 h-16">
    <a href="#" class="flex items-center gap-3">${Logo('size-8')}<span class="text-[18px] font-semibold tracking-tight">Bruma</span><span class="chip !h-[22px] !px-2 text-micro">Consola</span></a>
  </header>

  <main class="flex-1 flex items-center justify-center py-8 px-1">
    <section class="tile w-full max-w-[560px] p-8 sm:p-12 text-center">
      <svg class="mx-auto h-[88px] w-[160px]" viewBox="0 0 160 88" aria-hidden="true">
        <path d="M50 52a30 30 0 0 1 60 0z" fill="#f3e2d8"/>
        <path d="M64 52a16 16 0 0 1 32 0z" fill="#e9c6b3"/>
        <rect x="26" y="58" width="108" height="9" rx="4.5" fill="#e6ddcf"/>
        <rect x="46" y="72" width="82" height="7" rx="3.5" fill="#ede6da"/>
      </svg>
      <div class="eyebrow mt-6">Error 500</div>
      <h1 class="text-[28px] leading-[1.15] font-semibold tracking-tight mt-2.5">No pudimos completar la solicitud.</h1>
      <p class="text-body text-ink-2 mt-3">Intenta nuevamente.</p>
      <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button class="btn btn-accent !h-11">${I('refresh', 'size-[18px]')} Intentar nuevamente</button>
        <a href="n2-resumen.html" class="btn !h-11">Ir al inicio</a>
      </div>
      <div class="mt-9 inline-flex items-center gap-3 well-sm pl-4 pr-2 py-2 text-caption text-ink-3">
        <span>ID de solicitud</span><span class="mono text-small text-ink">req_7f3a91c2</span>
        <button class="btn btn-sm btn-icon !size-8 !w-8" aria-label="Copiar ID">${I('copy', 'size-4')}</button>
      </div>
    </section>
  </main>

  <footer class="px-3 sm:px-8 pb-3 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-3">
    <span>© 2026 Bruma Remuneraciones SpA</span>
  </footer>
</div>`;

export default doc({ title: 'Error · Bruma Consola', desc: 'Error al procesar la solicitud.', body });
