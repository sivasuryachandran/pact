"""Deterministic product discovery for the PACT sandbox catalog.

The catalog boundary is deliberately provider-neutral.  The mock provider is
the only provider used by the local demo; the optional Creators API provider
reports unavailable until a separately configured adapter is supplied.  No
retail prices, reviews, or availability are inferred by an LLM.
"""

from __future__ import annotations

import copy
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol


class ProductQueryError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _money(value: str) -> int:
    return int(round(float(value.replace(",", "")) * 100))


@dataclass(frozen=True)
class ProductQuery:
    raw_text: str
    category: str = "laptop"
    currency: str = "USD"
    budget_max_cents: int | None = None
    budget_min_cents: int | None = None
    brand: str | None = None
    operating_system: str | None = None
    cpu: str | None = None
    gpu: str | None = None
    ram_gb_min: int | None = None
    storage_gb_min: int | None = None
    screen_inches_min: float | None = None
    weight_lbs_max: float | None = None
    battery_hours_min: int | None = None
    use_case: str | None = None
    availability: str | None = None
    hard_constraints: dict[str, Any] = field(default_factory=dict)
    soft_constraints: dict[str, Any] = field(default_factory=dict)
    unknown_constraints: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "category": self.category,
            "currency": self.currency,
            "budget_max_cents": self.budget_max_cents,
            "budget_min_cents": self.budget_min_cents,
            "brand": self.brand,
            "operating_system": self.operating_system,
            "cpu": self.cpu,
            "gpu": self.gpu,
            "ram_gb_min": self.ram_gb_min,
            "storage_gb_min": self.storage_gb_min,
            "screen_inches_min": self.screen_inches_min,
            "weight_lbs_max": self.weight_lbs_max,
            "battery_hours_min": self.battery_hours_min,
            "use_case": self.use_case,
            "availability": self.availability,
            "hard_constraints": copy.deepcopy(self.hard_constraints),
            "soft_constraints": copy.deepcopy(self.soft_constraints),
            "unknown_constraints": list(self.unknown_constraints),
            "contradictions": list(self.contradictions),
        }


