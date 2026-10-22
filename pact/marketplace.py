"""Small, local PACT Marketplace catalog.

The catalog is intentionally independent from Amazon.com.  It gives the
assistant stable product metadata to propose while PACT remains the only
authority for authorization and payment execution.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from .product_discovery import LAPTOPS, get_product as discovery_product


PRODUCTS: tuple[dict[str, Any], ...] = (
    {
        "product_id": "pact-headphones-18",
        "merchant": "PACT Marketplace",
        "title": "CloudTone wireless headphones",
        "description": "Simulated noise-aware headphones for music and study.",
        "category": "electronics",
        "merchant_type": "marketplace",
        "amount_cents": 1800,
        "currency": "USD",
        "availability": "simulated",
    },
    {
        "product_id": "pact-groceries-15",
        "merchant": "PACT Marketplace",
        "title": "Family grocery basket",
        "description": "A simulated weekly grocery basket for the household.",
        "category": "groceries",
        "merchant_type": "marketplace",
        "amount_cents": 1500,
        "currency": "USD",
        "availability": "simulated",
    },
    {
        "product_id": "pact-game-22",
        "merchant": "PACT Marketplace",
        "title": "Galaxy Quest game credit",
        "description": "A simulated gaming purchase used for policy demos.",
        "category": "gaming",
        "merchant_type": "marketplace",
        "amount_cents": 2200,
        "currency": "USD",
        "availability": "simulated",
    },
    {
        "product_id": "pact-birthday-gift-40",
        "merchant": "GiftCart",
        "title": "Maya birthday decoration set",
        "description": "Simulated party decorations for the Maya birthday plan.",
        "category": "entertainment",
        "merchant_type": "gift",
        "amount_cents": 4000,
        "currency": "USD",
        "availability": "simulated",
    },
)


def get_product(product_id: str) -> dict[str, Any] | None:
    for product in PRODUCTS:
        if product["product_id"] == str(product_id):
            return copy.deepcopy(product)
    return discovery_product(product_id)


def search_catalog(query: str = "", category: str = "", limit: int = 6) -> list[dict[str, Any]]:
    terms = {term for term in re.findall(r"[a-z0-9]+", str(query).lower()) if term}
    category_text = str(category or "").strip().lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    all_products = list(PRODUCTS) + list(LAPTOPS)
    for product in all_products:
        if category_text and product["category"] != category_text:
            continue
        haystack = " ".join(str(product.get(field, "")).lower() for field in ("title", "description", "category", "merchant", "brand"))
        score = sum(1 for term in terms if term in haystack)
        if not terms or score:
            scored.append((score, product))
    scored.sort(key=lambda pair: (-pair[0], pair[1]["product_id"]))
    return [copy.deepcopy(product) for _, product in scored[: max(1, min(int(limit), 20))]]


def product_matches_action(product: dict[str, Any], action: dict[str, Any]) -> bool:
    """Verify the signed action still describes the selected product."""
    expected_merchant = product.get("merchant", "PACT Sandbox Catalog")
    expected_type = product.get("merchant_type", "catalog")
    expected_provider = product.get("provider", "")
    compatible = all(
        str(action.get(field, "")).lower() == str(expected).lower()
        for field, expected in (("merchant", expected_merchant), ("category", product["category"]), ("merchant_type", expected_type), ("currency", product["currency"]))
    )
    quantity = int(action.get("quantity", 1) or 1)
    unit_price = int(product.get("amount_cents", product.get("price_cents", -1)))
    if not compatible or int(action.get("amount_cents") or -1) != unit_price * quantity:
        return False
    if action.get("catalog_provider") and expected_provider and str(action.get("catalog_provider")).lower() != str(expected_provider).lower():
        return False
    if action.get("product_revision") and str(action.get("product_revision")) != str(product.get("product_revision", "")):
        return False
    shipping = str(action.get("shipping_option", "standard"))
    if shipping and shipping not in set(product.get("shipping_options", ["standard"])):
        return False
    return quantity > 0
