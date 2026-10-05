"""The browser socket, as every layer above it sees it.

`WebSocketTransport` is the one object that is three things at once: the socket
Vox's default web-call handlers read and write, the channel page-control tools
call the browser on, and the place transcripts and session notices go out. These
tests cover the parts Vox does not — interception, page control, and the
transcript dedup rules that a streaming synthesizer makes necessary.
"""

import asyncio
import base64
import json

import pytest
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.transport import WebSocketTransport


class FakeSocket:
    """A Starlette WebSocket, reduced to what the transport actually touches."""

    def __init__(self, inbound=None):
        self.sent: list[str] = []
        self.client_state = WebSocketState.CONNECTED
        self.closed = False
        self._inbound: asyncio.Queue = asyncio.Queue()
        for message in inbound or []:
            self._inbound.put_nowait(message)

    # -- test controls --
    def deliver(self, message) -> None:
        self._inbound.put_nowait(message)

    def frames(self) -> list[dict]:
        return [json.loads(raw) for raw in self.sent]

    def of_type(self, kind: str) -> list[dict]:
        return [frame for frame in self.frames() if frame.get("type") == kind]

    # -- socket surface --
    async def send_text(self, text: str) -> None:
        if self.closed:
            raise RuntimeError("socket is closed")
        self.sent.append(text)

    async def receive_json(self):
        message = await self._inbound.get()
        if message is None:
            raise WebSocketDisconnect(code=1000)
        return message

    async def close(self, code: int = 1000) -> None:
        self.closed = True
        self.client_state = WebSocketState.DISCONNECTED


def make_transport(socket) -> WebSocketTransport:
    return WebSocketTransport(
        socket, session_id="test-session", stt_sample_rate=16000, tts_sample_rate=22050
    )


def audio_meta(text: str, *, sequence_id: int = 1, final: bool = False) -> dict:
    return {
        "type": "audio",
        "sequence_id": sequence_id,
        # Streaming synths leave text_synthesized empty and carry the sentence
        # in "text"; the mark ledger reads the former, the transcript the latter.
        "text_synthesized": text,
        "text": text,
        "message_category": "",
        "end_of_llm_stream": final,
        "end_of_synthesizer_stream": final,
    }


class TestReading:
    async def test_vox_frames_are_passed_straight_through(self):
        socket = FakeSocket([{"type": "audio", "data": "AAA="}])
        transport = make_transport(socket)

        assert await transport.receive_json() == {"type": "audio", "data": "AAA="}

    async def test_typed_turns_are_taken_off_the_engines_hands(self):
        """DefaultInputHandler would put these on the llm queue, which nothing
        drains during a streaming voice call; inject_typed_messages reads them."""
        socket = FakeSocket([{"type": "text", "data": " tell me about projects "}])
        transport = make_transport(socket)

        reader = asyncio.create_task(transport.receive_json())
        typed = await asyncio.wait_for(anext(transport.typed_messages()), 1)

        assert typed == "tell me about projects"
        reader.cancel()

    async def test_a_page_reply_never_reaches_the_engine(self):
        socket = FakeSocket(
            [
                {"type": "page_action_result", "id": "unknown", "ok": True, "result": "hi"},
                {"type": "mark", "name": "m1"},
            ]
        )
        transport = make_transport(socket)

        assert await transport.receive_json() == {"type": "mark", "name": "m1"}

    async def test_a_disconnect_propagates_and_latches_closed(self):
        socket = FakeSocket([None])
        transport = make_transport(socket)

        with pytest.raises(WebSocketDisconnect):
            await transport.receive_json()
        assert transport.is_closed()

    async def test_junk_frames_are_ignored_rather_than_answered(self):
        socket = FakeSocket(["not a dict", {"type": "mark", "name": "m1"}])
        transport = make_transport(socket)

        assert await transport.receive_json() == {"type": "mark", "name": "m1"}


class TestWriting:
    async def test_sends_are_serialized(self):
        """Vox writes a mark, the audio, then another mark from the output loop
        while the watchdog can publish a warning from a different task. Half a
        frame interleaved into another is how a client ends up unable to parse."""
        socket = FakeSocket()
        transport = make_transport(socket)

        await asyncio.gather(
            *(transport.send_json({"type": "audio", "data": "AAAA", "i": i}) for i in range(20))
        )

        assert [frame["i"] for frame in socket.frames()] == list(range(20))

    async def test_a_dead_socket_stops_the_conversation_quietly(self):
        socket = FakeSocket()
        transport = make_transport(socket)
        socket.closed = True

        await transport.send_json({"type": "audio", "data": "AAAA"})

        assert transport.is_closed()
        assert socket.sent == []

    async def test_nothing_is_written_after_close(self):
        socket = FakeSocket()
        transport = make_transport(socket)
        await transport.close()

        await transport.send_json({"type": "audio", "data": "AAAA"})
        assert socket.sent == []