def parse_product_query(text: str, structured: dict[str, Any] | None = None) -> ProductQuery:
    """Extract only a small, auditable query grammar from text.

    A future Bedrock/Creators adapter may propose ``structured`` values, but
    this parser still validates units, ranges, and contradictions before they
    reach the catalog or policy engine.
    """
    raw = " ".join(str(text or "").split())
    lower = raw.lower()
    values: dict[str, Any] = {"raw_text": raw}
    if structured:
        for key in ("category", "brand", "operating_system", "cpu", "gpu", "use_case", "availability", "currency"):
            if structured.get(key) not in (None, ""):
                values[key] = str(structured[key]).strip().lower()
        for key in ("budget_max_cents", "budget_min_cents", "ram_gb_min", "storage_gb_min", "battery_hours_min"):
            if structured.get(key) is not None:
                values[key] = int(structured[key])

    budget_max = re.search(r"(?:under|below|less than|up to|within|max(?:imum)?(?: of)?)\s*\$?([\d,]+(?:\.\d{1,2})?)", lower)
    budget_min = re.search(r"(?:at least|over|above|more than|min(?:imum)?(?: of)?)\s*\$?([\d,]+(?:\.\d{1,2})?)", lower)
    if budget_max:
        values["budget_max_cents"] = _money(budget_max.group(1))
    if budget_min:
        values["budget_min_cents"] = _money(budget_min.group(1))

    ram = re.search(r"(?:at least|minimum|with|and)\s*(\d+)\s*gb\s*(?:of\s*)?(?:ram|memory)", lower)
    if not ram:
        ram = re.search(r"(\d+)\s*gb\s*(?:ram|memory)", lower)
    storage = re.search(r"(?:at least|minimum|with|and)?\s*(\d+)\s*(tb|gb)\s*(?:ssd|storage|drive)", lower)
    weight = re.search(r"(?:under|less than|below|lightweight(?: under)?)\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)", lower)
    screen = re.search(r"(?:at least|minimum|with)?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches)[\s-]*(?:screen|display)?", lower)
    battery = re.search(r"(?:at least|minimum|battery(?: life)?(?: of)?)\s*(\d+)\s*(?:hours?|hr)", lower)
    cpu = re.search(r"\b(core\s+ultra\s*[3579]|core\s+i[3579]|ryzen\s*[3579]|apple\s+m[123])\b", lower)
    gpu = re.search(r"\b(rtx\s*\d{3,4}|radeon|integrated(?:\s+graphics)?)\b", lower)
    if ram:
        values["ram_gb_min"] = int(ram.group(1))
    if storage:
        values["storage_gb_min"] = int(storage.group(1)) * (1024 if storage.group(2) == "tb" else 1)
    if weight:
        values["weight_lbs_max"] = float(weight.group(1))
    if screen:
        values["screen_inches_min"] = float(screen.group(1))
    if battery:
        values["battery_hours_min"] = int(battery.group(1))
    if cpu:
        values["cpu"] = re.sub(r"\s+", " ", cpu.group(1)).strip()
    if gpu:
        values["gpu"] = re.sub(r"\s+", " ", gpu.group(1)).strip()

    for brand in ("lenovo", "dell", "hp", "apple", "asus", "acer"):
        if brand in lower:
            values["brand"] = brand
            break
    if "mac" in lower or "macos" in lower:
        values["operating_system"] = "macos"
    elif "windows" in lower or "win 11" in lower:
        values["operating_system"] = "windows"
    if any(term in lower for term in ("gaming", "games", "game")):
        values["use_case"] = "gaming"
    elif any(term in lower for term in ("school", "study", "student")):
        values["use_case"] = "school"
    elif any(term in lower for term in ("work", "business", "office")):
        values["use_case"] = "work"
    if "in stock" in lower or "available now" in lower:
        values["availability"] = "in_stock"

    soft: dict[str, Any] = {}
    for phrase, key in (("prefer", "preference"), ("ideally", "ideal"), ("would like", "preference"), ("nice to have", "nice_to_have")):
        if phrase in lower:
            soft[key] = True
    unknown: list[str] = []
    if "touchscreen" in lower:
        unknown.append("touchscreen")
    if "quiet" in lower:
        unknown.append("quiet acoustics")
    hard: dict[str, Any] = {}
    for key in ("budget_max_cents", "budget_min_cents", "brand", "operating_system", "cpu", "gpu", "ram_gb_min", "storage_gb_min", "weight_lbs_max", "screen_inches_min", "battery_hours_min", "availability"):
        if values.get(key) is not None:
            hard[key] = values[key]
    contradictions: list[str] = []
    if values.get("budget_min_cents") is not None and values.get("budget_max_cents") is not None and values["budget_min_cents"] > values["budget_max_cents"]:
        contradictions.append("minimum budget is greater than maximum budget")
    if values.get("ram_gb_min", 0) < 0 or values.get("storage_gb_min", 0) < 0:
        contradictions.append("memory and storage cannot be negative")
    values.update({"category": "laptop", "hard_constraints": hard, "soft_constraints": soft, "unknown_constraints": unknown, "contradictions": contradictions})
    return ProductQuery(**values)


