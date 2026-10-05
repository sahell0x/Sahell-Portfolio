"""Environment-driven settings for the portfolio voice agent."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # ---- credentials -----------------------------------------------------
    sarvam_api_key: str = field(default_factory=lambda: os.getenv("SARVAM_API_KEY", ""))
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))

    # ---- models ----------------------------------------------------------
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "gpt-4o-mini"))
    stt_model: str = field(default_factory=lambda: os.getenv("STT_MODEL", "saaras:v3"))
    tts_model: str = field(default_factory=lambda: os.getenv("TTS_MODEL", "bulbul:v3"))
    # Voice must be a speaker the tts_model actually ships; anything else is
    # rejected on every synthesis and the agent goes silent. Retired names
    # that still turn up in old docs and configs: "meera" (bulbul:v1) and
    # "anushka", "manisha", "vidya", "arya" (bulbul:v2) — all four 400 on v3.
    # Verified bulbul:v3 speakers: priya, ritu, neha, pooja, simran, kavya,
    # ishita, shreya, roopa, tanya, shruti, suhani, kavitha, rupali (female);
    # aditya, rahul, rohan, amit, dev (male).
    # Kaira is a woman and the prompt commits her to feminine forms in every
    # language, so this must stay one of the female speakers or the voice and
    # the words contradict each other.
    tts_voice: str = field(default_factory=lambda: os.getenv("TTS_VOICE", "ritu"))
    tts_language: str = field(default_factory=lambda: os.getenv("TTS_LANGUAGE", "en-IN"))
    # "unknown" puts Saaras v3 in auto-detect, which is what carries Hinglish.
    stt_language: str = field(default_factory=lambda: os.getenv("STT_LANGUAGE", "unknown"))

    # ---- audio -----------------------------------------------------------
    # Saaras v3 wants 16k in, and Vox coerces every web call's transcriber to
    # linear16 @ 16k anyway (task_manager.__setup_transcriber). The browser
    # captures at this rate and sends raw PCM as base64 on the socket.
    stt_sample_rate: int = field(default_factory=lambda: _int("STT_SAMPLE_RATE", 16000))
    # bulbul emits 22050 natively (vox/constants.py:SARVAM_MODEL_SAMPLING_RATE_MAPPING —
    # the docs claim 24000, the WAV header disagrees). Asking for anything else makes
    # the synthesizer resample_poly() every chunk independently, and with no filter
    # state carried across chunks each boundary gets an edge transient — an audible
    # click between sentences. Matching the native rate makes resample() a passthrough;
    # the browser's Web Audio graph then resamples once, continuously, on playout.
    # The rate is reported to the client in the `POST /session` body, so this can
    # move without the two sides disagreeing about what the bytes mean.
    tts_sample_rate: int = field(default_factory=lambda: _int("TTS_SAMPLE_RATE", 22050))

    # ---- session limits --------------------------------------------------
    session_seconds: int = field(default_factory=lambda: _int("SESSION_SECONDS", 300))
    session_warn_seconds: int = field(default_factory=lambda: _int("SESSION_WARN_SECONDS", 270))
    max_turns: int = field(default_factory=lambda: _int("MAX_TURNS", 40))
    # 0 disables the cap. Off by default on purpose: this is the only limit that
    # turns away a *new* visitor rather than a heavy one, and a portfolio wants
    # to be read. The per-device and per-IP layers still stop abuse. Set a
    # number here if cost ever needs a hard roof.
    max_concurrent_sessions: int = field(default_factory=lambda: _int("MAX_CONCURRENT_SESSIONS", 0))
    sessions_per_ip_hour: int = field(default_factory=lambda: _int("SESSIONS_PER_IP_HOUR", 3))
    sessions_per_ip_day: int = field(default_factory=lambda: _int("SESSIONS_PER_IP_DAY", 5))
    # How many live sessions one network may hold at once. Above 1 so an office
    # or a household behind one NAT isn't reduced to a single visitor.
    max_sessions_per_ip: int = field(default_factory=lambda: _int("MAX_SESSIONS_PER_IP", 2))

    # ---- per-device (one browser profile) --------------------------------
    # The device id is client-supplied and therefore spoofable; these are the
    # layer that gives a visitor a useful message, not the layer that enforces
    # the ceiling. See the module docstring in app/limits.py.
    # The day is the headline allowance — it is what the page warns about before
    # a visitor spends one. The hourly cap sits below it only so three calls
    # cannot all land in the same five minutes; keep it strictly smaller, or the
    # hourly refusal fires first and names the wrong wait.
    sessions_per_device_hour: int = field(default_factory=lambda: _int("SESSIONS_PER_DEVICE_HOUR", 2))
    sessions_per_device_day: int = field(default_factory=lambda: _int("SESSIONS_PER_DEVICE_DAY", 3))
    # Measured from the start of the previous session, so a long call is not
    # punished with a long wait.
    session_cooldown_seconds: int = field(default_factory=lambda: _int("SESSION_COOLDOWN_SECONDS", 30))
    # 0 disables the ceiling. Off by default, per the owner's explicit decision;
    # flipping it on is a one-line env change if a bill ever surprises.
    daily_session_ceiling: int = field(default_factory=lambda: _int("DAILY_SESSION_CEILING", 0))

    # ---- text fallback ---------------------------------------------------
    text_messages_per_ip_hour: int = field(default_factory=lambda: _int("TEXT_MESSAGES_PER_IP_HOUR", 30))
    text_max_chars: int = field(default_factory=lambda: _int("TEXT_MAX_CHARS", 500))

    # ---- server ----------------------------------------------------------
    host: str = field(default_factory=lambda: os.getenv("HOST", "0.0.0.0"))
    # Absolute ws:// or wss:// origin the browser should dial, for deployments
    # where the socket does not live on the same origin as the HTTP API. Empty
    # (the default) means "derive it from the request that asked for it", which
    # is correct behind the bundled nginx config.
    public_ws_url: str = field(default_factory=lambda: os.getenv("PUBLIC_WS_URL", ""))
    # How long a minted session ticket stays claimable. A visitor whose tab dies
    # between POST /session and the socket opening gets their slot back this
    # soon, instead of waiting out the limiter's session TTL.
    connect_grace_seconds: int = field(default_factory=lambda: _int("CONNECT_GRACE_SECONDS", 60))
    port: int = field(default_factory=lambda: _int("PORT", 8000))
    allowed_origins: list[str] = field(
        default_factory=lambda: _list(
            "ALLOWED_ORIGINS",
            [
                "https://portfolio.sahellx.site",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ],
        )
    )
    trust_proxy_header: bool = field(default_factory=lambda: _bool("TRUST_PROXY_HEADER", True))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))

    # ---- turn-taking -----------------------------------------------------
    # Vox interrupts when word_count is STRICTLY greater than this, so 3 means
    # the visitor must say four words before the agent stops. Raise it if
    # background chatter cuts the agent off; 0 disables barge-in entirely.
    interruption_word_count: int = field(default_factory=lambda: _int("INTERRUPTION_WORD_COUNT", 3))
    # Sarvam defaults this on, which makes it strain to transcribe faint audio —
    # background speech then arrives as a real multi-word transcript and trips
    # the interruption gate. Off unless a quiet talker needs it.
    high_vad_sensitivity: bool = field(default_factory=lambda: _bool("HIGH_VAD_SENSITIVITY", False))

    # ---- agent behaviour -------------------------------------------------
    # Doubles as the assistant id, so it names the `agent_data/<id>/` directory
    # the prompt is written into. Keep it filesystem-safe.
    agent_name: str = field(default_factory=lambda: os.getenv("AGENT_NAME", "kaira"))
    # 0.3 was flat enough that she opened consecutive turns the same way. A
    # little more room buys varied phrasing; the anti-fabrication rules, not a
    # low temperature, are what keep her honest. Push it back down if she ever
    # starts improvising facts.
    llm_temperature: float = field(default_factory=lambda: _float("LLM_TEMPERATURE", 0.4))
    llm_max_tokens: int = field(default_factory=lambda: _int("LLM_MAX_TOKENS", 220))
    welcome_message: str = field(
        default_factory=lambda: os.getenv(
            "WELCOME_MESSAGE",
            "Hi there — I'm Kaira, Sahil's assistant. Ask me anything about "
            "his work, his projects, or the AI systems he builds.",
        )
    )

    def missing_credentials(self) -> list[str]:
        """Names of required credentials that are absent."""
        required = {
            "SARVAM_API_KEY": self.sarvam_api_key,
            "OPENAI_API_KEY": self.openai_api_key,
        }
        return [name for name, value in required.items() if not value]


settings = Settings()
