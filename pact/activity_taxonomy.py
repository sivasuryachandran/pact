"""Validated activity taxonomy for Qloo place searches.

Qloo exposes a large, dynamic tag taxonomy; this is NOT an exhaustive list. API taxonomy support is
different from useful local results: a tag can be valid and still return nothing, malls, hotels or
casinos for a given city. Each entry below records the outcome of a live San Jose check (2026-10-18):

  VERIFIED       >= 3 relevant local results
  THIN           1-2 relevant results     (explicit request only, with an honest caveat)
  IRRELEVANT     results include unrelated places (hidden)
  NOT_VERIFIED   no usable result or tag not confirmed (hidden)

Users only ever see the public group names (Museums & culture, ...), never raw tag ids.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

P = "urn:tag:category:place:"
VERIFIED, THIN, IRRELEVANT, NOT_VERIFIED = "VERIFIED", "THIN", "IRRELEVANT", "NOT_VERIFIED"
VALIDATED_AT = "2026-10-18"
VALIDATION_CITY = "San Jose"

# slug -> (public group, qloo tag id, status, apply quality filter)
TAXONOMY: dict[str, dict[str, Any]] = {
    "museums": {"group": "Museums & culture", "tag": P + "museum", "status": VERIFIED},
    "theaters": {"group": "Museums & culture", "tag": P + "performing_arts_theater", "status": VERIFIED},
    "art studios": {"group": "Museums & culture", "tag": P + "art_studio", "status": THIN},
    "art galleries": {"group": "Museums & culture", "tag": P + "art_gallery", "status": THIN},
    "parks": {"group": "Parks & outdoors", "tag": P + "park", "status": VERIFIED},
    "hiking": {"group": "Parks & outdoors", "tag": P + "hiking_area", "status": VERIFIED},
    "nature preserves": {"group": "Parks & outdoors", "tag": P + "nature_preserve", "status": THIN},
    "trail heads": {"group": "Parks & outdoors", "tag": P + "trail_head", "status": NOT_VERIFIED},
    "bowling": {"group": "Sports & games", "tag": P + "bowling_alley", "status": VERIFIED},
    "golf": {"group": "Sports & games", "tag": P + "golf_course", "status": VERIFIED},
    "escape rooms": {"group": "Sports & games", "tag": P + "escape_room_center", "status": THIN},
    "amusement parks": {"group": "Family activities", "tag": P + "amusement_park", "status": VERIFIED},
    "zoos": {"group": "Family activities", "tag": P + "zoo", "status": THIN},
    "playgrounds": {"group": "Family activities", "tag": P + "playground", "status": THIN},
    "aquariums": {"group": "Family activities", "tag": P + "aquarium", "status": NOT_VERIFIED},
    "movie theaters": {"group": "Movies & theaters", "tag": P + "movie_theater", "status": VERIFIED, "note": "verified only with the quality filter (malls removed)"},
    "concerts": {"group": "Live events", "tag": P + "concert_hall", "status": THIN},
    "music venues": {"group": "Live events", "tag": P + "live_music_venue", "status": IRRELEVANT, "note": "returned bars, restaurants and a market"},
    "dance schools": {"group": "Classes & workshops", "tag": P + "dance_school", "status": VERIFIED},
    "cooking classes": {"group": "Classes & workshops", "tag": P + "cooking_class", "status": NOT_VERIFIED},
    "workshops": {"group": "Classes & workshops", "tag": P + "workshop", "status": NOT_VERIFIED},
    "pottery classes": {"group": "Classes & workshops", "tag": P + "pottery_classes", "status": NOT_VERIFIED},
    "tourist attractions": {"group": "Attractions", "tag": P + "tourist_attraction", "status": IRRELEVANT, "note": "returned a casino"},
}

# Public groups. A group is exposed only when it has at least one VERIFIED member; a group search
# ORs only its VERIFIED tags. "Live events" and "Attractions" have none, so they stay hidden.
GROUPS = ("Museums & culture", "Parks & outdoors", "Sports & games", "Family activities", "Movies & theaters", "Live events", "Classes & workshops", "Attractions")
GROUP_SCOPE_NOTE = {"Classes & workshops": "currently dance schools only", "Movies & theaters": "cinemas, with malls filtered out"}
# Generic "things to do" mix: reliable, relevant, non-thin groups only (no amusement-park default,
# no movie theaters, no tourist attractions).
GENERAL_MIX = ("museums", "theaters", "parks", "hiking", "bowling", "golf")
UI_GROUPS = ("Museums & culture", "Parks & outdoors", "Sports & games", "Family activities", "Classes & workshops")  # Live events stays hidden until verified

# Reasons a place is not a real match even when it carries the queried tag.
_UNRELATED = {"casino", "shopping_mall", "department_store", "clothing_store", "hotel", "lodging", "resort", "apartment_complex"}

_ALIASES = {
    "museum": "museums", "culture": "Museums & culture", "cultural": "Museums & culture", "arts": "Museums & culture",
    "theater": "theaters", "theatre": "theaters", "theatres": "theaters", "play": "theaters",
    "art studio": "art studios", "art gallery": "art galleries", "gallery": "art galleries", "galleries": "art galleries",
    "park": "parks", "outdoors": "Parks & outdoors", "outdoor": "Parks & outdoors", "outdoor recreation": "Parks & outdoors", "hike": "hiking", "hikes": "hiking", "trails": "hiking", "trail": "hiking",
    "nature preserve": "nature preserves", "nature": "nature preserves", "trail head": "trail heads",
    "bowl": "bowling", "bowling alley": "bowling", "golf course": "golf", "mini golf": "golf", "sports": "Sports & games", "escape room": "escape rooms",
    "amusement park": "amusement parks", "theme park": "amusement parks", "theme parks": "amusement parks", "family": "Family activities", "kid friendly": "Family activities",
    "zoo": "zoos", "playground": "playgrounds", "aquarium": "aquariums",
    "movie theater": "movie theaters", "cinema": "movie theaters", "cinemas": "movie theaters", "movie theatre": "movie theaters",
    "concert": "concerts", "live music": "concerts", "live events": "Live events", "events": "Live events", "music venue": "music venues",
    "classes": "Classes & workshops", "class": "Classes & workshops", "lessons": "Classes & workshops", "dance": "dance schools", "dance school": "dance schools", "dance classes": "dance schools",
    "cooking class": "cooking classes", "cooking": "cooking classes", "workshop": "workshops", "pottery": "pottery classes",
    "attraction": "tourist attractions", "attractions": "tourist attractions", "tourist attraction": "tourist attractions", "sightseeing": "tourist attractions",
}
_PUBLIC_LOWER = {g.lower(): g for g in GROUPS}
# longest names first so "dance classes" wins over "classes"
_NAMES = sorted(set(_ALIASES) | set(TAXONOMY) | set(_PUBLIC_LOWER), key=len, reverse=True)

UNAVAILABLE_MESSAGE = "I couldn’t verify enough nearby results for that category. Try another activity type or enable demo recommendations."


def verified_slugs(group: str) -> list[str]:
    return [s for s, v in TAXONOMY.items() if v["group"] == group and v["status"] == VERIFIED]


def public_groups() -> list[dict[str, Any]]:
    """Groups with live-verified results, for the UI. No tag ids are exposed."""
    out = []
    for g in GROUPS:
        if verified_slugs(g):
            out.append({"label": g, "note": GROUP_SCOPE_NOTE.get(g), "in_ui": g in UI_GROUPS})
    return out


def find_category(text: str) -> str | None:
    """The category word the person used (alias, slug or public group), if any."""
    lower = text.lower()
    for name in _NAMES:
        if re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", lower):
            return name
    return None


def resolve(name: str | None) -> dict[str, Any] | None:
    """Map a name to a search plan, or None when it is unknown.

    Returns {label, tags, status, limited, group}. `status` is VERIFIED/THIN/IRRELEVANT/NOT_VERIFIED;
    only VERIFIED and THIN have tags to search. Raw tag ids stay server-side.
    """
    key = (name or "").strip().lower()
    key = _ALIASES.get(key, key)
    if key in _PUBLIC_LOWER:
        key = _PUBLIC_LOWER[key]
    if key in GROUPS:
        slugs = verified_slugs(key)
        if not slugs:
            return {"label": key, "tags": [], "status": NOT_VERIFIED, "limited": True, "group": key, "slugs": []}
        return {"label": key, "tags": [TAXONOMY[s]["tag"] for s in slugs], "status": VERIFIED, "limited": False, "group": key, "slugs": slugs, "scope_note": GROUP_SCOPE_NOTE.get(key)}
    entry = TAXONOMY.get(key)
    if not entry:
        return None
    ok = entry["status"] in (VERIFIED, THIN)
    return {"label": key, "tags": [entry["tag"]] if ok else [], "status": entry["status"], "limited": entry["status"] == THIN, "group": entry["group"], "slugs": [key]}


def general_plan() -> dict[str, Any]:
    return {"label": None, "tags": [TAXONOMY[s]["tag"] for s in GENERAL_MIX], "status": VERIFIED, "limited": False, "group": None, "slugs": list(GENERAL_MIX)}


def normalize_city(city: str) -> str:
    """Qloo's filter.location.query needs a plain city name: 'San Jose, CA' returns zero results."""
    return city.split(",")[0].strip()[:80]


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c)).strip()


def same_city(a: str, b: str) -> bool:
    return _fold(a) == _fold(b)


def is_unrelated_place(entity: dict[str, Any], wanted_tags: list[str]) -> bool:
    """Quality check from the entity's own category tags: malls, hotels and casinos are dropped
    unless the category being searched is itself that kind of place."""
    ids = {t.get("id", "") for t in entity.get("tags", []) if isinstance(t, dict)}
    cats = {i.rsplit(":", 1)[-1] for i in ids if i.startswith(P)}
    wanted = {t.rsplit(":", 1)[-1] for t in wanted_tags}
    return bool((cats & _UNRELATED) - wanted)
