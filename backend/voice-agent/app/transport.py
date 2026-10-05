"""The visitor's WebSocket, presented as one object every layer can use.

Vox already speaks a web-call protocol over a socket: `DefaultInputHandler`
reads JSON frames off it, `DefaultOutputHandler` writes base64 PCM back, and the
two agree on `mark` events so the engine knows what the visitor actually heard.
This class is that socket, plus the three things the portfolio needs on top of
it and Vox has no opinion about:

* **page-control tools**, which need a *reply* from the browser — the sentence
  the agent then speaks around. `perform_rpc` sends a request and waits for the
  matching `page_action_result` frame.
* **transcripts**, mirrored to the page so the conversation can be read as well
  as heard. `publish_assistant_text` is called from the output handler;
  `publish_data` is what `task_manager` already uses for the visitor's own side.
* **typed turns**, so someone who can't speak aloud can still take a turn in the
  same conversation (`task_manager.inject_typed_messages`).

It replaces `LiveKitTransport`, which owned a WebRTC room. Nothing here pretends
to be anything: it is the socket the browser opened, with one reader and one
serialized writer.

Vox's handlers hold this object where they expect a Starlette `WebSocket`, so
`send_json` / `send_text` / `receive_json` / `close` keep those signatures
exactly. Everything else on the class is ours.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import time
import uuid
from typing import Any

import numpy as np
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from vox.helpers import audio_trace
from vox.helpers.audio_trace import atrace

logger = logging.getLogger(__name__)

# How long a page-control tool may wait for the browser before the agent is told
# it failed. Generous: these land in milliseconds on a healthy connection, and a
# spurious failure makes the agent apologise for something that worked.
RPC_TIMEOUT_S = 8.0

BYTES_PER_SAMPLE = 2  # 16-bit PCM, both directions

# How often to report inbound audio health. "Is it hearing me?" is otherwise
# invisible: audio can flow for a whole call and still be silence.
MIC_REPORT_INTERVAL_S = 2.0


class WebSocketTransport:
    """One browser socket: microphone in, assistant's voice out, page control."""

    def __init__(
        self,
        websocket: WebSocket,
        *,
        session_id: str,
        stt_sample_rate: int,
        tts_sample_rate: int,
    ) -> None:
        self.session_id = session_id
        self._ws = websocket
        self._stt_sample_rate = stt_sample_rate
        self._tts_sample_rate = tts_sample_rate
        self._out_bytes_per_second = tts_sample_rate * BYTES_PER_SAMPLE

        self._closed = False
        self.closed = asyncio.Event()
        # One writer at a time. Vox sends a mark, then the audio, then another
        # mark, from the output loop — while the watchdog can publish a session
        # warning from a different task. Interleaving those on one socket is how
        # a client ends up parsing half a frame.
        self._send_lock = asyncio.Lock()

        # Outstanding page-control calls, keyed by the id we sent.
        self._pending_rpc: dict[str, asyncio.Future[str]] = {}

        # Messages the visitor typed mid-call, drained by inject_typed_messages.
        self._typed: asyncio.Queue[str] = asyncio.Queue()

        # Assistant transcript state: the last sentence mirrored to the client,
        # so chunk repeats are not resent, and whether the turn is still open.
        self._last_transcript: str | None = None
        self._transcript_open = False
        self._transcript_sequence: Any = object()

        # Whether the agent currently holds the turn. Published to the page so
        # it can show "speaking" from the conversation's actual state instead of
        # guessing from how loud the audio is right now.
        self._turn_speaking = False

        # Inbound audio health, reported periodically by the trace channel.
        self._mic_frames = 0
        self._mic_peak = 0
        self._mic_window_start = 0.0

    # ---- lifecycle -------------------------------------------------------

    def start(self) -> None:
        atrace.call_started(self.session_id)

    def is_closed(self) -> bool:
        return self._closed

    async def close(self) -> None:
        """Latch closed and drop the socket.

        Also called by `DefaultInputHandler.stop_handler`, which closes the
        socket it was given when it has no input queue to fall back on.
        """
        if self._closed:
            return
        self._closed = True
        self.closed.set()

        for future in self._pending_rpc.values():
            if not future.done():
                future.set_exception(RuntimeError("the visitor's page went away"))
        self._pending_rpc.clear()

        if self._ws.client_state is WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await self._ws.close()

    def _mark_closed(self) -> None:
        """Note that the peer is gone without trying to close the socket again."""
        if self._closed:
            return
        self._closed = True
        self.closed.set()
        for future in self._pending_rpc.values():
            if not future.done():
                future.set_exception(RuntimeError("the visitor's page went away"))
        self._pending_rpc.clear()

    # ---- Vox-facing socket surface ---------------------------------------

    async def send_json(self, data: Any) -> None:
        if self._closed:
            return
        try:
            async with self._send_lock:
                await self._ws.send_text(json.dumps(data))
        except Exception as exc:
            self._note_send_failure(exc)
            return
        if isinstance(data, dict):
            if data.get("type") == "audio":
                self._trace_audio(data.get("data") or "")
            elif data.get("type") == "clear":
                # A barge-in ends the agent's turn as surely as finishing does.
                self._turn_speaking = False

    async def send_text(self, text: str) -> None:
        if self._closed:
            return
        try:
            async with self._send_lock:
                await self._ws.send_text(text)
        except Exception as exc:
            self._note_send_failure(exc)

    async def receive_json(self) -> dict[str, Any]:
        """The one reader on this socket.

        Frames Vox understands are returned to it verbatim. Frames that are ours
        — a page-control reply, a typed turn — are consumed here and the loop
        continues, so the engine never sees a message it would answer with
        "other modalities not implemented yet".
        """
        while True:
            try:
                message = await self._ws.receive_json()
            except WebSocketDisconnect:
                self._mark_closed()
                raise
            except Exception:
                # A non-JSON frame, or a socket that died mid-read. Either way
                # the conversation is over; Vox treats this like a disconnect.
                self._mark_closed()
                raise WebSocketDisconnect(code=1006)

            if not isinstance(message, dict):
                continue

            kind = message.get("type")

            if kind == "page_action_result":
                self._resolve_rpc(message)
                continue

            if kind == "text":
                # Routed to inject_typed_messages rather than left for
                # DefaultInputHandler.__process_text, which puts it on the llm
                # queue — a queue nothing drains during a streaming voice call.
                typed = str(message.get("data") or "").strip()
                if typed:
                    self._typed.put_nowait(typed)
                continue

            if kind == "audio":
                self._note_mic_health(message.get("data") or "")

            return message

    def _note_send_failure(self, exc: Exception) -> None:
        """A failed send means the page is gone; say so once, quietly."""
        if not self._closed:
            logger.info("Session %s: socket closed during send (%s)", self.session_id, exc)
        self._mark_closed()

    # ---- page control ----------------------------------------------------

    async def perform_rpc(
        self, method: str, payload: dict[str, Any], timeout: float = RPC_TIMEOUT_S
    ) -> str:
        """Invoke a page action in the browser and return what it answers.

        This is how page-control tools reach the page. The browser both performs
        the action and supplies the sentence the agent hears back, because it is
        the side that knows what is actually on screen — so a hallucinated
        argument comes back as something the model can recover from out loud.
        """
        if self._closed:
            raise RuntimeError("no visitor is connected")

        call_id = uuid.uuid4().hex
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_rpc[call_id] = future

        try:
            await self.send_json(
                {"type": "page_action", "id": call_id, "method": method, "payload": payload}
            )
            if self._closed:
                raise RuntimeError("no visitor is connected")
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise RuntimeError(f"the page did not answer within {timeout:.0f}s") from exc
        finally:
            self._pending_rpc.pop(call_id, None)

    def _resolve_rpc(self, message: dict[str, Any]) -> None:
        future = self._pending_rpc.pop(str(message.get("id") or ""), None)
        if future is None or future.done():
            # A late reply to a call that already timed out. Nothing to do with
            # it, and nothing worth telling the agent.
            return
        if message.get("ok"):
            future.set_result(str(message.get("result") or ""))
        else:
            future.set_exception(RuntimeError(str(message.get("error") or "the page refused")))

    # ---- typed turns -----------------------------------------------------

    async def typed_messages(self):
        """Yield messages the visitor typed during the call."""
        while not self._closed:
            getter = asyncio.ensure_future(self._typed.get())
            closed = asyncio.ensure_future(self.closed.wait())
            done, _ = await asyncio.wait({getter, closed}, return_when=asyncio.FIRST_COMPLETED)
            closed.cancel()
            if getter in done:
                yield getter.result()
            else:
                getter.cancel()
                return

    # ---- client-facing messages ------------------------------------------

    async def publish_data(self, message: dict[str, Any]) -> None:
        """Send a one-way control message to the page (transcripts, warnings)."""
        await self.send_json(message)

    async def publish_assistant_text(self, meta_info: dict[str, Any]) -> None:
        """Mirror what the agent is saying to the page, once per sentence.

        `text_synthesized` is empty here — streaming synthesizers do not fill it
        (see task_manager's "No text_synthesized on marks" note) — so the
        sentence comes from `meta_info["text"]`. That field repeats on every
        audio chunk of the same sentence, so it is only published when it
        changes; otherwise a one-line prompt arrives a dozen times.
        """
        if self._closed:
            return

        sequence_id = meta_info.get("sequence_id")
        if sequence_id != self._transcript_sequence:
            self._transcript_sequence = sequence_id
            # A later turn is allowed to repeat an earlier sentence verbatim.
            self._last_transcript = None

        if not self._turn_speaking:
            self._turn_speaking = True
            await self.publish_data({"type": "agent_turn", "state": "start"})

        text = (meta_info.get("text") or "").strip()
        if text and text != self._last_transcript:
            self._last_transcript = text
            self._transcript_open = True
            await self.publish_data(
                {"type": "transcript", "role": "assistant", "text": text, "final": False}
            )

        # Only close a turn that is actually open. The welcome message and the
        # online-check both carry sequence_id -1 with end_of_llm_stream set,
        # which makes `is_final` true on *every* chunk — closing (and so
        # reopening) on each one republished the same sentence a dozen times.
        if self._is_final(meta_info) and self._transcript_open:
            self._transcript_open = False
            await self.publish_data(
                {"type": "transcript", "role": "assistant", "text": "", "final": True}
            )

        # "Nothing more is coming for this turn." The page still has audio to
        # play at this point; it holds the speaking state until its own queue
        # drains, which is the only side that knows when the last word lands.
        if self._response_finished(meta_info) and self._turn_speaking:
            self._turn_speaking = False
            await self.publish_data({"type": "agent_turn", "state": "end"})

    @staticmethod
    def _is_final(meta_info: dict[str, Any]) -> bool:
        """Whether this packet closes the *transcript* turn it belongs to.

        Deliberately looser than `_response_finished`: the welcome message and
        the online-check carry sequence_id -1 with `end_of_llm_stream` on every
        chunk, and their one sentence should be shown as settled straight away.
        """
        return bool(
            (meta_info.get("end_of_llm_stream") and meta_info.get("end_of_synthesizer_stream"))
            or meta_info.get("is_final_chunk_of_entire_response")
            or (meta_info.get("sequence_id") == -1 and meta_info.get("end_of_llm_stream"))
        )

    @staticmethod
    def _response_finished(meta_info: dict[str, Any]) -> bool:
        """Whether this is genuinely the last audio packet of the response.

        True exactly once, on the chunk that carries both stream ends — the same
        condition `DefaultOutputHandler` uses for `is_final_chunk`. The looser
        `_is_final` fires on *every* welcome chunk, so using that here would end
        the turn a dozen chunks early.
        """
        return bool(
            (meta_info.get("end_of_llm_stream") and meta_info.get("end_of_synthesizer_stream"))
            or meta_info.get("is_final_chunk_of_entire_response")
        )

    # ---- audio trace -----------------------------------------------------

    def _trace_audio(self, encoded: str) -> None:
        """One buffer handed to the socket, in seconds of speech.

        Pacing is the browser's job now, so there is no queue depth to report
        and no backpressure to measure — but "did the server emit audio faster
        than it plays" is still the question a choppy call turns on, and that is
        exactly what the gap arithmetic in `atrace.capture` answers.
        """
        if not audio_trace.ENABLED:
            return
        # base64 expands 3 bytes to 4; the padding error is under a sample.
        nbytes = len(encoded) * 3 // 4
        atrace.capture(
            None,
            audio_s=nbytes / self._out_bytes_per_second,
            buf_before_s=0.0,
            block_s=0.0,
        )

    def _note_mic_health(self, encoded: str) -> None:
        """Report whether the visitor's audio is actually audible.

        A silent track and a working one are indistinguishable downstream — the
        transcriber happily streams silence for a whole call — so peak amplitude
        is logged periodically. peak≈0 means the page is sending silence; no
        line at all means frames are not arriving.
        """
        if not audio_trace.ENABLED:
            return

        try:
            pcm = base64.b64decode(encoded)
        except Exception:
            return

        samples = np.frombuffer(pcm[: len(pcm) - len(pcm) % BYTES_PER_SAMPLE], dtype=np.int16)
        if samples.size:
            self._mic_peak = max(self._mic_peak, int(np.abs(samples).max()))
        self._mic_frames += 1

        now = time.monotonic()
        if self._mic_window_start == 0.0:
            self._mic_window_start = now
            return
        if now - self._mic_window_start < MIC_REPORT_INTERVAL_S:
            return

        atrace.mic(self._mic_frames, now - self._mic_window_start, self._mic_peak)
        self._mic_frames = 0
        self._mic_peak = 0
        self._mic_window_start = now
