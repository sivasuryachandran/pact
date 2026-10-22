from pathlib import Path

from botocore.exceptions import ClientError

from pact.tts import PollyProvider, TTSConfig, TTSUnavailable, cache_key, safe_ssml


class FakeStream:
    def __init__(self, value=b"mp3-audio"):
        self.value = value

    def read(self):
        return self.value


class FakePolly:
    def __init__(self):
        self.calls = []

    def synthesize_speech(self, **kwargs):
        self.calls.append(kwargs)
        return {"AudioStream": FakeStream()}


def test_ssml_escapes_user_text_and_cache_key_is_canonical(tmp_path):
    config = TTSConfig(provider="polly", cache_dir=str(tmp_path))
    assert safe_ssml("say <stay> & safe") == "<speak>say &lt;stay&gt; &amp; safe</speak>"
    assert cache_key(config, "hello") == cache_key(config, " hello ")
    assert cache_key(config, "hello") != cache_key(config, "goodbye")


def test_mock_polly_is_cached_only_for_non_personalized_audio(tmp_path):
    fake = FakePolly()
    provider = PollyProvider(TTSConfig(provider="polly", cache_dir=str(tmp_path)), fake)
    first = provider.synthesize("A safe household response")
    second = provider.synthesize("A safe household response")
    personalized = provider.synthesize("A safe household response", personalized=True)
    assert first["audio"] == b"mp3-audio"
    assert second["cached"] is True
    assert personalized["cached"] is False
    assert len(fake.calls) == 2
    assert list(Path(tmp_path).glob("*.mp3"))


def test_auto_provider_falls_back_without_exposing_error_text(tmp_path):
    class Failing:
        def synthesize_speech(self, **kwargs):
            raise ClientError({"Error": {"Code": "AccessDeniedException", "Message": "secret credential detail"}}, "SynthesizeSpeech")

    provider = PollyProvider(TTSConfig(provider="auto", cache_dir=str(tmp_path)), Failing())
    result = provider.synthesize("Fallback response", personalized=True)
    assert result["provider"] == "browser"
    assert result["fallback"] is True
    assert "secret" not in str(result).lower()


def test_browser_provider_never_constructs_a_client(tmp_path):
    provider = PollyProvider(TTSConfig(provider="browser", cache_dir=str(tmp_path)))
    result = provider.synthesize("Browser voice")
    assert result["provider"] == "browser"
    assert result["available"] is True
