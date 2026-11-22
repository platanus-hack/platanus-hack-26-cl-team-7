"""Business operations shared by the browser and the legitimate-traffic controls."""

from dataclasses import dataclass
from threading import Lock


class InvalidOperation(ValueError):
    pass


@dataclass(frozen=True)
class Field:
    name: str
    label: str
    kind: str = "text"
    options: tuple = ()
    low: int = 1
    high: int = 100_000

    def read(self, data):
        value = data.get(self.name, "").strip()
        if self.options:
            if value not in self.options:
                raise InvalidOperation(f"Elige una opción de {self.label.lower()}.")
        elif self.kind == "number":
            if not value.isascii() or not value.isdecimal() or len(value) > 8:
                raise InvalidOperation(f"{self.label}: ingresa un número entero.")
            value = int(value)
            if not self.low <= value <= self.high:
                raise InvalidOperation(f"{self.label}: usa un valor entre {self.low} y {self.high}.")
        elif not value or len(value) > 80:
            raise InvalidOperation(f"{self.label}: ingresa entre 1 y 80 caracteres.")
        return value


PAPERS = ("Algodón mate", "Couché satinado", "Reciclado natural")
ROUTES = ("Valparaíso → Santiago", "San Antonio → Rancagua", "Santiago → La Serena")
ROOMS = ("Sala Mirador", "Sala Norte")
SLOTS = ("10:00–12:00", "14:00–16:00", "18:00–20:00", "20:00–22:00")
AMOUNT = Field("amount", "Monto en CLP", "number", low=100, high=1_000_000)
FIELDS = {
    "bruma": (Field("title", "Nombre del trabajo"), Field("paper", "Papel", options=PAPERS),
              Field("copies", "Copias", "number", low=10, high=500)),
    "litoral": (Field("route", "Ruta", options=ROUTES), Field("pallets", "Palés", "number", high=24)),
    "surco": (Field("title", "Nombre del grupo"), Field("room", "Sala", options=ROOMS),
              Field("slot", "Horario", options=SLOTS)),
    "bank": (Field("title", "Motivo del reembolso"), AMOUNT),
}
PREFIX = {"bruma": "BR", "litoral": "LF", "surco": "SU", "bank": "BE"}


def demo_form(slug, note, index):
    return {
        "bruma": {"title": note, "paper": PAPERS[index], "copies": "25"},
        "litoral": {"route": ROUTES[index], "pallets": str(index + 1)},
        "surco": {"title": note, "room": ROOMS[0], "slot": SLOTS[index]},
        "bank": {"title": note, "amount": str(5_000 * (index + 1))},
    }[slug]


class Workspace:
    def __init__(self):
        self.lock = Lock()
        self.records = {slug: {} for slug in FIELDS}

    def list(self, slug):
        with self.lock:
            return [row.copy() for row in reversed(list(self.records[slug].values()))]

    def submit(self, slug, data):
        with self.lock:
            book = self.records[slug]
            action = data.get("action", "create")
            if slug == "bank" and action in {"edit", "approve"}:
                return self.update_refund(book, action, data)
            if action != "create":
                raise InvalidOperation("La acción no está disponible.")
            if len(book) >= 100:
                raise InvalidOperation("Se alcanzó el límite de registros de la demo.")
            row = {field.name: field.read(data) for field in FIELDS[slug]}
            if slug == "bruma":
                row["total"] = row["copies"] * (900, 650, 780)[PAPERS.index(row["paper"])]
            elif slug == "litoral":
                row["total"] = (42_000, 51_000, 69_000)[ROUTES.index(row["route"])] + 16_000 * row["pallets"]
            elif slug == "surco" and any(r["slot"] == row["slot"] and r["room"] == row["room"] for r in book.values()):
                raise InvalidOperation("Ese horario ya está reservado para esta sala.")
            elif slug == "bank":
                row.update(version=1, approved_version=None)
            row["id"] = f"{PREFIX[slug]}-{len(book) + 1:04d}"
            book[row["id"]] = row
            return row.copy()

    @staticmethod
    def update_refund(book, action, data):
        row = book.get(data.get("id"))
        if row is None:
            raise InvalidOperation("El reembolso no existe.")
        if data.get("version") != str(row["version"]):
            raise InvalidOperation("La versión cambió. Recarga y revisa el monto vigente.")
        if action == "edit":
            amount = AMOUNT.read(data)
            if amount != row["amount"]:
                row["amount"] = amount
                row["version"] += 1
        else:
            row["approved_version"] = row["version"]
        return row.copy()
