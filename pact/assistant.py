"""Informational routing for the assistant: time, nearby, movies and recommendations.

Nothing here makes an authorization decision. A recommendation is only a suggestion; turning it
into an action always goes through PACT's `check_action`, which allows, asks or denies.
"""

from __future__ import annotations

import re
from typing import Any

from .qloo_client import CATEGORY_ALIASES, Recommender, resolve_activity_category
from .settings import has_location, local_time_text, location_label

LOCAL = {"id": "local", "label": "Local demo"}
SETTINGS_LINK = {"label": "Open Settings", "href": "#settings"}

_TIME = re.compile(r"\b(what(?:'s| is) the time|what time is it|current time|time is it)\b")
_LATEST = re.compile(r"\b(latest|newest|new(?:est)?)\b.*\b(movie|film)s?\b|\bwhat(?:'s| is) (?:the )?(?:latest|newest)\b")
_NEAR = re.compile(r"\b(near me|nearby|around me|close to me|in my area|happening (?:near|around|locally)|local weather|weather)\b")
_RECOMMEND = re.compile(r"\b(recommend|suggest)\b|\bwhat should (?:we|i) (?:watch|do|eat|listen)\b")
_BOOK_THIS = re.compile(r"^\s*book (this|that|it)\b")


def _activity_category(lower: str) -> str | None:
    """Name the activity category the person asked for, if any. Longest alias wins."""
    names = sorted(set(CATEGORY_ALIASES) | set(CATEGORY_ALIASES.values()) | {"museums", "parks", "zoos", "theaters", "bowling", "golf", "concerts", "attractions", "playgrounds"}, key=len, reverse=True)
    for name in names:
        if re.search(rf"\b{re.escape(name)}\b", lower):
            return name
    m = re.search(r"\b(classes|class|workshops?|aquariums?|cooking|family)\b", lower)  # recognised but NOT VERIFIED
    return m.group(1) if m else None


def _kind(lower: str) -> str:
    if _activity_category(lower) and not re.search(r"\b(movie|movies|film|films)\b", lower):
        return "activity"
    if re.search(r"\b(music|song|songs|artist|band|listen)\b", lower):
        return "music"
    if re.search(r"\b(restaurant|dinner|lunch|eat|food|brunch)\b", lower):
        return "restaurant"
    if re.search(r"\b(activity|activities|do this weekend|something to do|fun)\b", lower):
        return "activity"
    return "movie"


def _interests(target: Any, speaker: str, settings: dict[str, Any]) -> list[str]:
    if not settings.get("personalization", True):
        return []
    out: list[str] = []
    for member in target.store.household.get("members", []):
        if member.get("id") == speaker or not speaker:
            out.extend(member.get("interests", []))
    return out


def _activity_scope(rec: dict[str, Any]) -> str:
    """Say exactly what was searched. Amusement parks are never presented as 'all activities'."""
    if rec.get("note") == "unknown_category":
        return f"I can't verify “{rec.get('requested_category')}” as a category yet, so these are general demo ideas"
    if rec.get("category"):
        return f"Things to do: {rec['category']}"
    if rec.get("provider") == "qloo":
        return "Things to do: a mix of museums, parks, theaters, bowling, outdoors and amusement parks"
    return "Things to do"


def is_informational(lower: str) -> bool:
    return bool(_TIME.search(lower) or _LATEST.search(lower) or _NEAR.search(lower) or _RECOMMEND.search(lower) or _BOOK_THIS.search(lower))


def wants_book_this(lower: str) -> bool:
    return bool(_BOOK_THIS.search(lower))


def route(target: Any, lower: str, speaker: str, conversation: dict[str, Any], recommender: Recommender, session_id: str) -> dict[str, Any] | None:
    """Return {assistant, card, provider, trace} for an informational intent, else None."""
    settings = target.store.settings
    loc_ok = has_location(settings)

    if _TIME.search(lower):
        text = local_time_text(settings)
        if text is None:
            return {"assistant": "I don't have your timezone yet. Set it in Settings and I'll use it.", "card": {"kind": "needs_setting", "setting": "timezone", "link": SETTINGS_LINK}, "provider": LOCAL, "trace": ["settings"]}
        return {"assistant": f"It's {text}.", "card": {"kind": "info", "topic": "time"}, "provider": LOCAL, "trace": ["settings.timezone"]}

    if _NEAR.search(lower):
        if not loc_ok:
            first = not conversation.get("asked_location")
            conversation["asked_location"] = True
            msg = "Which city are you in? Add it in Settings so I only use a location you choose." if first else "I still need your home location. Open Settings → Location to add it."
            return {"assistant": msg, "card": {"kind": "needs_setting", "setting": "location", "link": SETTINGS_LINK}, "provider": LOCAL, "trace": ["settings"]}
        kind = "movie" if re.search(r"\b(movie|movies|film|films|cinema)\b", lower) else "activity"
        rec = recommender.recommend(session_id, kind, enabled=settings.get("qloo_enabled", True), personalization=settings.get("personalization", True), city=settings["location"]["city"], interests=_interests(target, speaker, settings), activity_category=_activity_category(lower) if kind == "activity" else None)
        what = "Movie ideas" if kind == "movie" else _activity_scope(rec)
        names = ", ".join(i["name"] for i in rec["items"])
        note = " Showtimes and live listings aren't available in this demo." if kind == "movie" else " Live local events and weather aren't connected in this demo."
        return {"assistant": f"{what} for {location_label(settings)} ({rec['label']}): {names}.{note}", "card": {"kind": "recommendation", "recommendation": rec, "suggestion_only": True}, "provider": {"id": rec["provider"], "label": rec["label"]}, "trace": ["recommend"], "last_recommendation": rec["items"][0] if rec["items"] else None}

    if _LATEST.search(lower):
        return {"assistant": "Live search isn't connected in this build, so I can't look up the latest releases. I can suggest movies from taste data instead. Just ask me to recommend one.", "card": {"kind": "info", "topic": "search_unavailable"}, "provider": LOCAL, "trace": []}

    if _RECOMMEND.search(lower):
        kind = _kind(lower)
        rec = recommender.recommend(session_id, kind, enabled=settings.get("qloo_enabled", True), personalization=settings.get("personalization", True), city=settings["location"]["city"] if loc_ok else "", interests=_interests(target, "", settings), activity_category=_activity_category(lower) if kind == "activity" else None)
        top = rec["items"][0] if rec["items"] else None
        names = "; ".join(f"{i['name']} ({i['reason']})" if i.get("reason") else i["name"] for i in rec["items"][:3])
        scope = f" ({_activity_scope(rec)})" if rec["kind"] == "activity" else ""
        return {"assistant": f"{rec['label']} suggests{scope}: {names}. This is only a suggestion; anything that spends money still goes through your house rules.", "card": {"kind": "recommendation", "recommendation": rec, "suggestion_only": True}, "provider": {"id": rec["provider"], "label": rec["label"]}, "trace": ["recommend"], "last_recommendation": top}
    return None
