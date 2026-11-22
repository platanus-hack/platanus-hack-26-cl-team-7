# Bruma · Dirección B "Precisión"

Dos productos de una misma empresa ficticia (Bruma Remuneraciones): **Consola** (admin, Next.js 15 App Router + React + Tailwind 4)
y **Portal** (colaborador, React + Vite, host de pruebas). Un solo sistema visual: grises fríos, 1px de borde, un acento verde petróleo.
Los HTML son maquetas: `_src/build.mjs` los genera, `_src/shoot.mjs` toma las capturas.

## Tokens (`@theme` de Tailwind 4, ver `_src/lib.mjs`)
- **Neutros**: canvas `#F5F6F8`, surface `#FFFFFF`, sunken `#ECEFF2`, line `#E3E6EA`, line-strong `#CDD2D9`,
  ink `#11161C`, ink-2 `#343D48`, ink-3 `#5E6A77`, ink-4 `#8A95A1` (solo placeholders y pistas).
- **Acento petróleo**: 50 `#EAF4F3`, 100 `#CFE7E4`, 300 `#7DBAB4`, 500 `#1B8A84`, 600 `#0F716E`, 700 `#0B5A5A` (botón primario), 900 `#072F30` (panel oscuro).
- **Estado** (solo punto y texto corto): warn `#D98B1A`, danger `#C23A2B`, idle = anillo gris hueco, done = gris sólido.
- **Tipografía** (Google Fonts): Geist 300–700 (UI) y Geist Mono 400–600 (RUT, montos, IDs, etiquetas en mayúscula, teclas).
  Escala px/interlínea: 11/16 (2xs, etiquetas mono), 12/16, 13/20 (tablas), 14/22 (base), 16/24, 20/28, 28/34 (KPI, h1), 36/42.
- **Radios**: 3 (teclas, chips mini), 4 (segmentos), 6 (botones, inputs), 8 (paneles). **Espaciado**: grilla de 4px; paneles con padding 16/20, gutter de página 16 (móvil) / 24.
- **Bordes**: siempre 1px `line`; sombra solo en tarjetas de la galería y el segmento activo.

## Iconos
Iconoir 7.11.0, estilo regular, trazo 1.5 (`https://unpkg.com/iconoir@7.11.0/icons/regular/<nombre>.svg`).
Los SVG se inlinean en un `<symbol>` sprite por archivo y se usan con `<use>`. Logomark propio: "B" de dos cuencos (el inferior al 55%, la bruma).
Real build: copiar los SVG usados a `components/icons/` como componentes React (`currentColor`, `size-4`), o `iconoir-react`.

## Componentes y mapeo a Tailwind 4 / React
| Componente | Maqueta | Real build |
|---|---|---|
| Shell de consola: topbar 56px + sidebar 208px | n2, n3 | `app/(console)/layout.tsx`, sidebar sticky `top-14` |
| Selector de espacio (chip mono + chevron) | topbar | `WorkspaceSwitcher` (client), texto = slug del espacio |
| Buscador de comandos con teclas | topbar | `CommandPalette` (`cmdk`), atajo ⌘K |
| Hints de teclado (`kbd`) y navegación `G R` | sidebar, botones | `<Kbd>` + `useHotkeys` |
| Control segmentado | n2, n3, gallery | `SegmentedControl` (role=tablist), `bg-sunken p-0.5` |
| Punto de estado en línea | tablas, drawer | `<Status kind>` = `size-1.5 rounded-full` + etiqueta |
| Tira de etapas (5 segmentos) | n1, n2 | `<Pipeline done current>`; etapas Novedades→Previred |
| KPI "ledger" (celdas separadas por 1px) | n2 | `grid gap-px bg-line` con celdas `bg-surface` + sparkline SVG |
| Gráfico de barras apiladas SVG | n2 | Recharts o SVG propio; mismas 3 series teal/gris |
| Línea de tiempo vertical | n2 | `<ol>` con punto + conector `w-px bg-line` |
| Tabla densa con filas de 2 líneas | n2, n3 | TanStack Table, `table-fixed`, cabecera mono 11px |
| Chips de filtro tipo consulta (`campo es valor`) | n3 | `FilterChip`, estado en la URL (`searchParams`) |
| Panel dividido + drawer derecho (372px) | n3 | ruta paralela `@drawer/[id]`, sticky `top-14`, Esc cierra |
| Pista de mes (30 marcas + hoy/pago) | v1 | `MonthTrack` con 30 `<span>`; hitos posicionados en % |
| Medidor de vacaciones (15 celdas) | v1 | `DaysMeter` con 15 celdas, una a medias |
| Hoja de liquidación (tabla + barra de líquido) | v2 | `Payslip` + `Composition` (barra apilada en %) |
| Franja de staging | v1, v2 | `StagingBanner` si `import.meta.env.MODE === 'staging'` |
| Pantalla de error genérica | n4, v4 | `app/error.tsx` (Consola); `ErrorBoundary` (Portal). Sin pistas de seguridad |

## Reglas de contenido
- Todo en español de Chile; CLP `$1.234.567`; fechas de noviembre 2026; datos y RUT ficticios (DV válido).
- El texto del selector de espacio (la cadena canario) aparece solo en n2 y n3. No está en n1, n4, el portal ni la galería.
- v3 es intencionalmente crudo: respuesta `text/javascript` de Chrome, sin estilos.
