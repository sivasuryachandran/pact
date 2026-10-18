"""Optional Qloo taste/recommendation client with a deterministic local fallback.

Qloo is used ONLY to rank taste and entertainment suggestions. It is never consulted for
authentication, policy, approvals, time, security or factual answers, and nothing it returns can
change a PACT decision: suggestions are plain data that must still go through `check_action`.

The API key comes from QLOO_API_KEY and is never logged, returned or placed in error text.
Verified in the sibling Qrowd spike (live hackathon key): base https://hackathon.api.qloo.com, header
X-Api-Key, GET /search?query&types, GET /v2/insights with filter.type + signal.interests.entities (a
signal or filter is required), response results.entities[].query.affinity. Verified live since: movie, music (artist) and place types; places are
restricted to a city with filter.location.query (signal.location.query is ignored).
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

DEFAULT_BASE_URL = "https://hackathon.api.qloo.com"
DEFAULT_SEEDS = {"movie": "Inside Out", "music": "Khruangbin", "restaurant": "Chipotle", "activity": "Dave & Buster's"}
RESTAURANT_TAG = "urn:tag:category:place:restaurant"  # verified live

# Activity categories. ONLY categories whose live San Jose request succeeded with usable, located
# results are listed. Others (cooking classes, workshops, aquariums, family-specific) are NOT VERIFIED
# and are deliberately absent. Amusement parks are one entry, not the definition of "activities".
ACTIVITY_CATEGORIES: dict[str, str] = {
    "museums": "urn:tag:category:place:museum",
    "parks": "urn:tag:category:place:park",
    "zoos": "urn:tag:category:place:zoo",
    "theaters": "urn:tag:category:place:performing_arts_theater",
    "movie theaters": "urn:tag:category:place:movie_theater",
    "bowling": "urn:tag:category:place:bowling_alley",
    "golf": "urn:tag:category:place:golf_course",
    "concerts": "urn:tag:category:place:concert_hall",
    "escape rooms": "urn:tag:category:place:escape_room_center",
    "attractions": "urn:tag:category:place:tourist_attraction",
    "art studios": "urn:tag:category:place:art_studio",
    "outdoor recreation": "urn:tag:category:place:hiking_area",
    "nature preserves": "urn:tag:category:place:nature_preserve",
    "playgrounds": "urn:tag:category:place:playground",
    "amusement parks": "urn:tag:category:place:amusement_park",
}
# Used when no category is given: a mixed, curated set (Qloo treats comma-separated tags as OR; verified live).
# "attractions" is excluded: that tag surfaced a casino for San Jose, which is not household-friendly.
GENERAL_ACTIVITY = ("museums", "parks", "theaters", "bowling", "outdoor recreation", "amusement parks")
CATEGORY_ALIASES = {
    "museum": "museums", "park": "parks", "zoo": "zoos", "theater": "theaters", "theatre": "theaters", "theatres": "theaters",
    "plays": "theaters", "movie theater": "movie theaters", "cinema": "movie theaters", "cinemas": "movie theaters",
    "bowl": "bowling", "bowling alley": "bowling", "golf course": "golf", "mini golf": "golf", "concert": "concerts", "live music": "concerts",
    "escape room": "escape rooms", "attraction": "attractions", "tourist attractions": "attractions", "art studio": "art studios",
    "hiking": "outdoor recreation", "outdoors": "outdoor recreation", "outdoor": "outdoor recreation", "trails": "outdoor recreation",
    "nature preserve": "nature preserves", "playground": "playgrounds", "amusement park": "amusement parks", "theme park": "amusement parks", "theme parks": "amusement parks",
}


def resolve_activity_category(name: str | None) -> str | None:
    """Canonical verified category for a free-text name, or None when it is not a verified category."""
    key = (name or "").strip().lower()
    key = CATEGORY_ALIASES.get(key, key)
    return key if key in ACTIVITY_CATEGORIES else None

KINDS = {
    "movie": "urn:entity:movie",
    "music": "urn:entity:artist",
    "restaurant": "urn:entity:place",
    "activity": "urn:entity:place",
}
PROVIDER_QLOO = "qloo"
PROVIDER_LOCAL = "local"
LABELS = {PROVIDER_QLOO: "Qloo", PROVIDER_LOCAL: "Demo recommendations"}

# Fake, deterministic demo catalogue. Order is stable so tests and screenshots are reproducible.
_LOCAL: dict[str, list[tuple[str, str]]] = {
    "movie": [("The Wild Robot", "Family animation about a robot learning to belong"), ("Inside Out 2", "Feel-good pick for a teen and parents"), ("Paddington in Peru", "Gentle comedy everyone can watch"), ("Spider-Man: Into the Spider-Verse", "Stylish animated adventure")],
    "music": [("Khruangbin", "Warm instrumental grooves"), ("Tame Impala", "Dreamy modern psych-pop"), ("Norah Jones", "Calm acoustic evening")],
    "restaurant": [("Sunny Side Kitchen", "Relaxed family brunch"), ("Lantern Noodle House", "Shareable bowls"), ("Corner Pizza Co.", "Easy crowd-pleaser")],
    "activity": [("Funzone Arcade", "Games and a party room"), ("Riverside Mini Golf", "Outdoor and casual"), ("City Science Museum", "Hands-on exhibits")],
}


class QlooError(Exception):
    """Safe, key-free error. `reason` is one of a small fixed vocabulary."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def redact(text: str, *secrets: str | None) -> str:
    for secret in secrets:
        if secret and len(secret) >= 4:
            text = text.replace(secret, "[redacted]")
    return text


