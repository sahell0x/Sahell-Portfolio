"""HTTP surface tests.

`POST /session` no longer starts anything — it mints a ticket the socket then
spends — so everything here runs for real: rate limiting, device rules, ticket
issue and the handshake that claims one.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.limits import RateLimiter


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(
        app_main,
        "limiter",
        # Device-scoped rules are relaxed here so these tests exercise the IP
        # path they were written for; TestDeviceLimits builds its own limiter.
        RateLimiter(
            per_ip_hour=2,
            per_ip_day=5,
            max_concurrent=3,
            text_per_ip_hour=5,
            max_per_ip=99,
            per_device_hour=99,
            per_device_day=99,
            cooldown_seconds=0,
        ),
    )
    with TestClient(app_main.app) as test_client:
        yield test_client


def test_health_reports_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["missing_credentials"] == []


class TestSession:
    def test_returns_somewhere_to_dial_and_a_ticket_to_get_in(self, client):
        body = client.post("/session").json()

        assert body["url"].endswith(f"/ws/{body['session_id']}")
        assert body["url"].startswith("ws://")
        assert body["session_seconds"] == 300
        assert body["token"]

    def test_reports_the_rates_the_page_has_to_encode_at(self, client):
        """Neither rate is recoverable from the bytes, and guessing either one
        detunes the assistant's voice or her hearing."""
        body = client.post("/session").json()

        assert body["audio"] == {"input_sample_rate": 16000, "output_sample_rate": 22050}

    def test_the_socket_is_on_the_origin_that_answered(self, client):
        """Derived from the request so nginx, a tunnel and localhost all work."""
        body = client.post("/session", headers={"X-Forwarded-Proto": "https"}).json()
        assert body["url"].startswith("wss://")

    def test_a_ticket_is_issued_but_nothing_is_running_yet(self, client):
        body = client.post("/session").json()

        assert app_main.registry.is_unclaimed(body["session_id"])
        assert client.get("/health").json()["active_sessions"] == 0

    def test_each_session_gets_its_own_ticket(self, client):
        first = client.post("/session").json()
        second = client.post("/session").json()

        assert first["session_id"] != second["session_id"]
        assert first["token"] != second["token"]

    def test_rate_limit_returns_429_with_a_text_fallback(self, client):
        for _ in range(2):
            assert client.post("/session").status_code == 200

        response = client.post("/session")
        assert response.status_code == 429
        body = response.json()
        assert body["error"] == "ip_hourly"
        assert body["text_fallback"] is True
        assert response.headers["Retry-After"]
        assert body["message"]

    def test_a_refused_visitor_gets_no_ticket(self, client):
        issued = [
            response.json()["session_id"]
            for response in (client.post("/session") for _ in range(3))
            if response.status_code == 200
        ]
        assert len(issued) == 2
        assert all(app_main.registry.is_unclaimed(session_id) for session_id in issued)


class StubSession:
    """The real session dials Sarvam and OpenAI; these tests are about the door.

    It still reads until the client goes away, because that is what makes a
    closed socket release the visitor's slot.
    """

    def __init__(self, *, session_id, transport, on_finished=None):
        self.session_id = session_id
        self.transport = transport
        self._on_finished = on_finished

    async def run(self):
        try:
            while True:
                await self.transport.receive_json()
        except Exception:
            pass
        await self.transport.close()
        if self._on_finished is not None:
            self._on_finished(self.session_id)

    async def stop(self):
        await self.transport.close()


