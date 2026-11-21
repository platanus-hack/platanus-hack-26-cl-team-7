"""The FreshJuice catalogue: public data, the same on the real shop and its twin."""

from __future__ import annotations

from typing import NamedTuple


class Item(NamedTuple):
    name: str
    description: str
    price_cents: int


CATALOGUE = (
    Item("Apple Juice", "Cold-pressed Fuji apples, nothing added. 1 l bottle.", 199),
    Item("Orange Juice", "Valencia oranges squeezed the same morning. 1 l bottle.", 249),
    Item("Green Smoothie", "Spinach, kiwi, green apple and banana. 500 ml.", 399),
    Item("Carrot Ginger Shot", "Carrot, ginger and a little lemon. 100 ml.", 179),
    Item("Mango Lassi", "Ripe mango blended with natural yoghurt. 400 ml.", 349),
    Item("Lemonade", "Lemons, cane sugar and fresh mint. 1 l bottle.", 229),
    Item("Watermelon Cooler", "Watermelon and lime, best served cold. 500 ml.", 289),
    Item("Beet Boost", "Beetroot, apple and lemon. 330 ml.", 319),
    Item("Pineapple Mint", "Golden pineapple with garden mint. 500 ml.", 299),
    Item("Berry Blast Smoothie", "Strawberry, blueberry and raspberry. 500 ml.", 429),
    Item("Cold Brew Coffee", "Single-origin beans steeped for 18 hours. 330 ml.", 359),
    Item("Coconut Water", "Young coconuts, nothing else. 330 ml.", 259),
    Item("Grapefruit Juice", "Pink grapefruit, gently bitter. 1 l bottle.", 269),
    Item("Peach Iced Tea", "Black tea brewed with white peaches. 500 ml.", 219),
    Item("Tomato Juice", "Ripe tomatoes, celery salt and pepper. 500 ml.", 209),
    Item("Kale Detox", "Kale, cucumber, celery and lemon. 500 ml.", 419),
    Item("Passion Fruit Juice", "Maracuyá from the north, lightly sweetened. 500 ml.", 309),
    Item("Chia Lemon Water", "Lemon water with soaked chia seeds. 500 ml.", 239),
    Item("Cherry Juice", "Sour cherries from the Maule valley. 330 ml.", 389),
    Item("Juice Box Sampler", "Six 330 ml bottles, our pick of the week.", 1499),
    Item("Glass Bottle Set", "Four reusable 500 ml glass bottles with caps.", 1199),
    Item("Gift Card", "A FreshJuice gift card, sent by email.", 2000),
)
