"""Deterministic, realistic people for the seed (real side) and the mask (twin side).

Draws come from sha256 over a key, not from `random`, so the same key gives the same person on
every run and every machine, and nothing here is a source of secrets. The seed and the mask use
different keys, so a masked person is never computed from a real one.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass

FIRST_NAMES = (
    "Sofía", "Mateo", "Valentina", "Benjamín", "Isidora", "Vicente", "Florencia", "Martín",
    "Antonia", "Tomás", "Catalina", "Joaquín", "Emilia", "Agustín", "Josefa", "Lucas", "Amanda",
    "Maximiliano", "Fernanda", "Diego", "Camila", "Sebastián", "Javiera", "Ignacio", "Constanza",
    "Felipe", "Daniela", "Nicolás", "Paula", "Gabriel", "Laura", "Andrés", "Elena", "Pablo",
    "Marta", "Hugo", "Julia", "Daniel", "Clara", "Samuel", "Olivia", "Leo", "Mia", "Noah", "Emma",
    "Lena", "Ana", "Carlos", "Rosa",
)
LAST_NAMES = (
    "González", "Muñoz", "Rojas", "Díaz", "Pérez", "Soto", "Contreras", "Silva", "Martínez",
    "Sepúlveda", "Morales", "Rodríguez", "López", "Fuentes", "Hernández", "Torres", "Araya",
    "Flores", "Espinoza", "Valenzuela", "Castillo", "Tapia", "Reyes", "Gutiérrez", "Castro",
    "Pizarro", "Álvarez", "Vásquez", "Sánchez", "Fernández", "Ramírez", "Carrasco", "Gómez",
    "Cortés", "Herrera", "Núñez", "Jara", "Vergara", "Rivera", "Figueroa", "Smith", "Müller",
    "Rossi", "Novak", "Kowalski", "Dubois",
)
STREETS = (
    "Avenida Providencia", "Calle Los Leones", "Avenida Italia", "Calle Merced", "Avenida Grecia",
    "Calle Bandera", "Avenida Matta", "Calle Huérfanos", "Pasaje Las Rosas", "Avenida Irarrázaval",
    "Calle Agustinas", "Avenida Brasil", "Calle Condell", "Avenida Pedro de Valdivia",
    "Calle Lastarria", "Calle Monjitas", "Avenida Vicuña Mackenna", "Calle Rosal",
    "Avenida Los Pajaritos", "Calle Toesca",
)
CITIES = (
    "Santiago", "Valparaíso", "Viña del Mar", "Concepción", "La Serena", "Antofagasta", "Temuco",
    "Rancagua", "Talca", "Puerto Montt", "Iquique", "Arica", "Chillán", "Valdivia", "Osorno",
    "Punta Arenas", "Coquimbo", "Calama",
)
EMAIL_DOMAINS = ("gmail.com", "outlook.com", "yahoo.com", "icloud.com", "hotmail.com", "proton.me")
PHONE_PREFIX = "+56 9"
DIGEST_BYTES = 8
MAX_HOUSE_NUMBER = 3999
FLOORS = 24
UNITS_PER_FLOOR = 8
FLAT_SHARE = 4  # one address in four is a flat
NAME_SUFFIX_SPAN = 100
PHONE_SPAN = 10**8
MAX_ATTEMPTS = 1000


class Draw:
    """A deterministic source of choices for one key (for example the seed and a user id)."""

    def __init__(self, *key: object) -> None:
        self._key = "\x1f".join(str(part) for part in key)

    def number(self, label: str, span: int) -> int:
        digest = hashlib.sha256(f"{self._key}\x1e{label}".encode()).digest()
        return int.from_bytes(digest[:DIGEST_BYTES], "big") % span

    def pick[T](self, label: str, options: Sequence[T]) -> T:
        return options[self.number(label, len(options))]

    def child(self, *key: object) -> Draw:
        return Draw(self._key, *key)


@dataclass(frozen=True)
class Person:
    name: str
    username: str
    email: str
    phone: str
    address: str

    def field(self, kind: str) -> str:
        if kind not in PERSON_FIELDS:
            raise ValueError(f"unknown person field {kind!r}")
        return str(getattr(self, kind))


PERSON_FIELDS = ("name", "username", "email", "phone", "address")


def ascii_fold(text: str) -> str:
    table = str.maketrans("áéíóúñüÁÉÍÓÚÑÜ", "aeiounuAEIOUNU")
    return text.translate(table).lower().replace(" ", "")


def person(draw: Draw) -> Person:
    first, last = draw.pick("first", FIRST_NAMES), draw.pick("last", LAST_NAMES)
    handle = f"{ascii_fold(first)}.{ascii_fold(last)}{draw.number('suffix', NAME_SUFFIX_SPAN)}"
    phone = f"{draw.number('phone', PHONE_SPAN):08d}"
    return Person(
        name=f"{first} {last}",
        username=handle,
        email=f"{handle}@{draw.pick('domain', EMAIL_DOMAINS)}",
        phone=f"{PHONE_PREFIX} {phone[:4]} {phone[4:]}",
        address=address(draw),
    )


def address(draw: Draw) -> str:
    street = f"{draw.pick('street', STREETS)} {1 + draw.number('house', MAX_HOUSE_NUMBER)}"
    if draw.number("has_flat", FLAT_SHARE) == 0:
        floor, unit = 1 + draw.number("floor", FLOORS), 1 + draw.number("unit", UNITS_PER_FLOOR)
        street += f", depto {floor}{unit:02d}"
    return f"{street}, {draw.pick('city', CITIES)}"


def first_person(draw: Draw, rejects: Callable[[Person], bool]) -> Person:
    """The first person drawn for this key that `rejects` lets through."""
    for attempt in range(MAX_ATTEMPTS):
        candidate = person(draw.child(attempt))
        if not rejects(candidate):
            return candidate
    raise ValueError(f"no acceptable person in {MAX_ATTEMPTS} draws")