class TestSocketHandshake:
    """The ticket is the whole door policy: one use, one session, one origin."""

    @pytest.fixture(autouse=True)
    def _stub_session(self, monkeypatch):
        monkeypatch.setattr(app_main, "VoiceSession", StubSession)

    def _ticket(self, client, **kwargs):
        body = client.post("/session", **kwargs).json()
        return body["session_id"], body["token"]

    def test_a_forged_ticket_is_refused(self, client):
        session_id, _token = self._ticket(client)

        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/{session_id}?token=guessed"):
                pass

    def test_an_unknown_session_is_refused(self, client):
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/nope?token=whatever"):
                pass

    def test_a_ticket_cannot_be_spent_twice(self, client):
        session_id, token = self._ticket(client)

        with client.websocket_connect(f"/ws/{session_id}?token={token}"):
            pass

        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/{session_id}?token={token}"):
                pass

    def test_a_foreign_origin_is_refused(self, client):
        """WebSocket handshakes are not covered by CORS, so the check is here."""
        session_id, token = self._ticket(client)

        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/ws/{session_id}?token={token}",
                headers={"Origin": "https://attacker.example"},
            ):
                pass

    def test_the_sites_own_origin_is_allowed(self, client):
        session_id, token = self._ticket(client)

        with client.websocket_connect(
            f"/ws/{session_id}?token={token}", headers={"Origin": "http://localhost:3000"}
        ):
            pass

    def test_a_finished_socket_hands_the_slot_back(self, client):
        session_id, token = self._ticket(client, headers={"X-Device-Id": "browser-one"})

        with client.websocket_connect(f"/ws/{session_id}?token={token}"):
            pass

        assert client.post("/session", headers={"X-Device-Id": "browser-one"}).status_code == 200


class TestNoInternalRelay:
    def test_page_action_endpoint_is_gone(self, client):
        """Page actions go down the conversation's own socket; nothing here."""
        response = client.post(
            "/internal/page-action/show_section?session_id=s1",
            json={"section": "projects"},
        )
        assert response.status_code == 404

    def test_ssrf_allowlist_is_not_seeded(self):
        """The loopback hole existed only for the relay, and must not outlive it."""
        import os

        from vox.helpers.function_calling_helpers import _ALLOWLISTED_HOSTS

        assert "127.0.0.1" not in _ALLOWLISTED_HOSTS
        assert not os.environ.get("VOX_TOOL_URL_HOST_ALLOWLIST")


class TestTextFallback:
    def test_empty_message_is_rejected(self, client):
        assert client.post("/chat", json={"message": "   "}).status_code == 400

    def test_malformed_history_role_is_rejected(self, client):
        response = client.post(
            "/chat",
            json={"message": "hi", "history": [{"role": "system", "content": "x"}]},
        )
        assert response.status_code == 422

    def test_rate_limits_independently_of_voice(self, client, monkeypatch):
        """The refusal has to come from the limiter, not from the model.

        The model is stubbed so the test can assert the sixth message never
        reached it — and so the suite stays off the network.
        """
        import openai

        calls = []

        class FakeClient:
            def __init__(self, **_kwargs):
                self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

            async def _create(self, **kwargs):
                calls.append(kwargs)
                message = SimpleNamespace(content="Sure.")
                return SimpleNamespace(choices=[SimpleNamespace(message=message)])

        monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)

        for _ in range(5):
            assert client.post("/chat", json={"message": "hello"}).status_code == 200
        assert len(calls) == 5

        response = client.post("/chat", json={"message": "hello"})
        assert response.status_code == 429
        assert response.json()["error"] == "text_hourly"
        assert len(calls) == 5


