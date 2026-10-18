import json
import logging
import urllib.error
from datetime import datetime, timezone

import pytest
from starlette.testclient import TestClient

import pact.server as srv
from pact.compiler import deterministic_compile
from pact.providers import nvidia_compare, provider_status
from pact.qloo_client import MockQlooProvider, QlooClient, QlooError, Recommender, validate_response
from pact.settings import apply_patch, default_settings, local_time_text, validate_members

SECRET = "sk-test-SECRET-1234567890"


class StubCompiler:
    status = {"attempted": False, "available": False, "region": None, "model_id": None, "reason": "AWS credentials are unavailable"}

    def compile(self, source_text, created_by="siva"):
        result = deterministic_compile(source_text, created_by)
        result["compiler"] = "deterministic-test-stub"
        return result


@pytest.fixture
def app(tmp_path, monkeypatch):
    for name in ("QLOO_API_KEY", "NVIDIA_API_KEY", "NVIDIA_MODEL_ID", "NVIDIA_API_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(srv.sandboxes, "db_path", str(tmp_path / "t.sqlite3"))
    monkeypatch.setattr(srv.sandboxes, "compiler", StubCompiler())
    monkeypatch.setattr(srv.sandboxes, "services", {})
    monkeypatch.setattr(srv, "recommender_default", Recommender(QlooClient(api_key="")))
    return srv.create_app()


def client(app):
    return TestClient(app, base_url="http://127.0.0.1:8787", client=("127.0.0.1", 50000))


def say(c, text, **kw):
    r = c.post("/api/command", json={"text": text, "speaker_id": kw.get("speaker", "maya"), "surface": "living_room", "conversation_id": kw.get("cid")})
    assert r.status_code == 200, r.text
    return r.json()


# ---- Qloo ----

def test_missing_qloo_key_uses_fallback():
    out = Recommender(QlooClient(api_key="")).recommend("s", "movie", enabled=True, personalization=True)
    assert out["provider"] == "local" and out["label"] == "Demo recommendations" and out["note"] == "missing_key" and out["items"]


def test_qloo_timeout_uses_fallback_and_retries():
    calls = []

    def opener(req, timeout):
        calls.append(timeout)
        raise TimeoutError("timed out")

    client_ = QlooClient(api_key=SECRET, opener=opener, retries=2, sleep=lambda s: None)
    out = Recommender(client_).recommend("s", "movie", enabled=True, personalization=True)
    assert out["provider"] == "local" and out["note"] == "timeout" and len(calls) == 3
    assert SECRET not in json.dumps(out)


def test_qloo_response_validation():
    good = {"results": {"entities": [{"name": "Arrival", "query": {"affinity": 0.93}, "properties": {"short_description": "Sci-fi"}}, {"name": ""}, "junk"]}}
    assert validate_response(good) == [{"name": "Arrival", "reason": "Sci-fi", "score": 0.93}]
    for bad in (None, [], {"results": []}, {"results": {"entities": "x"}}, {"results": {"entities": [{"name": 5}]}}):
        with pytest.raises(QlooError):
            validate_response(bad)


def test_qloo_invalid_json_and_http_errors_fall_back():
    class Resp:
        def __init__(self, body): self.body = body
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n): return self.body

    bad = Recommender(QlooClient(api_key=SECRET, opener=lambda r, timeout: Resp(b"<html>"), retries=0)).recommend("s", "movie", enabled=True, personalization=True)
    assert bad["provider"] == "local" and bad["note"] == "invalid_response"

    def http401(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "no", {}, None)

    out = Recommender(QlooClient(api_key=SECRET, opener=http401, retries=0)).recommend("s", "movie", enabled=True, personalization=True)
    assert out["note"] == "auth_failed" and SECRET not in json.dumps(out)


def test_qloo_success_is_cached_per_session():
    mock = MockQlooProvider()
    rec = Recommender(mock)
    a = rec.recommend("s1", "movie", enabled=True, personalization=True)
    b = rec.recommend("s1", "movie", enabled=True, personalization=True)
    rec.recommend("s2", "movie", enabled=True, personalization=True)
    assert a["provider"] == "qloo" and b["cached"] is True and mock.calls == 2


def test_toggles_force_local_even_with_key():
    rec = Recommender(MockQlooProvider())
    assert rec.recommend("s", "movie", enabled=False, personalization=True)["provider"] == "local"
    assert rec.recommend("s", "movie", enabled=True, personalization=False)["provider"] == "local"


