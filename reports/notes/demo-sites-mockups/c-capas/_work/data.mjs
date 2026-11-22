export const clp = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const num = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function dv(body) {
  let s = 0, m = 2;
  for (const d of String(body).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}
export const rut = (body) => num(body) + '-' + dv(body);

// Liquidacion de octubre 2026 de la colaboradora del portal (cifras ficticias)
export function liquidacion() {
  const base = 1650000, grat = 213354, he = 54200, colacion = 62000, movil = 48000;
  const imponible = base + grat + he;
  const haberes = imponible + colacion + movil;
  const afp = Math.round(imponible * 0.1115);
  const salud = Math.round(imponible * 0.07);
  const ces = Math.round(imponible * 0.006);
  const tributable = imponible - afp - salud - ces;
  const iu = 24791;
  const anticipo = 0;
  const descuentos = afp + salud + ces + iu + anticipo;
  const liquido = haberes - descuentos;
  return { base, grat, he, colacion, movil, imponible, haberes, afp, salud, ces, tributable, iu, descuentos, liquido };
}

export const CC = {
  ing: { code: 'CC-100', name: 'Ingeniería', color: '#5b7c90' },
  pro: { code: 'CC-210', name: 'Producto', color: '#b4583a' },
  com: { code: 'CC-300', name: 'Comercial', color: '#a67a2c' },
  sop: { code: 'CC-400', name: 'Soporte', color: '#5f806a' },
  adm: { code: 'CC-500', name: 'Administración', color: '#8b6f86' },
  per: { code: 'CC-600', name: 'Personas', color: '#9a8f80' },
};
export const CC_COUNT = { ing: 41, pro: 24, com: 28, sop: 33, adm: 10, per: 6 };

export const PEOPLE = [
  { n: 'Camila Valdés Rojas', r: 17254883, cargo: 'Analista de Producto', cc: 'pro', ct: 'Indefinido', since: 'mar 2023', st: 'Activo', av: 'clay' },
  { n: 'Matías Contreras Pino', r: 16830472, cargo: 'Ingeniero de Software Sr.', cc: 'ing', ct: 'Indefinido', since: 'ago 2021', st: 'Activo', av: 'slate' },
  { n: 'Francisca Arriagada Lobos', r: 19412065, cargo: 'Ejecutiva de Cuentas', cc: 'com', ct: 'Plazo fijo', since: 'jun 2026', st: 'Activo', av: 'ochre', warn: 'vence 15 dic' },
  { n: 'Joaquín Sepúlveda Mora', r: 18095347, cargo: 'Desarrollador Backend', cc: 'ing', ct: 'Indefinido', since: 'ene 2022', st: 'Activo', av: 'slate' },
  { n: 'Valentina Orellana Díaz', r: 15677902, cargo: 'Líder de Soporte', cc: 'sop', ct: 'Indefinido', since: 'oct 2020', st: 'Licencia médica', av: 'sage' },
  { n: 'Tomás Navarrete Vera', r: 20138561, cargo: 'Analista de Datos', cc: 'pro', ct: 'Plazo fijo', since: 'sep 2026', st: 'Activo', av: 'clay', warn: 'vence 28 feb' },
  { n: 'Antonia Figueroa Salas', r: 14926318, cargo: 'Contadora General', cc: 'adm', ct: 'Indefinido', since: 'feb 2019', st: 'Activo', av: 'sand' },
  { n: 'Sebastián Muñoz Parra', r: 19753204, cargo: 'Ejecutivo de Soporte', cc: 'sop', ct: 'Indefinido', since: 'may 2024', st: 'Vacaciones', av: 'sage' },
  { n: 'Isidora Herrera Campos', r: 18549776, cargo: 'Diseñadora de Producto', cc: 'pro', ct: 'Indefinido', since: 'nov 2022', st: 'Activo', av: 'clay' },
  { n: 'Benjamín Cárdenas Tapia', r: 13408925, cargo: 'Gerente Comercial', cc: 'com', ct: 'Indefinido', since: 'abr 2018', st: 'Activo', av: 'ochre' },
  { n: 'Javiera Pizarro Bravo', r: 17921430, cargo: 'Analista de Personas', cc: 'per', ct: 'Indefinido', since: 'jul 2023', st: 'Activo', av: 'sand' },
  { n: 'Cristóbal Aravena Núñez', r: 16284159, cargo: 'Ingeniero DevOps', cc: 'ing', ct: 'Por obra', since: 'oct 2026', st: 'Finiquito en curso', av: 'slate' },
];
export const initials = (n) => n.split(' ').filter((_, i) => i === 0 || i === 1).map((w) => w[0]).join('');