class TestDeviceLimits:
    """The multi-tab and redial defences, over HTTP.

    `registry.spawn` is stubbed, so a session started here never ends by itself
    — which is exactly the state a second tab arrives in.
    """

    @pytest.fixture
    def limited(self, client, monkeypatch):
        monkeypatch.setattr(
            app_main,
            "limiter",
            RateLimiter(
                per_ip_hour=99,
                per_ip_day=99,
                max_concurrent=99,
                max_per_ip=99,
                per_device_hour=3,
                per_device_day=10,
                cooldown_seconds=0,
            ),
        )
        return client

    def test_a_second_tab_is_told_which_tab_to_close(self, limited):
        first = limited.post("/session", headers={"X-Device-Id": "browser-one"})
        assert first.status_code == 200

        second = limited.post("/session", headers={"X-Device-Id": "browser-one"})
        assert second.status_code == 429
        body = second.json()
        assert body["error"] == "device_active"
        assert "tab" in body["message"].lower()

    def test_a_second_tab_gets_no_ticket(self, limited):
        limited.post("/session", headers={"X-Device-Id": "browser-one"})
        refused = limited.post("/session", headers={"X-Device-Id": "browser-one"})
        assert "session_id" not in refused.json()

    def test_a_different_browser_is_unaffected(self, limited):
        limited.post("/session", headers={"X-Device-Id": "browser-one"})
        assert limited.post("/session", headers={"X-Device-Id": "browser-two"}).status_code == 200

    def test_a_refusal_still_reports_the_budget(self, limited):
        limited.post("/session", headers={"X-Device-Id": "browser-one"})
        body = limited.post("/session", headers={"X-Device-Id": "browser-one"}).json()

        assert body["quota"]["active_elsewhere"] is True
        assert body["quota"]["allowed"] is False

    def test_a_malformed_device_header_falls_back_instead_of_failing(self, limited):
        """A junk header must not lock anyone out."""
        assert limited.post("/session", headers={"X-Device-Id": "??"}).status_code == 200
        assert limited.post("/session", headers={"X-Device-Id": "x" * 200}).status_code == 200


class TestLimitsEndpoint:
    def test_reports_a_full_budget_before_any_session(self, client):
        body = client.get("/limits", headers={"X-Device-Id": "browser-one"}).json()

        assert body["allowed"] is True
        assert body["remaining_hour"] == 2
        assert body["active_elsewhere"] is False
        assert body["session_seconds"] == 300

    def test_spending_a_session_is_visible_immediately(self, client):
        client.post("/session", headers={"X-Device-Id": "browser-one"})
        body = client.get("/limits", headers={"X-Device-Id": "browser-one"}).json()

        assert body["remaining_hour"] == 1
        assert body["active_elsewhere"] is True

    def test_works_without_a_device_header(self, client):
        assert client.get("/limits").status_code == 200

    def test_a_granted_session_carries_the_budget_with_it(self, client):
        body = client.post("/session", headers={"X-Device-Id": "browser-one"}).json()
        assert body["quota"]["remaining_hour"] == 1


class TestEarlyEnd:
    def test_ending_frees_the_device_for_a_new_session(self, client):
        session_id = client.post("/session", headers={"X-Device-Id": "browser-one"}).json()["session_id"]

        ended = client.post(f"/session/{session_id}/end", headers={"X-Device-Id": "browser-one"})
        assert ended.json()["ended"] is True

        again = client.post("/session", headers={"X-Device-Id": "browser-one"})
        assert again.status_code == 200

    def test_another_visitor_cannot_end_your_session(self, client):
        session_id = client.post("/session", headers={"X-Device-Id": "browser-one"}).json()["session_id"]

        stolen = client.post(f"/session/{session_id}/end", headers={"X-Device-Id": "browser-two"})
        assert stolen.json()["ended"] is False

        # Still held, so the owner's own second tab is still refused.
        assert client.post("/session", headers={"X-Device-Id": "browser-one"}).status_code == 429

    def test_ending_an_unknown_session_is_a_no_op(self, client):
        response = client.post("/session/nope/end", headers={"X-Device-Id": "browser-one"})
        assert response.status_code == 200
        assert response.json()["ended"] is False

    def test_a_beacon_may_identify_itself_in_the_query_string(self, client):
        """`sendBeacon` fires from pagehide and cannot set headers."""
        session_id = client.post("/session", headers={"X-Device-Id": "browser-one"}).json()["session_id"]

        ended = client.post(f"/session/{session_id}/end?device_id=browser-one")
        assert ended.json()["ended"] is True

    def test_a_beacon_from_the_wrong_device_is_still_refused(self, client):
        session_id = client.post("/session", headers={"X-Device-Id": "browser-one"}).json()["session_id"]

        ended = client.post(f"/session/{session_id}/end?device_id=browser-two")
        assert ended.json()["ended"] is False