def test_qloo_recommendation_never_bypasses_policy(app, monkeypatch):
    monkeypatch.setattr(srv, "recommender_default", Recommender(MockQlooProvider([{"name": "Funzone Mega Party", "reason": "mock", "score": 1.0}])))
    c = client(app)
    first = say(c, "Recommend something to do")
    assert first["provider"]["id"] == "qloo"
    book = say(c, "Book this for us", cid=first["conversation_id"])
    decision = book["card"]["decision"]["decision"]
    assert decision == "ask"                     # policy decided, not Qloo
    assert book["card"]["recommendation"]["suggestion_only"] is True
    assert "check_action" in book["trace"]
    execute = c.post("/api/execute", json={"action": book["card"]["action"], "decision_token": book["card"]["decision"]["decision_token"]})
    assert execute.status_code >= 400 or execute.json().get("status") != "executed"   # no approval -> no execution


def test_book_this_without_recommendation_does_nothing(app):
    r = say(client(app), "Book this for us")
    assert r["card"]["kind"] == "message" and "check_action" not in r["trace"]


# ---- location / timezone ----

def test_timezone_formatting_and_validation():
    s = apply_patch(default_settings(), {"timezone": {"name": "America/Los_Angeles", "source": "user"}})
    assert local_time_text(s, datetime(2026, 10, 17, 19, 5, tzinfo=timezone.utc)) == "12:05 PM on Saturday, October 17 (America/Los_Angeles)"
    assert local_time_text(default_settings()) is None
    with pytest.raises(ValueError):
        apply_patch(default_settings(), {"timezone": {"name": "Mars/Olympus"}})
    auto = apply_patch(s, {"timezone": {"name": "Asia/Tokyo", "source": "auto"}})
    assert auto["timezone"]["name"] == "America/Los_Angeles"   # browser auto-detect never overrides a manual choice


def test_location_validation():
    s = apply_patch(default_settings(), {"location": {"city": "San Jose", "region": "CA", "country": "US", "latitude": "37.33", "longitude": -121.89}})
    assert s["location"]["latitude"] == 37.33
    for bad in ({"latitude": 91, "longitude": 0}, {"latitude": 10}, {"city": "x" * 200}):
        with pytest.raises(ValueError):
            apply_patch(default_settings(), {"location": bad})


def test_time_uses_saved_timezone_and_location_asked_once(app):
    c = client(app)
    assert "timezone" in say(c, "What time is it?")["assistant_text"].lower()
    r = say(c, "What movies are near me?")
    assert r["card"]["kind"] == "needs_setting" and r["card"]["link"]["href"] == "#settings"
    again = say(c, "What is happening near me?", cid=r["conversation_id"])
    assert "Settings" in again["assistant_text"] and again["assistant_text"] != r["assistant_text"]
    c.post("/api/settings", json={"timezone": {"name": "Asia/Kolkata", "source": "user"}, "location": {"city": "San Jose", "country": "US"}})
    assert "Asia/Kolkata" in say(c, "What time is it?")["assistant_text"]
    near = say(c, "What movies are available nearby?")
    assert "San Jose" in near["assistant_text"] and near["provider"]["label"] == "Demo recommendations"


def test_latest_movie_is_honest_without_search(app):
    r = say(client(app), "What is the latest movie?")
    assert "isn't connected" in r["assistant_text"] and r["provider"]["id"] == "local"


def test_private_orders_still_private_on_shared_screen(app):
    r = say(client(app), "Show my private orders")
    assert r["card"]["kind"] == "privacy" and "private" in r["assistant_text"].lower()


# ---- sessions: isolation, logout, reset ----

def test_per_session_isolation(app):
    a, b = client(app), client(app)
    a.post("/api/session/login", json={"name": "Alex"})
    a.post("/api/settings", json={"location": {"city": "Austin"}})
    sb = b.get("/api/settings").json()
    assert sb["settings"]["location"]["city"] == "" and sb["settings"]["account"]["signed_in"] is False
    assert a.get("/api/settings").json()["settings"]["account"]["display_name"] == "Alex"


def test_logout_gives_a_fresh_sandbox(app):
    c = client(app)
    c.post("/api/session/login", json={"name": "Alex"})
    c.post("/api/settings", json={"location": {"city": "Austin"}})
    assert c.post("/api/session/logout").json()["status"] == "signed_out"
    after = c.get("/api/settings").json()["settings"]
    assert after["account"]["signed_in"] is False and after["location"]["city"] == ""


def test_reset_keeps_settings_but_clear_wipes_them(app):
    c = client(app)
    c.post("/api/settings", json={"location": {"city": "Austin"}})
    say(c, "Plan Maya's birthday under $150.")
    c.post("/api/reset")
    state = c.get("/api/state").json()
    assert state["plans"] == [] and c.get("/api/settings").json()["settings"]["location"]["city"] == "Austin"
    c.post("/api/data/clear")
    assert c.get("/api/settings").json()["settings"]["location"]["city"] == ""


