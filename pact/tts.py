"""Optional Amazon Polly TTS with browser fallback and safe local caching."""

from __future__ import annotations

import hashlib
import html
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError


class TTSUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class TTSConfig:
    provider: str = "browser"
    region: str = "us-west-2"
    engine: str = "neural"
    voice_id: str = "Joanna"
    cache_dir: str = ".pact-cache/tts"
    max_chars: int = 1200
    cache_ttl_seconds: int = 7 * 24 * 60 * 60

    @classmethod
    def from_env(cls) -> "TTSConfig":
        provider = os.getenv("PACT_TTS_PROVIDER", "browser").strip().lower()
        if provider not in {"browser", "polly", "auto"}:
            provider = "browser"
        return cls(
            provider=provider,
            region=os.getenv("PACT_POLLY_REGION", os.getenv("PACT_AWS_REGION", "us-west-2")),
            engine=os.getenv("PACT_POLLY_ENGINE", "neural"),
            voice_id=os.getenv("PACT_POLLY_VOICE_ID", "Joanna"),
            cache_dir=os.getenv("PACT_TTS_CACHE_DIR", ".pact-cache/tts"),
            max_chars=max(120, min(5000, int(os.getenv("PACT_TTS_MAX_CHARS", "1200")))),
            cache_ttl_seconds=max(60, int(os.getenv("PACT_TTS_CACHE_TTL_SECONDS", str(7 * 24 * 60 * 60)))),
        )


def normalize_text(text: Any, max_chars: int) -> str:
    if not isinstance(text, str):
        raise TTSUnavailable("text must be a string")
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        raise TTSUnavailable("text is required")
    if len(cleaned) > max_chars:
        raise TTSUnavailable(f"text exceeds the {max_chars}-character voice limit")
    return cleaned


def safe_ssml(text: str) -> str:
    return f"<speak>{html.escape(text, quote=False)}</speak>"


def cache_key(config: TTSConfig, text: str, locale: str = "en-US") -> str:
    canonical = json.dumps({"provider": "polly", "engine": config.engine, "voice": config.voice_id, "locale": locale, "ssml_version": "1", "text": normalize_text(text, config.max_chars)}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class PollyProvider:
    def __init__(self, config: TTSConfig | None = None, client: Any = None) -> None:
        self.config = config or TTSConfig.from_env()
        self.client = client

    def status(self) -> dict[str, Any]:
        return {"configured_provider": self.config.provider, "provider": "polly" if self.config.provider in {"polly", "auto"} else "browser", "engine": self.config.engine, "voice_id": self.config.voice_id, "region": self.config.region, "fallback": "browser" if self.config.provider in {"auto", "polly"} else None}

    def _client(self) -> Any:
        if self.client is not None:
            return self.client
        session = boto3.Session(profile_name=os.getenv("AWS_PROFILE") or None, region_name=self.config.region)
        self.client = session.client("polly", config=Config(connect_timeout=3, read_timeout=12, retries={"total_max_attempts": 2, "mode": "standard"}))
        return self.client

    def _cache_path(self, key: str) -> Path:
        root = Path(self.config.cache_dir)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(root, 0o700)
        except OSError:
            pass
        return root / f"{key}.mp3"

    def cleanup_cache(self) -> None:
        root = Path(self.config.cache_dir)
        if not root.exists():
            return
        cutoff = time.time() - self.config.cache_ttl_seconds
        for item in root.glob("*.mp3"):
            try:
                if item.stat().st_mtime < cutoff:
                    item.unlink()
            except OSError:
                continue

    def synthesize(self, text: str, *, locale: str = "en-US", personalized: bool = False) -> dict[str, Any]:
        normalized = normalize_text(text, self.config.max_chars)
        if self.config.provider == "browser":
            return {"provider": "browser", "fallback": False, "available": True, "message": "Use browser speech synthesis."}
        key = cache_key(self.config, normalized, locale)
        cache_path = self._cache_path(key)
        self.cleanup_cache()
        if not personalized and cache_path.exists():
            return {"provider": "polly", "fallback": False, "available": True, "cached": True, "content_type": "audio/mpeg", "cache_key": key, "audio": cache_path.read_bytes()}
        try:
            response = self._client().synthesize_speech(Text=safe_ssml(normalized), TextType="ssml", OutputFormat="mp3", VoiceId=self.config.voice_id, Engine=self.config.engine, LanguageCode=locale)
            body = response.get("AudioStream")
            audio = body.read() if body is not None else b""
            if not audio:
                raise TTSUnavailable("Polly returned no audio")
            if not personalized:
                cache_path.write_bytes(audio)
                try:
                    os.chmod(cache_path, 0o600)
                except OSError:
                    pass
            return {"provider": "polly", "fallback": False, "available": True, "cached": False, "content_type": "audio/mpeg", "cache_key": key, "audio": audio}
        except (ClientError, BotoCoreError, NoCredentialsError, OSError, TTSUnavailable) as exc:
            if self.config.provider == "auto":
                return {"provider": "browser", "fallback": True, "available": True, "fallback_reason": type(exc).__name__}
            raise TTSUnavailable("Polly is unavailable; use browser voice fallback") from exc
