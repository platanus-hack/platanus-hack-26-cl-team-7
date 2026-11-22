import { I, D, Logo, doc, money } from '../lib.mjs';

const body = `
<div class="min-h-dvh grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] p-0 lg:p-3 gap-0 lg:gap-3">
  <!-- Formulario -->
  <section class="flex flex-col px-6 py-6 sm:px-10 lg:px-14 lg:py-8 min-h-dvh lg:min-h-0">
    <a href="#" class="flex items-center gap-3 h-10">
      ${Logo('size-9')}
      <span class="text-[19px] font-semibold tracking-tight">Bruma</span>
      <span class="chip !h-[22px] !px-2 text-micro">Consola</span>
    </a>

    <div class="flex-1 flex items-center">
      <form class="w-full max-w-[400px] mx-auto py-10" onsubmit="return false">
        <div class="eyebrow">Consola de administración</div>
        <h1 class="text-[32px] leading-[1.1] font-semibold tracking-tight mt-2">Inicia sesión</h1>

        <div class="mt-8 flex flex-col gap-4">
          <label class="block">
            <span class="block text-small font-medium mb-2">Correo electrónico</span>
            <input class="field" type="email" placeholder="nombre@empresa.cl" autocomplete="username">
          </label>
          <label class="block">
            <span class="flex items-center justify-between mb-2"><span class="text-small font-medium">Contraseña</span><a href="#" class="text-small text-clay-2 font-medium hover:underline">¿La olvidaste?</a></span>
            <span class="relative block">
              <input class="field !pr-12" type="password" placeholder="Tu contraseña" autocomplete="current-password">
              <button type="button" class="absolute right-1.5 top-1/2 -translate-y-1/2 size-9 grid place-items-center rounded-full text-ink-3 hover:bg-well" aria-label="Mostrar contraseña">${I('eye', 'size-5')}</button>
            </span>
          </label>
        </div>

        <label class="mt-5 flex items-center gap-3 cursor-pointer select-none">
          <button type="button" class="sw on" role="switch" aria-checked="true" aria-label="Mantener sesión"></button>
          <span class="text-small"><span class="font-medium">Mantener sesión</span></span>
        </label>

        <button class="btn btn-accent w-full !h-12 !text-[15px] mt-6" type="submit">Iniciar sesión ${I('arrow-right', 'size-[18px]')}</button>

        <div class="flex items-center gap-4 my-5 text-caption text-ink-3"><span class="h-px flex-1 bg-line-2/70"></span>o<span class="h-px flex-1 bg-line-2/70"></span></div>

        <button class="btn is-off w-full !h-12 !text-[15px] justify-between" type="button" disabled aria-disabled="true">
          <span class="flex items-center gap-2.5">${I('key', 'size-5')}<span><span class="max-sm:hidden">Continuar con </span>SSO corporativo</span></span>
          <span class="chip !h-6 text-micro">Plan Empresa</span>
        </button>

      </form>
    </div>

    <footer class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-caption text-ink-3">
      <span>© 2026 Bruma Remuneraciones SpA</span>
    </footer>
  </section>

  <!-- Panel de capas -->
  <aside class="sheet relative overflow-hidden hidden lg:block" aria-hidden="true">
    <svg class="absolute inset-0 w-full h-full" viewBox="0 0 760 840" preserveAspectRatio="xMaxYMin slice">
      <path d="M402 240a158 158 0 0 1 316 0z" fill="#f3e2d8"/>
      <path d="M460 240a100 100 0 0 1 200 0z" fill="#e9c6b3"/>
      <rect x="150" y="258" width="640" height="52" rx="26" fill="#ede6da"/>
      <rect x="-20" y="330" width="560" height="46" rx="23" fill="#e6ddcf"/>
      <rect x="250" y="396" width="520" height="40" rx="20" fill="#e0d6c5" fill-opacity=".75"/>
    </svg>

    <div class="relative h-full p-12 flex flex-col gap-4">
      <div class="max-w-[330px]"><div class="eyebrow">Bruma Remuneraciones</div><p class="text-[26px] leading-[1.2] font-semibold tracking-tight mt-3">Cálculo, revisión, pago y Previred en un solo lugar.</p></div>
      <div class="flex-1"></div>
      <div class="tile-sm p-5 w-[360px] self-end -mb-1">
        <div class="flex items-center justify-between"><span class="eyebrow">Liquidaciones de octubre</span><span class="st st-ok">Emitidas</span></div>
        <div class="num text-[34px] mt-2.5">139<span class="text-ink-3 text-[20px]"> / 139</span></div>
        <div class="mt-3 flex gap-1.5">${Array.from({ length: 18 }, () => '<i class="h-1.5 flex-1 rounded-full bg-clay"></i>').join('')}</div>
      </div>
      <div class="tile-sm p-5 w-[360px] self-start ml-6">
        <div class="flex items-center gap-3">
          <span class="ico-disc !size-10">${D('shield-check', 'size-5')}</span>
          <div><div class="text-small font-medium">Previred declarado</div></div>
        </div>
      </div>
      <div class="tile-sm p-5 w-[360px] self-end">
        <div class="flex items-center justify-between"><span class="eyebrow">Próximo pago</span><span class="mono text-caption text-ink-3">en 8 días</span></div>
        <div class="flex items-baseline gap-2.5 mt-2"><span class="num text-[34px] leading-none">30</span><span class="text-[24px] leading-none font-semibold tracking-tight">nov 2026</span></div>
      </div>
    </div>
  </aside>
</div>`;

export default doc({ title: 'Inicia sesión · Bruma Consola', desc: 'Acceso a la consola de administración de remuneraciones.', body });
