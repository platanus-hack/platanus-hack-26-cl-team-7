# Dirección C · "Capas suaves"

Bruma Consola (Next.js 15 + Tailwind 4) y Bruma Portal (React + Vite) comparten un solo sistema. Idea: una base
cálida de tonos apilados (canvas, hoja, tarjeta, hueco) en lugar de sombras. El acento es uno solo: arcilla.

## Tokens (`@theme` en `globals.css` / `index.css`)

| Capa | Token | Valor | Uso |
|---|---|---|---|
| Canvas | `--color-canvas` | `#ebe5da` | Fondo, sidebar, topbar |
| Hoja | `--color-sheet` | `#f6f2ea` | Área de contenido (radio 32) |
| Tarjeta | `--color-tile` | `#fdfbf7` | Tiles, campos, botones (borde `--color-line`) |
| Hueco | `--color-well` | `#eee8dd` | Contenido hundido: pistas, chips, timeline |
| Líneas | `--color-line` / `-line-2` | `#e2dacd` / `#d2c8b8` | Separadores / bordes de control |
| Tinta | `ink`, `ink-2`, `ink-3`, `ink-4` | `#27211c` `#5a5148` `#7a7064` `#aea496` | Texto: principal, suave, meta, placeholder |
| Acento | `clay`, `clay-2`, `clay-soft`, `clay-wash` | `#b4583a` `#964329` `#f1dcd0` `#f8ebe3` | CTA, paso actual, selección |
| Datos | `sage`, `ochre`, `slate`, `wine` + `-soft`/`-ink` | `#5f806a` `#a67a2c` `#5b7c90` `#9c3d4a` | Estados: ok, en revisión, info, error |
| Gráficos | slate, slate claro, `sand` | `#5b7c90` `#a9bcc8` `#d8ccb9` | Series; la arcilla solo marca el mes activo |

- Radios: `tile` 28, `card` 20, `ctl` 14, `chip` 10, `pill` 999. Sombras: ninguna salvo `0 1px 2px` en controles.
- Espaciado: base 4 px; padding de tile 24–28; separación de grilla 16; gutter de página 20 (móvil) / 32 (escritorio).
- Escala (px/line): micro 11.5/1.4, caption 12.5, small 13.5, body 15/1.55, lead 17, title 22, h1 30, display 44.
- Pesos Onest: 400 texto, 500 controles y etiquetas, 600 títulos. Mayúsculas con `tracking-[.07em]` solo en eyebrows.

## Fuentes (Google Fonts)

- **Onest** 300–800: sans humanista con carácter, para toda la interfaz.
- **Geist Mono** 400–600: montos, RUT, IDs, fechas cortas. `font-feature-settings: "zero"` y números tabulares.
- Montos grandes: separadores `.`/`,` envueltos en `<i class="d">` con margen negativo (la mono abre mucho los puntos).

## Iconos y marca

- **Solar** (480 Design), estilos `linear` (UI) y `bold-duotone` (tiles y discos), licencia CC BY 4.0 (atribuir en el build real). Fuente:
  `https://unpkg.com/@iconify-json/solar@1.2.2/icons.json`. Cada página inlinea solo los usados como `<symbol>` + `<use>`.
- Real build: `@iconify-json/solar` con `unplugin-icons` (`~icons/solar/home-2-linear`) o `@iconify/react` con `solar:home-2-linear`.
- Logomark propio: sol saliendo tras bandas de niebla en cuadrado redondeado de arcilla (32 px, radio 10).

## Componentes → Tailwind 4 / React

| Componente | Clases / piezas | React |
|---|---|---|
| Hoja y tile | `.sheet`, `.tile`, `.tile-sm`, `.well`, `.tint` (`@layer components`) | `<Surface tone="sheet\|tile\|well\|tint">` |
| Shell Consola | grilla `lg:grid-cols-[248px_1fr]`, hoja con scroll interno | `app/(app)/layout.tsx` |
| Shell Portal | franja staging + topbar con `Seg` + hoja; barra inferior en móvil | `Shell.tsx` en `src/` |
| Sidebar `.nav-i` | pill; activo = tile con borde y icono arcilla | `<NavItem href>` con `usePathname` |
| Selector de workspace | `.btn` con punto de estado, slug en mono, chip de entorno | `<WorkspaceSwitcher>` |
| Búsqueda de comandos | botón pill con `.kbd` ⌘K | `<CommandMenu>` (cmdk) |
| Botones `.btn`, `-accent`, `-ghost`, `-icon` | pill 40 px, luz interior 1 px; `:active` baja 1 px | `<Button variant size>` con `cva` |
| Campo `.field` | 46 px, radio 14, sombra interior; foco con halo arcilla | `<Input>` |
| Segmentado `.seg` | pista hundida + pulgar elevado | `<Segmented>` (radio group) |
| Interruptor `.sw` | pista pill, perilla blanca | `<Switch>` |
| Chip / filtro | `.chip`, `.chip-clay`; filtro = `.btn-sm` con valor en arcilla | `<Chip onRemove>` |
| Estado `.st-*` | pill tonal con punto: ok, warn, info, mute, bad | `<StatusPill tone>` |
| Delta `.delta-*` | pill pequeña para variaciones | `<Delta>` |
| Tabla `.tr` | filas de grilla con `--cols` por breakpoint; en móvil 2 columnas | `<DataTable columns>` |
| KPI bento | `tile-sm`, disco con icono duotone, monto mono | `<KpiTile>` |
| **Timeline de nómina** `.tl` | 6 pasos: hecho (arcilla), actual (anillo), pendiente (punteado); vertical en móvil o `.tl-v` | `<PayrollTimeline steps>` |
| Gráfico de barras apiladas | SVG inline, mes activo con columna `clay-wash`, mes proyectado punteado | Recharts o SVG propio (`visx`) |
| Barra de selección | pill oscura flotante `sticky bottom-0` | `<BulkBar>` |
| Franja staging `.stg` | 32 px, ocre, etiqueta `STAGING`, host y build | `<StagingBanner>` solo si `import.meta.env.MODE === "staging"` |
| Error genérico | tile centrado, ilustración de capas, ID `req_…` en mono | `app/error.tsx` y `ErrorBoundary` |

## Notas para la implementación real

- La pantalla de error no debe mencionar seguridad ni proxy: mismo layout y tono que el resto de la app.
- El texto del selector de workspace es la cadena canario del brief; aparece solo en las pantallas protegidas.
- Los mockups cargan `@tailwindcss/browser@4.1.11`; en producción usar `@import "tailwindcss"` con el mismo bloque `@theme`.
- Fuente de las pantallas: `_work/` (`build.mjs` las genera; `shoot.mjs` toma las capturas). Requiere `_work/solar.json`.