def _product(
    product_id: str,
    title: str,
    brand: str,
    price_cents: int,
    revision: str,
    *,
    ram: int,
    storage: int,
    screen: float,
    weight: float,
    battery: int,
    operating_system: str,
    cpu: str,
    gpu: str,
    use_cases: tuple[str, ...],
    availability: str,
    rating: float | None,
    review_count: int | None,
    review_summary: str | None,
) -> dict[str, Any]:
    return {
        "product_id": product_id,
        "provider": "pact_sandbox",
        "provider_product_id": product_id,
        "merchant": "PACT Sandbox Catalog",
        "merchant_type": "catalog",
        "title": title,
        "description": f"Simulated {brand} laptop for {', '.join(use_cases)}.",
        "category": "laptop",
        "brand": brand,
        "specifications": {"ram_gb": ram, "storage_gb": storage, "screen_inches": screen, "weight_lbs": weight, "battery_hours": battery, "operating_system": operating_system, "cpu": cpu, "gpu": gpu, "use_cases": list(use_cases)},
        "price_cents": price_cents,
        "amount_cents": price_cents,
        "currency": "USD",
        "availability": availability,
        "stock_status": availability,
        "rating": rating,
        "review_count": review_count,
        "review_summary": review_summary,
        "review_text": None,
        "warranty": "Simulated one-year limited warranty",
        "shipping_options": ["standard", "expedited"],
        "source_url": None,
        "retrieved_at": _now(),
        "product_revision": revision,
        "simulated": True,
        "evidence": {"provider": "PACT Sandbox Catalog", "retrieved_at": _now(), "source": "local fixture", "availability_simulated": True, "review_text_supplied": False},
    }


LAPTOPS: tuple[dict[str, Any], ...] = (
    _product("pact-laptop-lenovo-14", "Lenovo-style ThinkPad 14", "lenovo", 129900, "lenovo-14-r3", ram=16, storage=512, screen=14, weight=3.3, battery=12, operating_system="windows", cpu="Core Ultra 5", gpu="integrated", use_cases=("work", "school"), availability="in_stock", rating=4.5, review_count=1240, review_summary="Provider-supplied summary: dependable keyboard and long battery life."),
    _product("pact-laptop-dell-15", "Dell-style Latitude 15", "dell", 109900, "dell-15-r2", ram=16, storage=512, screen=15.6, weight=3.8, battery=10, operating_system="windows", cpu="Core Ultra 5", gpu="integrated", use_cases=("work", "school"), availability="in_stock", rating=4.3, review_count=870, review_summary="Provider-supplied summary: practical performance for everyday work."),
    _product("pact-laptop-hp-14", "HP-style Pavilion 14", "hp", 89900, "hp-14-r4", ram=16, storage=512, screen=14, weight=3.4, battery=9, operating_system="windows", cpu="Ryzen 7", gpu="integrated", use_cases=("school", "work"), availability="in_stock", rating=4.2, review_count=512, review_summary=None),
    _product("pact-laptop-asus-gaming", "ASUS-style Creator 15", "asus", 149900, "asus-15-r1", ram=32, storage=1024, screen=15.6, weight=4.4, battery=8, operating_system="windows", cpu="Ryzen 7", gpu="RTX 4060", use_cases=("gaming", "work"), availability="in_stock", rating=4.6, review_count=301, review_summary="Provider-supplied summary: strong graphics performance for the price."),
    _product("pact-laptop-apple-air", "Apple-style Air 13", "apple", 119900, "apple-air-r2", ram=16, storage=512, screen=13.6, weight=2.7, battery=15, operating_system="macos", cpu="M3", gpu="integrated", use_cases=("work", "school"), availability="unknown", rating=4.7, review_count=2100, review_summary="Provider-supplied summary: quiet, light, and long lasting."),
    _product("pact-laptop-acer-15", "Acer-style Aspire 15", "acer", 69900, "acer-15-r1", ram=8, storage=256, screen=15.6, weight=4.0, battery=8, operating_system="windows", cpu="Core i5", gpu="integrated", use_cases=("school"), availability="out_of_stock", rating=None, review_count=None, review_summary=None),
)


class CatalogProvider(Protocol):
    name: str

    def status(self) -> dict[str, Any]: ...

    def products(self) -> list[dict[str, Any]]: ...


