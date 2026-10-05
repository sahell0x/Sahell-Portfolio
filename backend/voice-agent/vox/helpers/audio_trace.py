"""One log channel for the audio path, and nothing else.

The engine's existing `VOX_TRACE_*` lines follow *history and marks* — who said
what, which turn got credited. They are the wrong instrument for "why does her
voice break between words", because that question is about **time**: when a TTS
chunk arrived, whether anything held it back, and whether the track ran dry
before the next chunk landed.

So this module traces the places a gap can be born, and nothing else:

    sarvam ──tts──> engine ──gate──> output handler ──cap──> socket ──ws──> browser
                              ▲                        ▲
                        stalls here?          falls behind realtime here?

Every line is one boundary crossing, stamped with milliseconds since the call
began, so a gap you can hear lines up with the line that caused it:

    AUD +12.340s  tts   seq=3 #4  audio=232ms  gap=210ms  bytes=10240
    AUD +12.352s  cap   seq=3 #4  audio=232ms  buf=180ms  block=0ms
    AUD +12.700s  GAP   seq=3     silence=118ms  buf=0ms      <- audible break
    AUD +12.700s  wait  seq=3     WAIT 250ms  why=user_speaking

Reading the summary line is usually enough to assign blame:

    gaps>0 and gatewait≈0   -> the producer is late: TTS/network to Sarvam
    gatewait large          -> the interruption gate is holding audio back
    gaps=0 and gatewait=0   -> nothing stalled server-side; look at the browser

Enabled by default; set AUDIO_TRACE=0 to silence. `AUDIO_TRACE_QUIET=1` (the
default when tracing) also mutes the rest of the engine's INFO chatter so this
channel is the only thing on the console.
"""

from __future__ import annotations

import logging
import os
import sys
import time

_TRUE = ("1", "true", "yes", "on")


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in _TRUE


ENABLED = _flag("AUDIO_TRACE", "1")
QUIET = _flag("AUDIO_TRACE_QUIET", "1")

# A chunk written this long after the previous one was due to finish playing is
# a gap the visitor can hear, unless the client's own buffer covers it. The
# client holds a prebuffer for exactly this reason, so short overruns are
# absorbed; this threshold is about spotting the sustained ones.
AUDIBLE_GAP_S = 0.030

# Loggers that emit per-frame or per-chunk at INFO. In quiet mode they are the
# difference between a readable audio trace and a wall of text.
_NOISY = (
    "vox.agent_manager.task_manager",
    "vox.agent_manager.interruption_manager",
    "vox.synthesizer.stream_synthesizer",
    "vox.synthesizer.sarvam_synthesizer",
    "vox.transcriber.sarvam_transcriber",
    "vox.transcriber.deepgram_transcriber",
    "vox.input_handlers.default",
    "vox.output_handlers.default",
    "vox.helpers.mark_event_meta_data",
    "app.transport",
    "websockets",
    "httpx",
    "openai",
)


def _build_logger() -> logging.Logger:
    """Own handler, no propagation — the audio channel formats itself.

    Inheriting the root format would prefix every line with the module/function
    columns `configure_logger` installs, which is exactly the noise this channel
    exists to escape.
    """
    log = logging.getLogger("audio")
    log.setLevel(logging.INFO)
    log.propagate = False
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(handler)
    return log


logger = _build_logger()


def install_quiet_mode() -> None:
    """Mute the per-chunk INFO chatter so only the audio channel remains.

    Called once at startup. WARNING and above still come through — an error in
    the pipeline must never be silenced by a debugging switch.
    """
    if not (ENABLED and QUIET):
        return
    for name in _NOISY:
        logging.getLogger(name).setLevel(logging.WARNING)


