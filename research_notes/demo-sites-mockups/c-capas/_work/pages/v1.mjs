import { I, D, doc, money } from '../lib.mjs';
import { portal } from '../portal.mjs';
import { clp } from '../data.mjs';

const LIQ = [
  ['Octubre 2026', '$1.643.222', 'Pagada el 30 oct', 'ok'],
  ['Septiembre 2026', '$1.589.040', 'Pagada el 30 sep', 'ok'],
  ['Agosto 2026', '$1.571.806', 'Pagada el 31 ago', 'ok'],
];
const DOCS = [
  ['Contrato de trabajo', 'PDF'],
  ['Anexo de teletrabajo', 'PDF'],
  ['Certificado de antigüedad', 'PDF'],
];

const body = `
<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-7">
  <div>
    <h1 class="text-h1 sm:text-[34px] font-semibold tracking-tight mt-1.5">Hola, Camila</h1>
  </div>
  <div class="flex items-center gap-2.5">
    <button class="btn max-sm:hidden">${I('download-minimalistic', 'size-[18px]')} Última liquidación</button>
    <button class="btn btn-accent">${I('sun-2', 'size-[18px]')} Solicitar vacaciones</button>
  </div>
</div>

<div class="grid grid-cols-12 gap-4">
  <!-- Proximo pago -->
  <section class="tint col-span-12 lg:col-span-5 p-6 lg:p-7 flex flex-col">
    <div class="flex items-center justify-between"><span class="eyebrow !text-clay-2">Próximo pago</span><span class="ico-disc !size-9 !bg-white/60">${D('calendar-date', 'size-5')}</span></div>
    <div class="flex items-baseline gap-3 mt-3"><span class="num text-[48px] leading-none">30</span><span class="text-[32px] leading-none font-semibold tracking-tight">nov</span><span class="text-body text-ink-2 ml-1">lunes · 2026</span></div>
    <div class="mt-4 bg-white/65 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-4">
      <div><div class="text-caption text-ink-3">Sueldo líquido estimado</div><div class="num text-[24px] leading-none mt-1.5">${money('$1.643.222')}</div></div>
      <span class="st st-info">Estimado</span>
    </div>
    <div class="mt-6 pt-5 border-t border-clay-line">
      <div class="text-small font-medium mb-4">Ciclo de noviembre</div>
      <div class="tl tl-v">
        <div class="tl-s done"><span class="tl-n">${I('check-read', 'size-4')}</span><div class="tl-t">Novedades cerradas</div></div>
        <div class="tl-s done"><span class="tl-n">${I('check-read', 'size-4')}</span><div class="tl-t">Cálculo de nómina</div></div>
        <div class="tl-s now"><span class="tl-n">3</span><div class="tl-t">Revisión y aprobación</div></div>
        <div class="tl-s pend"><span class="tl-n">4</span><div class="tl-t">Pago por transferencia</div></div>
      </div>
    </div>
  </section>

  <div class="col-span-12 lg:col-span-7 grid grid-cols-2 gap-4 content-start">
    <!-- Liquidaciones -->
    <section class="tile col-span-2 p-6 lg:px-7">
      <div class="flex items-center justify-between"><h2 class="text-[17px] font-semibold">Últimas liquidaciones</h2><a href="v2-liquidacion.html" class="text-small font-medium text-clay-2 flex items-center gap-1 hover:underline">Ver todas ${I('arrow-right', 'size-4')}</a></div>
      <ul class="mt-3 -mx-2">
        ${LIQ.map((l, i) => `
        <li><a href="v2-liquidacion.html" class="flex items-center gap-4 px-2 py-3.5 rounded-2xl hover:bg-well/70 transition ${i ? 'border-t border-line rounded-none' : ''}">
          <span class="ico-disc">${D('document-text', 'size-5')}</span>
          <div class="flex-1 min-w-0"><div class="text-[15px] font-medium">${l[0]}</div></div>
          <div class="num text-[16px]">${l[1]}</div>
          <span class="btn btn-icon btn-sm !size-9 !w-9 max-sm:hidden">${I('download-minimalistic', 'size-[18px]')}</span>
        </a></li>`).join('')}
      </ul>
    </section>

    <!-- Vacaciones -->
    <section class="tile col-span-2 sm:col-span-1 p-6">
      <div class="flex items-center justify-between"><h2 class="text-[17px] font-semibold">Vacaciones</h2><span class="ico-disc !size-9">${D('sun-2', 'size-5')}</span></div>
      <div class="flex items-baseline gap-2 mt-3"><span class="num text-[40px] leading-none">${money('11,5')}</span><span class="text-body text-ink-2">días hábiles</span></div>
      <div class="flex gap-1 mt-4" role="img" aria-label="6,5 días tomados y 11,5 de saldo, de 18 acumulados">
        <i class="h-2.5 rounded-full bg-sand" style="flex:6.5"></i><i class="h-2.5 rounded-full bg-clay" style="flex:11.5"></i>
      </div>
    </section>

    <!-- Documentos -->
    <section class="tile col-span-2 sm:col-span-1 p-6">
      <div class="flex items-center justify-between"><h2 class="text-[17px] font-semibold">Documentos</h2><button class="btn btn-sm">${I('add-circle', 'size-4')} Solicitar</button></div>
      <ul class="mt-3 flex flex-col">
        ${DOCS.map((d, i) => `<li class="flex items-center gap-3 py-3 ${i ? 'border-t border-line' : ''}">
          <span class="grid place-items-center size-9 rounded-xl bg-well text-ink-2">${I('file-text', 'size-[18px]')}</span>
          <div class="flex-1 min-w-0"><div class="text-small font-medium truncate">${d[0]}</div><div class="text-caption text-ink-3 truncate">${d[1]}</div></div>
          ${I('download-minimalistic', 'size-[18px] text-ink-3')}
        </li>`).join('')}
      </ul>
    </section>
  </div>
</div>`;

export default doc({ title: 'Inicio · Bruma Portal', desc: 'Portal del colaborador: próximo pago, liquidaciones, vacaciones y documentos.', body: portal({ active: 'inicio', body }) });