class TestPageControl:
    async def test_the_browsers_answer_is_what_the_agent_hears(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        call = asyncio.create_task(transport.perform_rpc("show_section", {"section": "projects"}))
        await asyncio.sleep(0)

        request = socket.of_type("page_action")[0]
        assert request["method"] == "show_section"
        assert request["payload"] == {"section": "projects"}

        socket.deliver(
            {"type": "page_action_result", "id": request["id"], "ok": True, "result": "Done."}
        )
        reader = asyncio.create_task(transport.receive_json())

        assert await asyncio.wait_for(call, 1) == "Done."
        reader.cancel()

    async def test_a_refusal_reaches_the_agent_as_its_reason(self):
        """A hallucinated argument has to come back as something the model can
        correct itself with out loud, not as a generic failure."""
        socket = FakeSocket()
        transport = make_transport(socket)

        call = asyncio.create_task(transport.perform_rpc("show_section", {"section": "nope"}))
        await asyncio.sleep(0)
        request = socket.of_type("page_action")[0]

        socket.deliver(
            {"type": "page_action_result", "id": request["id"], "ok": False, "error": 'Unknown section "nope".'}
        )
        reader = asyncio.create_task(transport.receive_json())

        with pytest.raises(RuntimeError, match="Unknown section"):
            await asyncio.wait_for(call, 1)
        reader.cancel()

    async def test_a_silent_page_gives_up_rather_than_hanging_the_turn(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        with pytest.raises(RuntimeError, match="did not answer"):
            await transport.perform_rpc("open_terminal", {}, timeout=0.05)

    async def test_a_closed_socket_fails_the_call_immediately(self):
        socket = FakeSocket()
        transport = make_transport(socket)
        await transport.close()

        with pytest.raises(RuntimeError):
            await transport.perform_rpc("open_terminal", {})

    async def test_a_disconnect_releases_a_call_in_flight(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        call = asyncio.create_task(transport.perform_rpc("open_terminal", {}, timeout=5))
        await asyncio.sleep(0)
        await transport.close()

        with pytest.raises(RuntimeError, match="went away"):
            await asyncio.wait_for(call, 1)


class TestTranscript:
    async def test_spoken_text_streams_to_the_page(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        await transport.publish_assistant_text(audio_meta("Hey there"))

        assert socket.of_type("transcript") == [
            {"type": "transcript", "role": "assistant", "text": "Hey there", "final": False}
        ]

    async def test_a_sentence_is_published_once_not_per_chunk(self):
        """meta_info["text"] repeats on every chunk of the same sentence; sending
        it each time is what made one prompt arrive a dozen times."""
        socket = FakeSocket()
        transport = make_transport(socket)

        for _ in range(5):
            await transport.publish_assistant_text(audio_meta("Are you still there?"))

        assert [line["text"] for line in socket.of_type("transcript")] == ["Are you still there?"]

    async def test_a_welcome_message_is_published_once(self):
        """sequence_id -1 with end_of_llm_stream makes finality true on every
        chunk, so closing the turn each time reopened it and re-sent the text."""
        socket = FakeSocket()
        transport = make_transport(socket)

        welcome = "Hey! I'm Sahil's assistant."
        for _ in range(6):
            meta = audio_meta(welcome, sequence_id=-1)
            meta["end_of_llm_stream"] = True
            await transport.publish_assistant_text(meta)

        said = [line["text"] for line in socket.of_type("transcript") if line["text"]]
        assert said == [welcome]

    async def test_the_last_chunk_closes_the_turn(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        await transport.publish_assistant_text(audio_meta("First sentence."))
        await transport.publish_assistant_text(audio_meta("Second sentence.", final=True))

        lines = socket.of_type("transcript")
        assert [line["text"] for line in lines] == ["First sentence.", "Second sentence.", ""]
        assert lines[-1]["final"] is True

    async def test_a_new_turn_can_repeat_an_earlier_sentence(self):
        """Dedup is per response, not for the whole call."""
        socket = FakeSocket()
        transport = make_transport(socket)

        await transport.publish_assistant_text(audio_meta("Sure.", final=True))
        await transport.publish_assistant_text(audio_meta("Sure.", sequence_id=2, final=True))

        said = [line["text"] for line in socket.of_type("transcript") if line["text"]]
        assert said == ["Sure.", "Sure."]


class TestVoxCompatibility:
    """The surface `DefaultInputHandler` and `DefaultOutputHandler` call on it."""

    async def test_it_answers_to_the_starlette_websocket_methods(self):
        socket = FakeSocket()
        transport = make_transport(socket)

        await transport.send_text(json.dumps({"type": "mark", "name": "m1"}))
        await transport.send_json({"type": "audio", "data": base64.b64encode(b"\x01\x02").decode()})

        assert [frame["type"] for frame in socket.frames()] == ["mark", "audio"]

    async def test_stop_handler_can_close_it(self):
        """DefaultInputHandler.stop_handler closes the socket it was given when
        it has no input queue to fall back on."""
        socket = FakeSocket()
        transport = make_transport(socket)

        await transport.close()
        assert socket.closed
        assert transport.closed.is_set()