def test_settings_validation_errors_are_400(app):
    c = client(app)
    assert c.post("/api/settings", json={"language": "xx"}).status_code == 400
    assert c.post("/api/settings", json={"members": [{"name": "A", "role": "teen"}]}).status_code == 400   # needs an adult
    assert c.post("/api/session/login", json={"name": ""}).status_code == 400


def test_members_are_display_only_and_validated():
    ok = validate_members([{"name": "Dad", "role": "adult", "interests": ["jazz"]}, {"name": "Maya", "role": "teen"}])
    assert ok[0]["can_approve"] is True and ok[1]["can_approve"] is False


# ---- providers / secrets ----

def test_missing_nvidia_key_is_not_an_error(app):
    out = nvidia_compare("hello")
    assert out["available"] is False and out["informational_only"] is True and "Nemotron" in out["label"]
    r = client(app).post("/api/compare", json={"text": "hi"})
    assert r.status_code == 200 and r.json()["available"] is False


def test_nvidia_failure_does_not_leak_key(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", SECRET)
    monkeypatch.setenv("NVIDIA_MODEL_ID", "nvidia/test")

    def boom(req, timeout):
        raise OSError(f"connection to host failed with key {SECRET}")

    out = nvidia_compare("hello", opener=boom)
    assert out["available"] is False and SECRET not in json.dumps(out)


def test_missing_aws_credentials_still_works(app):
    c = client(app)
    s = c.get("/api/settings").json()
    assert s["providers"]["bedrock"]["state"] == "demo" and "unavailable" in s["providers"]["bedrock"]["detail"].lower()
    assert c.post("/api/propose", json={"source_text": "Ask me before booking anything over $100.", "created_by": "siva"}).status_code == 200


def test_provider_status_and_tests_never_contain_secrets(app, monkeypatch, caplog):
    monkeypatch.setenv("NVIDIA_API_KEY", SECRET)
    monkeypatch.setenv("NVIDIA_MODEL_ID", "nvidia/test")
    monkeypatch.setattr(srv, "recommender_default", Recommender(QlooClient(api_key=SECRET, opener=lambda r, timeout: (_ for _ in ()).throw(TimeoutError(SECRET)), retries=0)))
    c = client(app)
    with caplog.at_level(logging.DEBUG):
        blobs = [c.get("/api/settings").text, c.post("/api/providers/test", json={"provider": "qloo"}).text, c.post("/api/providers/test", json={"provider": "nvidia"}).text, c.post("/api/providers/test", json={"provider": "bedrock"}).text, c.post("/api/providers/test", json={"provider": "nope"}).text, c.get("/api/status").text]
        blobs.append(json.dumps(say(c, "Recommend a movie for us")))
    assert all(SECRET not in b for b in blobs) and SECRET not in caplog.text
    assert provider_status({"available": False}, QlooClient(api_key=SECRET), default_settings())["qloo"]["state"] == "connected"
    assert SECRET not in json.dumps(provider_status({"available": False}, QlooClient(api_key=SECRET), default_settings()))


def test_qloo_toggle_off_shows_demo(app):
    c = client(app)
    c.post("/api/settings", json={"qloo_enabled": False})
    assert c.get("/api/settings").json()["providers"]["qloo"]["state"] == "demo"


def test_qloo_request_shape_resolves_seed_then_uses_signal():
    seen = []

    class Resp:
        def __init__(self, body): self.body = body
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n): return json.dumps(self.body).encode()

    def opener(req, timeout):
        seen.append((req.full_url, req.headers.get("X-api-key")))
        if "/search" in req.full_url:
            return Resp({"results": [{"name": "Inside Out", "entity_id": "SEED-1"}]})
        return Resp({"success": True, "results": {"entities": [{"name": "Inside Out", "query": {"affinity": 0.9}}, {"name": "Coco", "query": {"affinity": 0.8}, "properties": {"description": "Family"}}]}})

    out = QlooClient(api_key=SECRET, opener=opener).fetch("movie", limit=3)
    assert [i["name"] for i in out] == ["Coco"]
    assert "/search?" in seen[0][0] and "types=urn%3Aentity%3Amovie" in seen[0][0]
    assert "signal.interests.entities=SEED-1" in seen[1][0] and "filter.type=urn%3Aentity%3Amovie" in seen[1][0]
    assert all(h == SECRET for _, h in seen)   # key only ever travels in the header, never the URL
    assert all(SECRET not in u for u, _ in seen)


def test_qloo_400_and_unresolvable_seed_fall_back():
    def bad(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, None)

    out = Recommender(QlooClient(api_key=SECRET, opener=bad, retries=0)).recommend("s", "movie", enabled=True, personalization=True)
    assert out["provider"] == "local" and out["note"] == "http_error"