class MockCatalogProvider:
    name = "pact_sandbox"

    def status(self) -> dict[str, Any]:
        try:
            max_results = max(1, min(int(os.getenv("PRODUCT_CATALOG_MAX_RESULTS", "20")), 20))
        except ValueError:
            max_results = 20
        return {"name": self.name, "available": True, "simulated": True, "label": "PACT Sandbox Catalog", "region": os.getenv("PRODUCT_CATALOG_REGION", "US"), "max_results": max_results}

    def products(self) -> list[dict[str, Any]]:
        return copy.deepcopy(list(LAPTOPS))


class CreatorsApiProvider:
    name = "amazon_creators"

    def status(self) -> dict[str, Any]:
        return {"name": self.name, "available": False, "simulated": False, "region": os.getenv("PRODUCT_CATALOG_REGION", "US"), "reason": "Amazon Creators API adapter is not configured or verified"}

    def products(self) -> list[dict[str, Any]]:
        return []


def catalog_provider() -> CatalogProvider:
    selected = os.getenv("PRODUCT_CATALOG_PROVIDER", "mock").strip().lower()
    if selected in {"creators", "amazon_creators"}:
        return CreatorsApiProvider()
    return MockCatalogProvider()


def provider_status() -> dict[str, Any]:
    return catalog_provider().status()


def _evidence(product: dict[str, Any]) -> dict[str, Any]:
    value = copy.deepcopy(product.get("evidence") or {})
    value.update({"price_cents": product.get("price_cents", product.get("amount_cents")), "currency": product.get("currency"), "availability": product.get("availability"), "rating": product.get("rating"), "review_count": product.get("review_count"), "review_summary": product.get("review_summary"), "provider": product.get("provider"), "retrieved_at": product.get("retrieved_at"), "source_url": product.get("source_url")})
    return value


def _meets(product: dict[str, Any], query: ProductQuery) -> tuple[bool, list[str], list[str], list[str]]:
    specs = product.get("specifications", {})
    matched: list[str] = []
    unmet: list[str] = []
    unknown: list[str] = []
    checks = {
        "budget_max_cents": product.get("price_cents", product.get("amount_cents")) <= query.budget_max_cents if query.budget_max_cents is not None else None,
        "budget_min_cents": product.get("price_cents", product.get("amount_cents")) >= query.budget_min_cents if query.budget_min_cents is not None else None,
        "brand": str(product.get("brand", "")).lower() == str(query.brand).lower() if query.brand else None,
        "operating_system": specs.get("operating_system") == query.operating_system if query.operating_system else None,
        "cpu": str(query.cpu).lower() in str(specs.get("cpu", "")).lower() if query.cpu else None,
        "gpu": str(query.gpu).lower() in str(specs.get("gpu", "")).lower() if query.gpu else None,
        "ram_gb_min": specs.get("ram_gb") >= query.ram_gb_min if query.ram_gb_min is not None else None,
        "storage_gb_min": specs.get("storage_gb") >= query.storage_gb_min if query.storage_gb_min is not None else None,
        "screen_inches_min": specs.get("screen_inches") >= query.screen_inches_min if query.screen_inches_min is not None else None,
        "weight_lbs_max": specs.get("weight_lbs") <= query.weight_lbs_max if query.weight_lbs_max is not None else None,
        "battery_hours_min": specs.get("battery_hours") >= query.battery_hours_min if query.battery_hours_min is not None else None,
        "availability": product.get("availability") == query.availability if query.availability else None,
    }
    for key, result in checks.items():
        if result is None:
            continue
        if result:
            matched.append(key)
        else:
            unmet.append(key)
    if query.availability == "in_stock" and product.get("availability") == "unknown":
        unknown.append("availability")
    return not unmet and not unknown and not query.contradictions, matched, unmet, unknown