def validate_response(payload: Any, limit: int = 5) -> list[dict[str, Any]]:
    """Accept only the fields we use. Anything malformed raises QlooError('invalid_response')."""
    if not isinstance(payload, dict):
        raise QlooError("invalid_response")
    results = payload.get("results")
    entities = results.get("entities") if isinstance(results, dict) else None
    if not isinstance(entities, list):
        raise QlooError("invalid_response")
    items: list[dict[str, Any]] = []
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        name = entity.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            continue
        query = entity.get("query") if isinstance(entity.get("query"), dict) else {}
        affinity = query.get("affinity")
        score = round(float(affinity), 3) if isinstance(affinity, (int, float)) and not isinstance(affinity, bool) and 0 <= affinity <= 1 else None
        desc = entity.get("properties", {}).get("short_description") if isinstance(entity.get("properties"), dict) else None
        items.append({"name": name.strip(), "reason": desc.strip()[:160] if isinstance(desc, str) else "Matches your taste profile", "score": score})
        if len(items) >= limit:
            break
    if not items:
        raise QlooError("invalid_response")
    return items


def local_recommendations(kind: str, interests: list[str] | None = None, limit: int = 3) -> list[dict[str, Any]]:
    catalogue = _LOCAL.get(kind, _LOCAL["movie"])
    words = {w.lower() for i in (interests or []) for w in i.split()}
    ranked = sorted(enumerate(catalogue), key=lambda p: (-sum(1 for w in words if w in (p[1][0] + " " + p[1][1]).lower()), p[0]))
    return [{"name": n, "reason": r, "score": None} for _, (n, r) in ranked[:limit]]


class QlooClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 4.0, retries: int = 1, opener: Callable[..., Any] | None = None, sleep: Callable[[float], None] = time.sleep) -> None:
        self._key = api_key if api_key is not None else os.getenv("QLOO_API_KEY", "")
        self.base_url = (base_url or os.getenv("QLOO_API_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.timeout, self.retries, self._open, self._sleep = timeout, max(0, retries), opener or urllib.request.urlopen, sleep

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def _get(self, path: str, params: dict[str, str]) -> Any:
        """One GET with timeout/retry. Raises QlooError with a fixed-vocabulary reason; never includes the key."""
        request = urllib.request.Request(f"{self.base_url}{path}?{urllib.parse.urlencode(params)}", headers={"X-Api-Key": self._key, "Accept": "application/json"})
        last = "unavailable"
        for attempt in range(self.retries + 1):
            try:
                with self._open(request, timeout=self.timeout) as response:
                    return json.loads(response.read(4194304).decode("utf-8"))
            except urllib.error.HTTPError as exc:
                last = "auth_failed" if exc.code in (401, 403) else "rate_limited" if exc.code == 429 else "http_error"
                if exc.code < 500 and exc.code != 429:
                    break
            except (TimeoutError, urllib.error.URLError, OSError) as exc:
                last = "timeout" if isinstance(exc, TimeoutError) or "timed out" in str(exc).lower() else "unavailable"
            except (ValueError, UnicodeDecodeError):
                raise QlooError("invalid_response") from None
            if attempt < self.retries:
                self._sleep(0.5 * (attempt + 1))  # Qloo returns 429 on bursts; back off
        raise QlooError(last)

    def fetch(self, kind: str, city: str = "", limit: int = 5, seeds: list[str] | None = None, activity_category: str | None = None) -> list[dict[str, Any]]:
        """Resolve a seed taste to an entity id (/search), then rank similar entities (/v2/insights).

        Insights needs a signal or filter: filter.type alone returns HTTP 400 (confirmed in the Qrowd spike).
        """
        if not self._key:
            raise QlooError("missing_key")
        urn = KINDS.get(kind, KINDS["movie"])
        seed = next((s for s in (seeds or []) if s.strip()), None) or DEFAULT_SEEDS.get(kind, DEFAULT_SEEDS["movie"])
        found = self._get("/search", {"query": seed[:80], "types": "urn:entity:brand" if urn == "urn:entity:place" else urn})  # brand seeds resolve to a useful taste, not one random venue
        results = found.get("results") if isinstance(found, dict) else None
        seed_id = results[0].get("entity_id") if isinstance(results, list) and results and isinstance(results[0], dict) else None
        if not isinstance(seed_id, str) or not seed_id:
            raise QlooError("invalid_response")
        params = {"filter.type": urn, "signal.interests.entities": seed_id, "take": str(limit + 1)}
        if kind in {"restaurant", "activity"}:
            if kind == "restaurant":
                params["filter.tags"] = RESTAURANT_TAG
            elif activity_category:
                tag = ACTIVITY_CATEGORIES.get(activity_category)
                if not tag:
                    raise QlooError("unknown_category")
                params["filter.tags"] = tag
            else:
                params["filter.tags"] = ",".join(ACTIVITY_CATEGORIES[c] for c in GENERAL_ACTIVITY)
        if city and kind in {"restaurant", "activity"}:
            params["filter.location.query"] = city  # verified live: restricts places to the city (signal.location.query does not)
        items = validate_response(self._get("/v2/insights", params), limit + 1)
        return [i for i in items if i["name"].lower() != seed.lower()][:limit] or items[:limit]


class MockQlooProvider:
    """Test double with the same interface as QlooClient."""

    configured = True

    def __init__(self, items: list[dict[str, Any]] | None = None, error: str | None = None) -> None:
        self.items, self.error, self.calls = items or [{"name": "Mock Movie", "reason": "mock", "score": 0.9}], error, 0

    def fetch(self, kind: str, city: str = "", limit: int = 5, seeds: list[str] | None = None, activity_category: str | None = None) -> list[dict[str, Any]]:
        self.calls += 1
        self.last_category = activity_category
        if self.error:
            raise QlooError(self.error)
        return self.items[:limit]


class Recommender:
    """Chooses Qloo or the local fallback and caches per session. Never raises."""

    TTL = 600.0

    def __init__(self, client: Any | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.client = client if client is not None else QlooClient()
        self._cache: dict[tuple[str, str, str, str], tuple[float, dict[str, Any]]] = {}
        self._clock = clock

    def recommend(self, session_id: str, kind: str, *, enabled: bool, personalization: bool, city: str = "", interests: list[str] | None = None, limit: int = 3, activity_category: str | None = None) -> dict[str, Any]:
        kind = kind if kind in KINDS else "movie"
        category = None
        if kind == "activity" and activity_category:
            category = resolve_activity_category(activity_category)
            if category is None:  # unverified or unknown: never guess a tag, never widen silently
                result = {"provider": PROVIDER_LOCAL, "label": LABELS[PROVIDER_LOCAL], "kind": kind, "category": None, "requested_category": str(activity_category)[:40], "items": local_recommendations(kind, interests, limit), "note": "unknown_category"}
                return {**result, "cached": False}
        interests = interests if personalization else []
        use_qloo = enabled and personalization and getattr(self.client, "configured", False)
        key = (session_id, kind + ":" + (category or "general" if kind == "activity" else ""), city.lower() if use_qloo else "|".join(interests or []).lower(), "q" if use_qloo else "l")
        hit = self._cache.get(key)
        if hit and self._clock() - hit[0] < self.TTL:
            return {**hit[1], "cached": True}
        note = None
        if use_qloo:
            try:
                items = self.client.fetch(kind, city, limit, interests or None, category)
                result = {"provider": PROVIDER_QLOO, "label": LABELS[PROVIDER_QLOO], "kind": kind, "category": category, "items": items[:limit], "note": None}
                self._cache[key] = (self._clock(), result)
                return {**result, "cached": False}
            except QlooError as exc:
                note = exc.reason
            except Exception:  # defensive: a provider bug must never break the assistant
                note = "unavailable"
        elif not enabled:
            note = "disabled"
        elif not personalization:
            note = "personalization_off"
        else:
            note = "missing_key"
        result = {"provider": PROVIDER_LOCAL, "label": LABELS[PROVIDER_LOCAL], "kind": kind, "category": category, "items": local_recommendations(kind, interests, limit), "note": note}
        if note in {"missing_key", "disabled", "personalization_off"}:  # transient errors are retried next time
            self._cache[key] = (self._clock(), result)
        return {**result, "cached": False}

    def forget(self, session_id: str) -> None:
        for key in [k for k in self._cache if k[0] == session_id]:
            del self._cache[key]