class AudioTrace:
    """Timing for the audio path of one call.

    Global rather than per-session on purpose: this is a debugging instrument
    for one conversation at a time. Every line carries its `seq`, so a second
    concurrent call is still readable, just interleaved.
    """

    def __init__(self) -> None:
        self.t0 = time.monotonic()
        self._reset_response(None)
        self._last_tts_ts: float | None = None

    # ---- clock -----------------------------------------------------------

    def _stamp(self) -> str:
        return f"+{time.monotonic() - self.t0:7.3f}s"

    def _emit(self, tag: str, seq, body: str) -> None:
        seq_col = f"seq={seq}" if seq is not None else "     "
        logger.info("AUD %s  %-5s %-7s %s", self._stamp(), tag, seq_col, body)

    # ---- response bookkeeping -------------------------------------------

    def _reset_response(self, seq) -> None:
        self._seq = seq
        self._chunks = 0
        self._audio_s = 0.0
        self._resp_start: float | None = None
        # When the audio pushed so far would finish playing. Pushing after this
        # moment means the track already ran dry — that is the audible break.
        self._playout_deadline: float | None = None
        self._gaps = 0
        self._gap_s = 0.0
        self._gate_wait_s = 0.0
        self._block_s = 0.0

    def _ensure_response(self, seq) -> None:
        """Begin bookkeeping for `seq`, closing out the previous response.

        Waits accrued while no response was active belong to the one about to
        start — they are exactly the delay before its first word.
        """
        if seq is None or seq == self._seq:
            return
        if self._chunks:
            self.response_end(self._seq)
        carry = self._gate_wait_s if self._seq is None else 0.0
        self._reset_response(seq)
        self._gate_wait_s = carry

    def call_started(self, session: str) -> None:
        if not ENABLED:
            return
        self.t0 = time.monotonic()
        self._reset_response(None)
        self._last_tts_ts = None
        self._emit("call", None, f"session={session}  audio trace on (AUDIO_TRACE=0 to disable)")

    # ---- 1. synthesizer: is Sarvam delivering audio fast enough? ---------

    def tts_chunk(self, seq, nbytes: int, audio_s: float) -> None:
        """One audio chunk arrived from the TTS websocket."""
        if not ENABLED:
            return
        now = time.monotonic()
        gap_ms = (now - self._last_tts_ts) * 1000 if self._last_tts_ts is not None else 0.0
        self._last_tts_ts = now
        # gap > audio means the producer fell behind real time on this chunk;
        # sustained, it guarantees the track runs dry no matter what else works.
        behind = "  BEHIND" if gap_ms > audio_s * 1000 + 5 and audio_s > 0 else ""
        self._emit(
            "tts",
            seq,
            f"audio={audio_s * 1000:6.0f}ms  gap={gap_ms:6.0f}ms  bytes={nbytes}{behind}",
        )

    def tts_eos(self, seq) -> None:
        if not ENABLED:
            return
        self._last_tts_ts = None
        self._emit("tts", seq, "end of synthesizer stream")

    # ---- 2. the gates: is something holding audio back? -----------------

    def gate(self, seq, status: str, waited_s: float, why: str) -> None:
        """The output loop held or dropped a chunk.

        Only called for non-SEND outcomes and for SENDs that had to wait, so a
        healthy call prints nothing here at all.
        """
        if not ENABLED:
            return
        self._ensure_response(seq)
        self._gate_wait_s += waited_s
        self._emit("wait", seq, f"{status} {waited_s * 1000:.0f}ms  why={why}")

    def delay(self, seq, waited_s: float) -> None:
        """`should_delay_output` held the whole loop before dequeuing."""
        if not ENABLED:
            return
        self._gate_wait_s += waited_s
        self._emit("wait", seq, f"PRE-DELAY {waited_s * 1000:.0f}ms  why=interim_transcript")

    # ---- 3. the track: did it run dry? ----------------------------------

    def capture(self, seq, audio_s: float, buf_before_s: float, block_s: float) -> None:
        """One buffer written to the visitor's socket.

        `buf_before_s` and `block_s` are zero on this transport — the playback
        queue lives in the browser and a socket write does not pace itself — but
        the deadline arithmetic below is unaffected, and it is what answers the
        question that matters: did the server emit audio faster than it plays?
        """
        if not ENABLED:
            return
        now = time.monotonic()

        self._ensure_response(seq)
        if self._resp_start is None:
            self._resp_start = now

        # The break the visitor hears once their buffer is spent: audio written
        # after everything sent before it was already due to have played out.
        if self._playout_deadline is not None and now - self._playout_deadline > AUDIBLE_GAP_S:
            silence_s = now - self._playout_deadline
            self._gaps += 1
            self._gap_s += silence_s
            self._emit(
                "GAP",
                seq,
                f"silence={silence_s * 1000:6.0f}ms  buf={buf_before_s * 1000:.0f}ms   <- audible break",
            )

        self._chunks += 1
        self._audio_s += audio_s
        self._block_s += block_s
        self._playout_deadline = max(now, self._playout_deadline or now) + audio_s

        self._emit(
            "cap",
            seq,
            f"#{self._chunks:<3} audio={audio_s * 1000:6.0f}ms  buf={buf_before_s * 1000:6.0f}ms  block={block_s * 1000:5.0f}ms",
        )

    def response_end(self, seq) -> None:
        """The verdict line for one spoken response."""
        if not ENABLED or not self._chunks:
            return
        wall_s = time.monotonic() - (self._resp_start or time.monotonic())
        rt = (self._audio_s / wall_s) if wall_s > 0 else 0.0
        # Blame whichever actually dominated. The first version named the gate
        # whenever it fired at all, which reported "gate held audio" for a
        # response carrying 2937ms of gaps beside 252ms of gate wait.
        if self._gaps == 0 and self._gate_wait_s < 0.05:
            verdict = "clean"
        elif self._gate_wait_s > self._gap_s:
            verdict = "gate held audio"
        else:
            share = (self._gap_s / wall_s) if wall_s > 0 else 0.0
            verdict = "producer too slow ({:.0%} silence)".format(share)
        self._emit(
            "SUM",
            seq,
            f"audio={self._audio_s:5.2f}s  wall={wall_s:5.2f}s  realtime={rt:4.2f}  "
            f"gaps={self._gaps}/{self._gap_s * 1000:.0f}ms  gatewait={self._gate_wait_s * 1000:.0f}ms  "
            f"chunks={self._chunks}  -> {verdict}",
        )
        self._reset_response(None)

    # ---- 4. interruption: who cut her off? ------------------------------

    def barge_in(self, played_s: float, total_s: float, credited: int, dropped: int) -> None:
        if not ENABLED:
            return
        self._emit(
            "CUT",
            self._seq,
            f"barge-in at {played_s:.2f}s of {total_s:.2f}s  credited={credited} dropped={dropped}"
            f"   <- audio cleared mid-response",
        )
        self._reset_response(None)

    def heard(self, kind: str, text: str, word_count: int, audio_playing: bool) -> None:
        """What the transcriber heard — the usual reason a gate closes.

        Background chatter shows up here as short interim transcripts arriving
        while the agent is speaking; that is the fingerprint of a room-noise
        problem rather than a pipeline one.
        """
        if not ENABLED:
            return
        snippet = (text or "")[:60]
        self._emit(
            "stt",
            None,
            f"{kind:<8} words={word_count:<3} agent_speaking={audio_playing}  {snippet!r}",
        )

    # ---- 5. the socket: is the transport the problem? -------------------

    def mic(self, frames: int, secs: float, peak: int) -> None:
        if not ENABLED:
            return
        self._emit(
            "mic",
            None,
            f"{frames} frames/{secs:.1f}s  peak={peak}/32767 ({'silent' if peak < 200 else 'audible'})",
        )

    def socket(self, body: str) -> None:
        if not ENABLED:
            return
        self._emit("ws", None, body)


atrace = AudioTrace()
