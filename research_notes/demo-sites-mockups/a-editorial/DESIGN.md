# Dirección A · Editorial cálido

Bruma Consola (Next.js 15, App Router) y Bruma Portal (React + Vite). Una sola empresa, un solo sistema.
Idea: papel cálido, tinta negra, un acento verde bosque. Reglas finas y espacio en blanco en lugar de tarjetas;
las tablas se leen como un libro contable. Fuente de las pantallas: `_src/*.mjs` (generador), salida: HTML estático.

## Tokens (`@theme` de Tailwind 4)
| Token | Valor | Uso |
|---|---|---|
| `paper` / `paper-2` / `sheet` | #F3EEE3 / #EAE3D3 / #FBF8F1 | fondo, ítem activo, campos |
| `ink` / `ink-2` / `ink-3` | #16140E / #454036 / #6E685C | texto, texto de apoyo (AA sobre `paper`), etiquetas |
| `rule` / `rule-2` | #D6CCB8 / #E4DCCB | reglas finas 1 px |
| `forest` / `forest-2` / `moss` | #1E4B38 / #2B6549 / #DAE4D3 | único acento, estado OK, chips |
| `ochre` / `ochre-soft` | #A85F12 / #F0DDB2 | pendiente, franja de staging |
| `brick` / `brick-soft` | #9A3626 / #F1D9D0 | observaciones, alerta |
Radios: `xs` 2, `sm` 4 (botones, campos), `md` 8, `lg` 14 (casi no se usa); círculos solo en avatares y chips.
Espaciado: base 4 px; gutters 20 px móvil, 40 px escritorio; secciones separadas por 40-56 px y una regla, no por cajas.
Sin sombras ni degradados. Dobles reglas (`border-top: 3px double`) solo en cabeceras de tabla y cierres de liquidación.

## Tipografía (Google Fonts)
- **Newsreader** (serif, ejes `opsz` 6-72, peso 300-600, cursiva): títulos, cifras grandes. Cifras con `tnum` + `lnum`.
- **Inter Tight** (300-700): interfaz, tablas, etiquetas. `tabular-nums` en toda columna de dinero.
- **JetBrains Mono** (400-500): identificadores (`req_…`, espacio de trabajo, códigos CC-100).
Escala: etiqueta 11 px versalitas +0.09em · cuerpo 15 · tabla 14 · título de bloque 24 serif · título de página 44 serif ·
cifra KPI 36-40 serif · cifra héroe 72-88 serif. Cursiva serif en verde para una palabra por título.

## Iconos
Phosphor Icons 2.1.1, peso **light** (`@phosphor-icons/core/assets/light/<nombre>-light.svg`, MIT). SVG en línea, `fill="currentColor"`,
18 px (24 px en listas de documentos). Usados: house, users, wallet, receipt, bank, coins, buildings, file-text, chart-bar, gear,
lifebuoy, bell, magnifying-glass, caret-*, plus, x, download-simple, printer, airplane-tilt, eye, lock-simple, warning-circle, etc.
Isotipo propio: sol bajo con dos bandas de bruma y una línea de niebla (rect 32x32, r 8, verde; versión invertida sobre verde).

## Componentes y mapeo a Tailwind 4 / React
| Componente | Descripción | En el build real |
|---|---|---|
| `Shell` (Consola) | sidebar 240 px + topbar 60 px sticky, regla inferior | `app/(console)/layout.tsx`, grid `lg:grid-cols-[240px_1fr]` |
| `WorkspaceSwitcher` | botón mono con punto verde y `caret-up-down` | `<DropdownMenu>` (Radix) con clases propias |
| `CommandHint` | campo falso con `⌘K` | abre `<CommandPalette>` (cmdk) |
| `NavItem` | icono + texto; activo = `bg-paper-2 font-medium` | `next/link` + `usePathname()` |
| `KpiStrip` | 4 cifras separadas por reglas verticales, sin tarjetas | `grid` + `border-l`, componente `<Kpi label value note/>` |
| `LineChart` | SVG propio (línea fina, área moss, punto final con anotación) | `visx` o SVG a mano; datos por props |
| `Ledger` (tabla) | cabecera doble regla, filas con regla 1 px, cifras a la derecha | `<table class="ledger">` en `@layer components` |
| `Status` | punto + texto (ok, warn, bad, idle) | `<Status tone="ok">` |
| `Chip` / `Tabs` | filtro con `x`; pestañas con subrayado de 2 px | `<FilterChip>`, `<Tabs>` |
| `Field` | solo línea inferior, foco verde | `<input class="field">` + `react-hook-form` |
| `Button` | primary (tinta), ghost (borde tinta); alto 40 | `cva` con variantes `primary` / `ghost` |
| `StagingBar` (Portal) | franja ochre de 32 px con host y compilación | `import.meta.env.MODE !== 'production'` |
| `Payslip` | dos columnas Haberes / Descuentos, subtotales, cierre en doble regla | `<dl>` semántico, PDF con la misma data |
| `ErrorPage` | titular serif, mensaje genérico, ID de solicitud en mono | `app/error.tsx` (Consola), error boundary (Portal) |
Móvil: sidebar se oculta (botón de menú), tablas pierden columnas secundarias (`hidden md:table-cell`), sin scroll horizontal de página.

## Notas de producción
- Tailwind por CDN solo para el mockup; en el build real usar `@tailwindcss/vite` o PostCSS con el mismo bloque `@theme`.
- El texto del espacio de trabajo aparece únicamente en pantallas protegidas de la Consola (resumen, colaboradores).
- Las pantallas de error no mencionan seguridad ni bloqueo: es el error genérico de cada app.
