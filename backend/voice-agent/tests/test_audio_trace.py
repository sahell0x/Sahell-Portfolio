"""The audio trace has to name the right culprit, or it is worse than nothing.

These guard the two derived numbers a human reads off the summary line — the
audible gap and the accumulated gate wait — because both are arithmetic, not
observation, and both got the blame wrong on their first draft.
"""

import logging
import time

import pytest

from vox.helpers import audio_trace
from vox.helpers.audio_trace import AudioTrace


@pytest.fixture
def trace(caplog):
    caplog.set_level(logging.INFO, logger="audio")
    audio_trace.logger.propagate = True  # let caplog see it; the handler is its own
    t = AudioTrace()
    yield t
    audio_trace.logger.propagate = False


def _lines(caplog):
    return [r.getMessage() for r in caplog.records if r.name == "audio"]


class TestAudibleGap:
    def test_no_gap_while_the_track_stays_ahead(self, trace, caplog):
        for _ in range(3):
            trace.capture(1, audio_s=0.2, buf_before_s=0.4, block_s=0.0)
        assert not [ln for ln in _lines(caplog) if " GAP " in ln]

    def test_gap_reported_when_audio_arrives_after_the_buffer_drained(self, trace, caplog):
        trace.capture(1, audio_s=0.05, buf_before_s=0.0, block_s=0.0)
        time.sleep(0.15)  # 50ms of audio, 150ms of wall clock -> ~100ms of silence
        trace.capture(1, audio_s=0.05, buf_before_s=0.0, block_s=0.0)

        gaps = [ln for ln in _lines(caplog) if " GAP " in ln]
        assert len(gaps) == 1
        assert "silence=" in gaps[0]


class TestGateAccounting:
    def test_a_stall_before_the_first_chunk_still_counts(self, trace, caplog):
        """The rollover used to zero this, hiding the leading stall entirely."""
        trace.gate(7, "held then sent", 0.30, "user_speaking")
        trace.capture(7, audio_s=0.2, buf_before_s=0.0, block_s=0.0)
        trace.response_end(7)

        summary = [ln for ln in _lines(caplog) if " SUM " in ln]
        assert len(summary) == 1
        assert "gatewait=300ms" in summary[0]
        assert "gate held audio" in summary[0]

    def test_a_clean_response_is_called_clean(self, trace, caplog):
        trace.capture(2, audio_s=0.5, buf_before_s=0.4, block_s=0.0)
        trace.response_end(2)
        assert "-> clean" in [ln for ln in _lines(caplog) if " SUM " in ln][0]

    def test_starvation_blames_the_producer_not_the_gate(self, trace, caplog):
        trace.capture(3, audio_s=0.05, buf_before_s=0.0, block_s=0.0)
        time.sleep(0.15)
        trace.capture(3, audio_s=0.05, buf_before_s=0.0, block_s=0.0)
        trace.response_end(3)
        assert "producer too slow" in [ln for ln in _lines(caplog) if " SUM " in ln][0]


class TestDisabled:
    def test_emits_nothing_when_switched_off(self, trace, caplog, monkeypatch):
        monkeypatch.setattr(audio_trace, "ENABLED", False)
        trace.capture(1, audio_s=0.2, buf_before_s=0.0, block_s=0.0)
        trace.gate(1, "held then sent", 5.0, "user_speaking")
        trace.tts_chunk(1, 1024, 0.2)
        assert _lines(caplog) == []
