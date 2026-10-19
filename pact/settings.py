"""Per-session demo settings: account label, location, timezone, language, toggles.

Settings are validated here and stored with the sandbox. This is demo state, not an identity
system. Nothing in this module makes an authorization decision.
"""

from __future__ import annotations

import copy
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROLES = ("adult", "teen", "child", "caregiver")
LANGUAGES = {"en-US": "English (US)", "en-GB": "English (UK)", "es-ES": "Español", "fr-FR": "Français", "de-DE": "Deutsch", "hi-IN": "हिन्दी"}
MAX_MEMBERS = 8
_TEXT = re.compile(r"[\x00-\x1f\x7f<>]")


def default_settings() -> dict[str, Any]:
    return {
        "account": {"signed_in": False, "display_name": "", "kind": "Demo account"},
        "location": {"city": "", "region": "", "country": "", "latitude": None, "longitude": None, "share_coordinates": False},
        "timezone": {"name": "", "source": "unset"},  # source: unset | auto | user
        "language": "en-US",
        "personalization": True,
        "qloo_enabled": True,
        "voice_enabled": True,
    }


def _text(value: Any, field: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    cleaned = _TEXT.sub("", value).strip()
    if len(cleaned) > limit:
        raise ValueError(f"{field} is too long (max {limit})")
    if required and not cleaned:
        raise ValueError(f"{field} is required")
    return cleaned


clean_text = _text


def _coord(value: Any, field: str, low: float, high: float) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a number") from exc
    if not low <= number <= high:
        raise ValueError(f"{field} must be between {low} and {high}")
    return round(number, 4)


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return bool(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False


def apply_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Return new settings with `patch` applied. Unknown keys are ignored; bad values raise ValueError."""
    out = copy.deepcopy(current)
    if "location" in patch:
        loc = patch["location"]
        if not isinstance(loc, dict):
            raise ValueError("location must be an object")
        cur = out["location"]
        for key, limit in (("city", 80), ("region", 80), ("country", 80)):
            if key in loc:
                cur[key] = _text(loc[key], key, limit)
        if "latitude" in loc:
            cur["latitude"] = _coord(loc["latitude"], "latitude", -90, 90)
        if "longitude" in loc:
            cur["longitude"] = _coord(loc["longitude"], "longitude", -180, 180)
        if "share_coordinates" in loc:
            cur["share_coordinates"] = bool(loc["share_coordinates"])
        if (cur["latitude"] is None) != (cur["longitude"] is None):
            raise ValueError("latitude and longitude must be set together")
    if "timezone" in patch:
        tz = patch["timezone"]
        name = tz.get("name") if isinstance(tz, dict) else tz
        source = tz.get("source", "user") if isinstance(tz, dict) else "user"
        name = _text(name, "timezone", 64)
        if name and not valid_timezone(name):
            raise ValueError("unknown timezone")
        if source not in {"auto", "user"}:
            source = "user"
        # A browser auto-detect never overwrites a value the person typed themselves.
        if not (source == "auto" and out["timezone"]["source"] == "user"):
            out["timezone"] = {"name": name, "source": source if name else "unset"}
    if "language" in patch:
        if patch["language"] not in LANGUAGES:
            raise ValueError("unsupported language")
        out["language"] = patch["language"]
    for key in ("personalization", "qloo_enabled", "voice_enabled"):
        if key in patch:
            out[key] = bool(patch[key])
    return out


def validate_members(members: Any) -> list[dict[str, Any]]:
    """Display-only household members. Policy roles for the demo stay fixed in code."""
    if not isinstance(members, list) or not 1 <= len(members) <= MAX_MEMBERS:
        raise ValueError(f"members must be a list of 1-{MAX_MEMBERS}")
    clean, seen = [], set()
    for item in members:
        if not isinstance(item, dict):
            raise ValueError("each member must be an object")
        name = _text(item.get("name"), "member name", 40, required=True)
        role = item.get("role")
        if role not in ROLES:
            raise ValueError("role must be adult, teen, child or caregiver")
        ident = re.sub(r"[^a-z0-9]+", "-", str(item.get("id") or name).lower()).strip("-")[:24] or "member"
        if ident in seen:
            raise ValueError("duplicate member")
        seen.add(ident)
        interests = item.get("interests", [])
        if not isinstance(interests, list) or len(interests) > 8:
            raise ValueError("interests must be a short list")
        clean.append({"id": ident, "name": name, "role": role, "can_approve": role == "adult", "interests": [_text(i, "interest", 40) for i in interests if str(i).strip()]})
    if not any(m["role"] == "adult" for m in clean):
        raise ValueError("at least one adult is required")
    return clean


def location_label(settings: dict[str, Any]) -> str:
    loc = settings.get("location", {})
    return ", ".join(part for part in (loc.get("city"), loc.get("region"), loc.get("country")) if part)


def has_location(settings: dict[str, Any]) -> bool:
    return bool(settings.get("location", {}).get("city"))


def local_time_text(settings: dict[str, Any], now: datetime | None = None) -> str | None:
    """Time in the saved timezone, or None when no timezone is saved. Pure stdlib; no provider involved."""
    name = settings.get("timezone", {}).get("name")
    if not name or not valid_timezone(name):
        return None
    moment = (now or datetime.now(ZoneInfo("UTC"))).astimezone(ZoneInfo(name))
    return f"{moment.strftime('%-I:%M %p')} on {moment.strftime('%A, %B %-d')} ({name})"


def public_view(settings: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(settings)
