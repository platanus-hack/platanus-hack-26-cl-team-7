"""Server-rendered customer interfaces, backed by the workspace operations."""

from html import escape

from targets.businesses.workflows import FIELDS, ROOMS, SLOTS, Field


PRODUCT = {
    "bruma": ("Emite una liquidación", "Elige el tipo de contrato y calcula el sueldo del mes.", "Guardar liquidación", "Liquidaciones de sueldo"),
    "litoral": ("Cotiza un despacho", "Selecciona el corredor y calcula el costo estimado.", "Cotizar envío", "Cotizaciones"),
    "surco": ("Reserva tu ensayo", "Elige una sala y un bloque de dos horas.", "Reservar sala", "Reservas"),
    "bank": ("Reembolsos", "Registra una solicitud y revisa qué versión está aprobada.", "Crear solicitud", "Solicitudes"),
}


def page(title, slug, main):
    return f'''<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title>
<link rel="stylesheet" href="/workspaces.css"></head><body class="{slug}">{main}</body></html>'''


def directory(businesses):
    cards = "".join(f'''<a class="directory-card {b.slug}" href="/{b.slug}/">
<span>{escape(b.sector)}</span><strong>{escape(b.name)}</strong><div>{escape(PRODUCT[b.slug][1])}</div>
<span class="open">Abrir servicio <span aria-hidden="true">↗</span></span></a>''' for b in businesses)
    return page("Servicios de prueba", "directory", f'''<main class="frame">
<header class="directory-heading"><p>Último Paso</p><h1>Servicios de prueba</h1>
<p>Completa una operación en cualquiera de los cuatro proyectos. Los datos de estas aplicaciones son ficticios.</p></header>
<div class="directory-grid">{cards}</div></main>''')


def field(f: Field, default=""):
    default = str(default)
    if f.options:
        options = "".join(f'<option{" selected" if option == default else ""}>{escape(option)}</option>' for option in f.options)
        control = f'<select name="{f.name}">{options}</select>'
    elif f.kind == "number":
        control = f'<input name="{f.name}" type="number" min="{f.low}" max="{f.high}" step="1" value="{escape(default)}" required>'
    else:
        control = f'<input name="{f.name}" maxlength="80" value="{escape(default)}" required>'
    return f'<label>{escape(f.label)}{control}</label>'


def pesos(amount):
    return "$" + f"{amount:,}".replace(",", ".") + " CLP"


def bank_actions(row):
    hidden = f'<input type="hidden" name="id" value="{row["id"]}"><input type="hidden" name="version" value="{row["version"]}">'
    return f'''<details><summary>Gestionar {row["id"]}</summary><div class="bank-actions">
<form method="post" action="/bank/workspace">{hidden}{field(FIELDS["bank"][1], row["amount"])}
<button name="action" value="edit">Guardar monto</button></form>
<form method="post" action="/bank/workspace">{hidden}<button name="action" value="approve">Aprobar versión {row["version"]}</button></form>
</div></details>'''


def row_content(slug, row):
    if slug == "bruma":
        return escape(row["title"]), f'{escape(row["paper"])} · {row["copies"]} días', pesos(row["total"]), ""
    if slug == "litoral":
        return escape(row["route"]), f'{row["pallets"]} palés · Estimación', pesos(row["total"]), ""
    if slug == "surco":
        return escape(row["title"]), f'{escape(row["room"])} · {escape(row["slot"])}', "Reservada", ""
    approved = row["approved_version"]
    state = "Elegible" if approved == row["version"] else "Pendiente de aprobación"
    return escape(row["title"]), f'Versión {row["version"]} · Aprobada {approved or "ninguna"} · {pesos(row["amount"])}', state, bank_actions(row)


def summary(slug, rows):
    if slug != "surco":
        return ""
    used = {(row["room"], row["slot"]) for row in rows}
    return '<section class="schedule"><h2>Disponibilidad</h2>' + "".join(
        f'<div><strong>{escape(room)}</strong><ul>' + "".join(
            f'<li class="{"busy" if (room, slot) in used else "free"}">{escape(slot)}<small>{"Reservado" if (room, slot) in used else "Libre"}</small></li>'
            for slot in SLOTS
        ) + '</ul></div>' for room in ROOMS
    ) + '</section>'


def render_workspace(b, rows, notice="", error=False, submitted=None):
    heading, intro, button, ledger = PRODUCT[b.slug]
    submitted = submitted or {}
    form = "".join(field(f, submitted.get(f.name, "")) for f in FIELDS[b.slug])
    cards = []
    for row in rows:
        title, subtitle, value, actions = row_content(b.slug, row)
        cards.append(f'<li><div class="record"><div><code>{row["id"]}</code><strong>{title}</strong><span>{subtitle}</span></div><b>{value}</b></div>{actions}</li>')
    listing = '<ul class="ledger-list">' + "".join(cards) + '</ul>' if cards else '<p class="empty">Todavía no hay registros.</p>'
    alert = f'<p class="notice {"error" if error else "success"}" role="{"alert" if error else "status"}">{escape(notice)}</p>' if notice else ""
    return page(b.name, b.slug, f'''<nav class="service-nav"><a href="/">Servicios</a><span>{escape(b.sector)}</span></nav>
<header class="hero"><div class="frame"><p>{escape(b.name)}</p><h1>{heading}</h1><p>{intro}</p></div></header>
<main class="frame workspace">{alert}{summary(b.slug, rows)}<div class="columns">
<section class="panel"><h2>{heading if b.slug != "bank" else "Nueva solicitud"}</h2>
<form method="post" action="/{b.slug}/workspace">{form}<button>{button}</button></form></section>
<section class="panel"><h2>{ledger}</h2>{listing}</section></div></main>
<footer class="frame">Entorno de prueba · Datos ficticios · Las operaciones no cobran ni envían dinero.</footer>''')