def _result(product: dict[str, Any], query: ProductQuery, matched: list[str], unmet: list[str], unknown: list[str]) -> dict[str, Any]:
    hard_count = max(1, len(query.hard_constraints))
    score = max(0, min(100, int(round((len(matched) / hard_count) * 100))))
    reasons = [f"matched {key.replace('_', ' ')}" for key in matched]
    reasons.extend(f"tradeoff: {key.replace('_', ' ')}" for key in unmet + unknown)
    if not reasons:
        reasons.append("baseline catalog fit")
    value = copy.deepcopy(product)
    value.update({"fit_score": score, "matched_constraints": matched, "unmet_constraints": unmet, "unknown_constraints": unknown, "tradeoffs": unmet + unknown, "ranking_reasons": reasons, "evidence": _evidence(product)})
    return value


def search_products(query: ProductQuery, limit: int = 20, provider: CatalogProvider | None = None) -> list[dict[str, Any]]:
    provider = provider or catalog_provider()
    if query.contradictions:
        return []
    ranked: list[tuple[int, str, dict[str, Any]]] = []
    for product in provider.products():
        ok, matched, unmet, unknown = _meets(product, query)
        if not ok:
            continue
        result = _result(product, query, matched, unmet, unknown)
        ranked.append((int(result["fit_score"]), str(product["product_id"]), result))
    ranked.sort(key=lambda item: (-item[0], 0 if item[2].get("availability") == "in_stock" else 1, item[1]))
    try:
        configured_max = max(1, min(int(os.getenv("PRODUCT_CATALOG_MAX_RESULTS", "20")), 20))
    except ValueError:
        configured_max = 20
    return [item[2] for item in ranked[: max(1, min(int(limit), configured_max))]]


def get_product(product_id: str, provider: CatalogProvider | None = None) -> dict[str, Any] | None:
    provider = provider or catalog_provider()
    for product in provider.products():
        if str(product.get("product_id")) == str(product_id):
            value = copy.deepcopy(product)
            value["evidence"] = _evidence(product)
            return value
    return None


def compare_products(product_ids: list[str], provider: CatalogProvider | None = None) -> dict[str, Any]:
    if not 2 <= len(product_ids) <= 5:
        raise ProductQueryError("compare_products requires between two and five products")
    products = [get_product(item, provider) for item in product_ids]
    if any(item is None for item in products):
        raise ProductQueryError("one or more products are not in the configured catalog")
    return {"products": products, "fields": ["price_cents", "currency", "availability", "rating", "review_count", "specifications"], "simulated": True}


def availability(product_id: str, provider: CatalogProvider | None = None) -> dict[str, Any]:
    product = get_product(product_id, provider)
    if product is None:
        raise ProductQueryError("product not found")
    return {"product_id": product_id, "availability": product["availability"], "stock_status": product["stock_status"], "product_revision": product["product_revision"], "retrieved_at": product["retrieved_at"], "provider": product["provider"], "simulated": True}


def reviews(product_id: str, provider: CatalogProvider | None = None) -> dict[str, Any]:
    product = get_product(product_id, provider)
    if product is None:
        raise ProductQueryError("product not found")
    return {"product_id": product_id, "rating": product.get("rating"), "review_count": product.get("review_count"), "review_summary": product.get("review_summary"), "review_text": product.get("review_text"), "review_text_available": bool(product.get("review_text")), "provider": product["provider"], "retrieved_at": product["retrieved_at"], "simulated": True}


def recommendation_context(query_text: str, memory_context: dict[str, Any] | None = None, structured: dict[str, Any] | None = None) -> dict[str, Any]:
    query = parse_product_query(query_text, structured)
    applied: list[str] = []
    memory = memory_context or {}
    for item in memory.get("private", []):
        key = str(item.get("key", "")).lower()
        value = str(item.get("value", ""))
        if "brand" in key and value.lower() in {"lenovo", "dell", "hp", "apple", "asus", "acer"} and not query.brand:
            applied.append(f"prefers {value}")
        elif "budget" in key:
            applied.append(f"saved budget preference: {value}")
    return {"query": query.as_dict(), "memory_influences": applied, "memory_authorizes": False, "note": "Memory may prefill discovery only; policy and approval remain independent."}
