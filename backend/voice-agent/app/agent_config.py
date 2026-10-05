"""Builds the single Vox agent config used for every visitor.

Vox normally loads agent configs from Redis via its agent CRUD API. There is
only ever one agent here, so the config is constructed in-process and Redis is
dropped entirely (nothing under `vox/` imports it — only
`local_setup/quickstart_server.py` does).

Vox reads the system prompt from
`agent_data/<assistant_id>/conversation_details.json` (see
`helpers/utils.get_prompt_responses`), so `write_agent_prompt` lays that file
down at startup.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import settings
from .prompt import build_system_prompt
from .tools import build_api_tools

# Matches vox.constants.PREPROCESS_DIR, resolved relative to the process CWD
# the same way Vox resolves it.
PREPROCESS_DIR = "agent_data"


def write_agent_prompt(assistant_id: str, system_prompt: str | None = None) -> Path:
    """Write the prompt file Vox expects, returning its path."""
    prompt = system_prompt if system_prompt is not None else build_system_prompt()
    directory = Path(PREPROCESS_DIR) / assistant_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "conversation_details.json"
    path.write_text(
        json.dumps({"task_1": {"system_prompt": prompt}}, indent=2),
        encoding="utf-8",
    )
    return path


def build_agent_config() -> dict[str, Any]:
    """The full Vox agent config for one visitor session.

    Identical for every visitor: the socket is handed to the engine separately,
    and page-control tools address whoever is on the other end of it, so nothing
    here is session-specific.
    """
    transcriber = {
        "provider": "sarvam",
        "model": settings.stt_model,
        # "unknown" is what puts Saaras v3 in auto-detect; it is the same value
        # vox/lid/sarvam.py uses, and it is what carries Hinglish.
        "language": settings.stt_language,
        "stream": True,
        "sampling_rate": settings.stt_sample_rate,
        "encoding": "linear16",
        # Endpointing is a floor, not the whole story: Vox layers eager
        # end-of-turn plus speculative LLM generation on top of it.
        "endpointing": 400,
        "task": "transcribe",
        # The one VAD knob the Sarvam transcriber actually reads. `vad_threshold`
        # and `vad_prefix_padding_ms` used to sit here and did nothing — they are
        # OpenAI Realtime parameters, absent from SarvamTranscriber entirely.
        "high_vad_sensitivity": settings.high_vad_sensitivity,
    }

    synthesizer = {
        "provider": "sarvam",
        "provider_config": {
            "voice_id": settings.tts_voice,
            "voice": settings.tts_voice,
            "language": settings.tts_language,
            "model": settings.tts_model,
            "speed": 1.0,
            # Must equal bulbul's native rate or every chunk is resampled and
            # clicks at the seams. See Settings.tts_sample_rate.
            "sampling_rate": settings.tts_sample_rate,
        },
        "stream": True,
        "audio_format": "pcm",
        # Smaller buffer => the first sentence starts synthesising sooner.
        "buffer_size": 60,
        "caching": True,
    }

    # Vox's LlmAgent schema (vox/models.py) keeps only agent_type and
    # agent_flow_type at the top level; every LLM parameter lives under a
    # nested llm_config. task_manager reads llm_agent["llm_config"] directly,
    # so flattening these raises KeyError('llm_config') at session start.
    llm_agent = {
        "agent_type": "simple_llm_agent",
        "agent_flow_type": "streaming",
        "llm_config": {
            "provider": "openai",
            "family": "openai",
            "model": settings.llm_model,
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
            "request_json": False,
        },
    }

    task_config = {
        "optimize_latency": True,
        # Server-side backstop on session length. app.room_bot enforces the same
        # cap independently, so a config regression cannot grant a longer call.
        "call_terminate": settings.session_seconds,
        "hangup_after_silence": 30,
        "incremental_delay": 800,
        # Compared with a strict >, so this is "one fewer than the words needed".
        "number_of_words_for_interruption": settings.interruption_word_count,
        "interruption_backoff_period": 100,
        "backchanneling": False,
        "use_fillers": False,
        "check_if_user_online": True,
        "trigger_user_online_message_after": 15,
        "check_user_online_message": "Are you still there?",
        "hangup_after_LLMCall": False,
        "voicemail": False,
        "dtmf_enabled": False,
    }

    return {
        "agent_name": settings.agent_name,
        "agent_type": "other",
        "agent_welcome_message": settings.welcome_message,
        "tasks": [
            {
                "task_type": "conversation",
                "toolchain": {
                    "execution": "parallel",
                    "pipelines": [["transcriber", "llm", "synthesizer"]],
                },
                "tools_config": {
                    # Vox's own web-call transport: JSON frames on a socket,
                    # base64 PCM in both directions, `mark` events echoed by the
                    # client so the engine knows what was actually heard. Vox
                    # forces these to "default" for a web call anyway; naming
                    # them makes the choice legible rather than incidental.
                    "input": {"provider": "default", "format": "wav"},
                    "output": {"provider": "default", "format": "wav"},
                    "transcriber": transcriber,
                    "synthesizer": synthesizer,
                    "llm_agent": llm_agent,
                    "api_tools": build_api_tools(),
                },
                "task_config": task_config,
            }
        ],
    }
